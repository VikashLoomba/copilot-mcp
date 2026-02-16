import * as vscode from "vscode";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { searchMcpServers2 } from "../utilities/repoSearch";
import { openMcpInstallUri, readmeExtractionRequest } from "../McpAgent";
import { 
	logWebviewSearch, 
	logWebviewInstallAttempt, 
	logWebviewAiSetupSuccess, 
	logWebviewAiSetupError, 
	logWebviewFeedbackSent, 
	logWebviewInstallUriOpened,
	logError,
	logEvent,
	startPerformanceTimer,
	endPerformanceTimer
} from "../telemetry/standardizedTelemetry";
import { TelemetryEvents } from "../telemetry/types";
import { Messenger } from "vscode-messenger";
import {
        aiAssistedSetupType,
        deleteServerType,
        getMcpConfigType,
        searchServersType,
        sendFeedbackType,
        updateMcpConfigType,
        updateServerEnvVarType,
        cloudMCPInterestType,
        previewReadmeType,
        installFromConfigType,
        installClaudeFromConfigType,
        installCodexFromConfigType,
        registrySearchType,
        skillsSearchType,
        skillsListFromSourceType,
        skillsGetAgentsType,
        skillsInstallType,
        skillsListInstalledType,
        skillsUninstallType,
} from "../shared/types/rpcTypes";
import type {
        InstallCommandPayload,
        InstallInput,
        InstallTransport,
        ClaudeInstallRequest,
        CodexInstallRequest,
        SkillsInstallRequest,
        SkillsUninstallRequest,
        SkillsInstallScope,
} from "../shared/types/rpcTypes";
import { searchSkills, listSkillsFromSource, addSkillsFromSource } from "../skills-client";
import { listInstalledSkills, uninstallInstalledSkill } from "../installer";
import { agents as availableSkillAgents, detectInstalledAgents, isUniversalAgent } from "../agents";
import type { AgentType } from "../types";
import axios from "axios";
import { outputLogger } from "../utilities/outputLogger";
import { GITHUB_AUTH_PROVIDER_ID, SCOPES } from "../utilities/const";
import { spawn, execSync, exec, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Helper function to read servers from .vscode/mcp.json
async function getServersFromMcpJsonFile(
	folder: vscode.WorkspaceFolder
): Promise<Record<string, any>> {
	try {
		const mcpJsonPath = vscode.Uri.joinPath(folder.uri, ".vscode", "mcp.json");
		const fileContent = await vscode.workspace.fs.readFile(mcpJsonPath);
		const parsedJson = JSON.parse(Buffer.from(fileContent).toString("utf8"));
		return parsedJson.servers || {};
	} catch (error) {
		// Log error or handle if needed, e.g., file not found, invalid JSON
		// console.warn(\`Error reading or parsing .vscode/mcp.json in \${folder.name}: \${error}\`);
		return {};
	}
}

// Consolidates servers from global settings, workspace settings, and .vscode/mcp.json files
async function getAllServers(): Promise<Record<string, any>> {
        const config = vscode.workspace.getConfiguration("mcp");

	// 1. Get servers from global settings
	const globalServers = config.inspect<Record<string, any>>("servers")?.globalValue || {};
	
	// 2. Get servers from workspace settings (.vscode/settings.json)
	const workspaceSettingsServers = config.inspect<Record<string, any>>("servers")?.workspaceValue || {};

	// 3. Get servers from .vscode/mcp.json files in all workspace folders
	let mcpJsonFileServers: Record<string, any> = {};
	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			const serversFromFile = await getServersFromMcpJsonFile(folder);
			// Merge, allowing subsequent files to override previous ones if keys conflict
			mcpJsonFileServers = { ...mcpJsonFileServers, ...serversFromFile };
		}
	}

	// Merge order: global -> workspace settings -> .vscode/mcp.json files
	let mergedServers = { ...globalServers };
	mergedServers = { ...mergedServers, ...workspaceSettingsServers };
	mergedServers = { ...mergedServers, ...mcpJsonFileServers };
	
        return mergedServers;
}

function getAgentSkillsBasePath(
	scope: SkillsInstallScope,
	agent: AgentType,
	workspaceCwd?: string
): string | undefined {
	const agentConfig = availableSkillAgents[agent];
	if (!agentConfig) {
		return undefined;
	}

	if (scope === "global") {
		return agentConfig.globalSkillsDir;
	}

	if (!workspaceCwd) {
		return undefined;
	}

	return join(workspaceCwd, agentConfig.skillsDir);
}

function getInstalledSkillUninstallPolicy(
	scope: SkillsInstallScope,
	agents: AgentType[],
	workspaceCwd?: string
): { uninstallPolicy: "agent-select" | "all-agents"; uninstallPolicyReason?: string } {
	if (scope === "project" && agents.some((agent) => isUniversalAgent(agent))) {
		return {
			uninstallPolicy: "all-agents",
			uninstallPolicyReason:
				"This project skill lives in a shared .agents/skills directory, so uninstalling requires all listed agents.",
		};
	}

	const basePathToAgents = new Map<string, AgentType[]>();
	for (const agent of agents) {
		const basePath = getAgentSkillsBasePath(scope, agent, workspaceCwd);
		if (!basePath) {
			continue;
		}

		const normalizedBasePath = resolve(basePath);
		const current = basePathToAgents.get(normalizedBasePath) ?? [];
		current.push(agent);
		basePathToAgents.set(normalizedBasePath, current);
	}

	for (const sharedAgents of basePathToAgents.values()) {
		if (sharedAgents.length > 1) {
			return {
				uninstallPolicy: "all-agents",
				uninstallPolicyReason:
					"These agents share the same skills directory in this scope, so uninstalling requires all listed agents.",
			};
		}
	}

	return { uninstallPolicy: "agent-select" };
}

const INPUT_PLACEHOLDER_REGEX = /\\?\${input:([^}]+)}/g;

function replaceInputPlaceholders(value: string, replacements: Map<string, string>): string {
        return value.replace(INPUT_PLACEHOLDER_REGEX, (_, rawId) => {
                const key = String(rawId ?? "").trim();
                if (!key) {
                        return "";
                }
                return replacements.get(key) ?? "";
        });
}

function applyInputsToPayload(
        payload: InstallCommandPayload,
        replacements: Map<string, string>
): InstallCommandPayload {
        const args = payload.args?.map((arg) => replaceInputPlaceholders(arg, replacements));
        const envEntries = payload.env ? Object.entries(payload.env) : [];
        const env = envEntries.length
                ? envEntries.reduce<Record<string, string>>((acc, [key, value]) => {
                                acc[key] = replaceInputPlaceholders(value, replacements);
                                return acc;
                        }, {})
                : undefined;
        const headers = payload.headers?.map((header) => ({
                name: header.name,
                value: header.value !== undefined ? replaceInputPlaceholders(header.value, replacements) : header.value,
        }));

        return {
                ...payload,
                args,
                env,
                headers,
                inputs: undefined,
        };
}

async function collectInstallInputs(inputs?: InstallInput[]): Promise<{
        values: Map<string, string>;
        canceled: boolean;
}> {
        const values = new Map<string, string>();
        if (!inputs || inputs.length === 0) {
                return { values, canceled: false };
        }

        for (const input of inputs) {
                if (values.has(input.id)) {
                        continue;
                }
                const response = await vscode.window.showInputBox({
                        prompt: input.description,
                        password: input.password ?? false,
                        ignoreFocusOut: true,
                });
                if (response === undefined) {
                        return { values, canceled: true };
                }
                values.set(input.id, response);
        }

        return { values, canceled: false };
}

function headersArrayToRecord(headers?: Array<{ name: string; value: string }>) {
        if (!headers) {
                return undefined;
        }
        const record: Record<string, string> = {};
        for (const header of headers) {
                if (!header?.name) {
                        continue;
                }
                record[header.name] = header.value ?? "";
        }
        return Object.keys(record).length > 0 ? record : undefined;
}

function buildClaudeConfigObject(payload: InstallCommandPayload, transport: InstallTransport) {
        const config: Record<string, unknown> = { type: transport };
        if (transport === "stdio") {
                if (payload.command) {
                        config.command = payload.command;
                }
                if (payload.args && payload.args.length > 0) {
                        config.args = payload.args;
                }
                if (payload.env && Object.keys(payload.env).length > 0) {
                        config.env = payload.env;
                }
        } else {
                if (payload.url) {
                        config.url = payload.url;
                }
                const headerRecord = headersArrayToRecord(payload.headers);
                if (headerRecord) {
                        config.headers = headerRecord;
                }
        }
        return config;
}

async function performVscodeInstall(payload: InstallCommandPayload) {
        const response = await openMcpInstallUri(payload);
        return !!(response && (response as any).success);
}

function createSpawnEnvWithAugmentedPath(): NodeJS.ProcessEnv {
	const pathSeparator = process.platform === "win32" ? ";" : ":";
	const basePath = process.env.PATH ?? "";
	const pathEntries = basePath.split(pathSeparator).filter(Boolean);

	if (process.platform === "darwin") {
		const homeDir = process.env.HOME ?? "";
		const darwinCandidates = [
			"/opt/homebrew/bin",
			"/opt/homebrew/sbin",
			"/usr/local/bin",
			"/usr/local/sbin",
			homeDir ? `${homeDir}/.local/bin` : undefined,
			homeDir ? `${homeDir}/.bun/bin` : undefined,
			homeDir ? `${homeDir}/Library/Application Support/Claude/bin` : undefined,
			homeDir ? `${homeDir}/.claude/local/claude` : undefined,
		];
		for (const candidate of darwinCandidates) {
			if (!candidate) {
				continue;
			}
			if (!pathEntries.includes(candidate)) {
				pathEntries.unshift(candidate);
			}
		}
	}

	return {
		...process.env,
		PATH: pathEntries.join(pathSeparator),
	};
}

function shellQuote(value: string): string {
	if (!value) {
		return "''";
	}
	if (/^[A-Za-z0-9._\/-]+$/.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, "'\\''")}'`;
}

async function runClaudeCliTask(
        name: string,
        transport: InstallTransport,
        config: Record<string, unknown>,
): Promise<void> {
	const homeDir = process.env.HOME ?? "";
	const claudeDir = `${homeDir}/.claude/local`
	const claudeBinary = existsSync(`${claudeDir}`) ? `${claudeDir}/claude` : "claude";
	const configJson = JSON.stringify(config);
	outputLogger.info("Config", config);

	const commandArgs = ["mcp", "add-json", name, configJson];
	const clipboardCommand = [claudeBinary, ...commandArgs].map(shellQuote).join(" ");
	let stdout = "";
	let stderr = "";
	// first try and remove any existing server with the same name
	const remove = spawnSync(claudeBinary, ["mcp", "remove", name])
	outputLogger.info("Pre-remove existing server", { stdout: remove.stdout?.toString(), stderr: remove.stderr?.toString(), status: remove.status });
	await new Promise<void>((resolve, reject) => {
		const child = spawn(claudeBinary, commandArgs);
		const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
		statusBar.text = `$(sync~spin) Installing MCP Server '${name}'...`;
		statusBar.tooltip = "Claude Code is running";
		const scheduleDispose = () => {
			setTimeout(() => statusBar.dispose(), 5000);
		};
		if (child.stdout) {
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
		}

		if (child.stderr) {
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
		}

		child.on("error", (error) => {
			outputLogger.error("Failed to start Claude CLI", error);
			outputLogger.error("Failed to run `claude mcp add`", error);
			statusBar.text = `$(error) Failed to install '${name}' in claude code.`;
			statusBar.tooltip = error instanceof Error ? error.message : undefined;
			scheduleDispose();
			reject(error);
		});

		child.on("close", async (code) => {
			const trimmedStdout = stdout.trim();
			const trimmedStderr = stderr.trim();

			if (code === 0) {
				statusBar.text = `$(check) MCP Server '${name}' installed successfully.`;
				statusBar.tooltip = "Codex CLI completed";
				scheduleDispose();
				const messageParts: string[] = [`Claude CLI install succeeded for '${name}'.`];
				if (trimmedStdout) {
					messageParts.push(trimmedStdout);
				}
				void vscode.window.showInformationMessage(messageParts.join("\n\n"));
				resolve();
				return;
			}

			const failureMessage = trimmedStderr || "Claude CLI reported an error. Check the Output panel for details.";
			statusBar.text = `$(error) MCP install failed for '${name}'.`;
			statusBar.tooltip = failureMessage;
			scheduleDispose();
			const selectedAction = await vscode.window.showErrorMessage(
				`Claude CLI install failed for '${name}'. ${failureMessage}`,
				"Copy Command",
			);
			if (selectedAction === "Copy Command") {
				try {
					await vscode.env.clipboard.writeText(clipboardCommand);
					void vscode.window.showInformationMessage("Claude CLI command copied to your clipboard.");
				} catch (clipboardError) {
					outputLogger.warn("Failed to copy Claude CLI command to clipboard", clipboardError);
				}
			}
			const error = new Error(`Claude CLI exited with code ${code}`);
			outputLogger.error("Claude CLI exited with non-zero code", error, { stdout, stderr });
			reject(error);
		});
	});
}

type CodexCliCommand = {
	args: string[];
	spawnEnvOverrides?: Record<string, string>;
	postInstallNotes?: string[];
};

function sanitizeEnvVarName(name: string): string {
	const trimmed = name.trim();
	const base = trimmed ? trimmed.replace(/[^A-Za-z0-9]+/g, "_") : "MCP_SERVER";
	return base.replace(/^_+/, "");
}

function buildCodexCliCommand(
	name: string,
	transport: InstallTransport,
	payload: InstallCommandPayload,
): CodexCliCommand {
	const args = ["mcp", "add", name];
	const notes: string[] = [];
	const spawnEnvOverrides: Record<string, string> = {};
	const pushNote = (message: string) => {
		if (message && !notes.includes(message)) {
			notes.push(message);
		}
	};

	if (transport === "stdio") {
		const command = payload.command?.trim();
		if (!command) {
			throw new Error("Codex CLI stdio installs require a command to run.");
		}

		const envEntries = payload.env ? Object.entries(payload.env) : [];
		for (const [key, value] of envEntries) {
			const trimmedKey = key?.trim();
			if (!trimmedKey) {
				continue;
			}
			args.push("--env", `${trimmedKey}=${value ?? ""}`);
		}

		args.push("--", command);
		if (payload.args && payload.args.length > 0) {
			args.push(...payload.args);
		}

		return { args };
	}

	if (transport === "http") {
		const url = payload.url?.trim();
		if (!url) {
			throw new Error("Codex CLI http installs require a URL.");
		}
		args.push("--url", url);

		if (payload.headers && payload.headers.length > 0) {
			const validHeaders = payload.headers.filter((header) => Boolean(header?.name?.trim()));
			if (validHeaders.length > 1) {
				throw new Error("Codex CLI only supports a single Authorization header for bearer tokens when adding HTTP servers.");
			}
			if (validHeaders.length === 1) {
				const header = validHeaders[0];
				const headerName = header?.name?.trim() ?? "";
				if (!/^authorization$/i.test(headerName)) {
					throw new Error("Codex CLI only supports Authorization headers with bearer tokens for HTTP servers.");
				}
				const rawValue = header?.value?.trim() ?? "";
				const match = /^Bearer\s+(.+)$/i.exec(rawValue);
				if (!match || !match[1]) {
					throw new Error("Codex CLI requires Authorization headers to be in the format 'Bearer <TOKEN>'.");
				}
				const token = match[1].trim();
				if (!token) {
					throw new Error("Codex CLI requires a non-empty bearer token value.");
				}
				const envVarName = `CODEX_MCP_${sanitizeEnvVarName(name).toUpperCase()}_BEARER_TOKEN`;
				args.push("--bearer-token-env-var", envVarName);
				spawnEnvOverrides[envVarName] = token;
				pushNote(`Set the ${envVarName} environment variable before launching Codex so it can authenticate to ${name}.`);
			}
		}

		return {
			args,
			spawnEnvOverrides: Object.keys(spawnEnvOverrides).length > 0 ? spawnEnvOverrides : undefined,
			postInstallNotes: notes.length > 0 ? notes : undefined,
		};
	}

	throw new Error(`Codex CLI transport '${transport}' is not supported yet.`);
}

async function runCodexCliTask(
	name: string,
	transport: InstallTransport,
	payload: InstallCommandPayload,
): Promise<void> {
	const codexBinary = "codex";
	const command = buildCodexCliCommand(name, transport, payload);
	const commandArgs = command.args;
	const clipboardCommand = [codexBinary, ...commandArgs].map(shellQuote).join(" ");
	outputLogger.info("Running Codex CLI", { name, transport, commandArgs });

	const env = {
		...createSpawnEnvWithAugmentedPath(),
		...(command.spawnEnvOverrides ?? {}),
	};
	let stdout = "";
	let stderr = "";

	await new Promise<void>((resolve, reject) => {
		const child = spawn(codexBinary, commandArgs, { env });
		const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
		statusBar.text = `$(sync~spin) Installing MCP Server '${name}'...`;
		statusBar.tooltip = "Codex CLI is running";
		statusBar.show();
		const scheduleDispose = () => {
			setTimeout(() => statusBar.dispose(), 5000);
		};
		if (child.stdout) {
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
		}

		if (child.stderr) {
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
		}

		child.on("error", (error) => {
			outputLogger.error("Failed to start Codex CLI", error);
			statusBar.text = `$(error) Failed to start '${name}' install.`;
			statusBar.tooltip = error instanceof Error ? error.message : undefined;
			scheduleDispose();
			reject(error);
		});

		child.on("close", async (code) => {
			const trimmedStdout = stdout.trim();
			const trimmedStderr = stderr.trim();

			if (code === 0) {
				statusBar.text = `$(check) MCP Server '${name}' installed successfully.`;
				statusBar.tooltip = "Codex CLI completed";
				scheduleDispose();
				const messageParts: string[] = [`Codex CLI install succeeded for '${name}'.`];
				if (trimmedStdout) {
					messageParts.push(`Output:\n${trimmedStdout}`);
				}
				if (command.postInstallNotes) {
					messageParts.push(...command.postInstallNotes);
				}
				void vscode.window.showInformationMessage(messageParts.join("\n\n"));
				resolve();
				return;
			}

			const failureMessage = trimmedStderr || "Codex CLI reported an error. Check the Output panel for details.";
			statusBar.text = `$(error) Failed to install '${name}'.`;
			statusBar.tooltip = failureMessage;
			scheduleDispose();
			const actions: string[] = ["Copy Command"];
			if (command.postInstallNotes && command.postInstallNotes.length > 0) {
				actions.push("View Notes");
			}
			const selectedAction = await vscode.window.showErrorMessage(
				`Codex CLI install failed for '${name}'. ${failureMessage}`,
				...actions,
			);
			if (selectedAction === "Copy Command") {
				try {
					await vscode.env.clipboard.writeText(clipboardCommand);
					void vscode.window.showInformationMessage("Codex CLI command copied to your clipboard.");
				} catch (clipboardError) {
					outputLogger.warn("Failed to copy Codex CLI command to clipboard", clipboardError);
				}
			} else if (selectedAction === "View Notes" && command.postInstallNotes) {
				void vscode.window.showInformationMessage(command.postInstallNotes.join("\n\n"));
			}
			const error = new Error(`Codex CLI exited with code ${code}`);
			outputLogger.error("Codex CLI exited with non-zero code", error, { stdout, stderr });
			reject(error);
		});
	});
}


export class CopilotMcpViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "copilotMcpView";
	public static readonly launcherViewType = "copilotMcpLauncherView";
	private static readonly secondarySidebarContainerId = "copilotMcpSidebar";
	octokit: any;

	constructor(
		private readonly _extensionUri: vscode.Uri
	) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		if (webviewView.viewType === CopilotMcpViewProvider.launcherViewType) {
			this.configureLauncherView(webviewView);
			return;
		}

		this.configureWebviewView(webviewView);
	}

	private configureLauncherView(webviewView: vscode.WebviewView) {
		webviewView.webview.options = {
			enableScripts: false,
			localResourceRoots: [this._extensionUri],
		};
		webviewView.webview.html = this._getLauncherHtml(webviewView.webview);

		const scheduleRedirect = () => {
			// Switching containers during view resolve can be ignored by VS Code.
			// Retry a few times to reliably jump to the secondary container.
			const delays = [0, 150, 600];
			for (const delay of delays) {
				setTimeout(() => {
					void this.revealSecondarySidebar();
				}, delay);
			}
		};

		scheduleRedirect();
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				scheduleRedirect();
			}
		});
	}

	private async revealSecondarySidebar() {
		const containerCommand = `workbench.view.extension.${CopilotMcpViewProvider.secondarySidebarContainerId}`;
		const lowercaseContainerCommand = `workbench.view.extension.${CopilotMcpViewProvider.secondarySidebarContainerId.toLowerCase()}`;
		try {
			await vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
		} catch (error) {
			outputLogger.warn("Failed to focus Secondary Side Bar before opening container", error as Error);
		}
		try {
			await vscode.commands.executeCommand(containerCommand);
		} catch (error) {
			outputLogger.warn("Failed to reveal Copilot MCP Secondary Side Bar via primary command", error as Error);
			try {
				await vscode.commands.executeCommand(lowercaseContainerCommand);
			} catch (fallbackError) {
				outputLogger.warn("Failed to reveal Copilot MCP Secondary Side Bar via fallback command", fallbackError as Error);
			}
		}
		try {
			await vscode.commands.executeCommand("workbench.view.explorer");
		} catch (error) {
			outputLogger.warn("Failed to switch primary sidebar away from launcher", error as Error);
		}
		try {
			await vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
		} catch (error) {
			outputLogger.warn("Failed to focus Secondary Side Bar", error as Error);
		}
	}

	private configureWebviewView(
		webviewView: vscode.WebviewView
	) {
		const messenger = new Messenger();
		messenger.registerWebviewView(webviewView);
		const webviewType = webviewView.viewType;

		messenger.onRequest(searchServersType, async (payload) => {
			const searchResponse = await searchMcpServers2({
				query: payload.query,
				page: payload.page,
				language: payload.language,
				sort: payload.sort,
			});
			const results = searchResponse?.results || [];
			const totalCount = searchResponse?.totalCount || 0;
			
			// Log webview search with standardized telemetry
			logWebviewSearch(payload.query, totalCount);
			
			// Return the response immediately without cloudMcpDetails
			// Individual repo cards will fetch their own CloudMCP details
			return { 
				results, 
				totalCount, 
				pageInfo: searchResponse.pageInfo 
			};
		});

		messenger.onRequest(getMcpConfigType, async () => {
			// Ensure "mcp-server-time" is handled correctly if it's a global temporary server
			await deleteServer("mcp-server-time", true); // Pass a flag to suppress info for this specific server
			const servers = await getAllServers();
			return { servers };
		});

		messenger.onRequest(aiAssistedSetupType, async (payload) => {
			// Log AI assisted setup attempt with standardized telemetry
			logWebviewInstallAttempt(payload.repo?.fullName || payload.repo?.name || 'unknown');
			startPerformanceTimer('ai-setup');
			
			try {
				let setupResult;
				
				// Check if we have CloudMCP details with install configuration
				// Fall back to parsing README with LM
				const readmeToParse = payload.repo.readme;
				if (!readmeToParse) {
					vscode.window.showErrorMessage(
						"Neither CloudMCP details nor README content is available for installation."
					);
					return false;
				}
				
				setupResult = await this.vscodeLMResponse(
					readmeToParse,
					payload.repo?.url
				);
				
				if (setupResult) {
					// Log successful AI assisted setup
					logWebviewAiSetupSuccess(payload.repo.url);
					endPerformanceTimer('ai-setup', TelemetryEvents.PERFORMANCE_AI_SETUP, {
						success: true,
						repoName: payload.repo?.fullName || payload.repo?.name || 'unknown',
						usedCloudMcp: !!payload.cloudMcpDetails,
					});
					return true;
				} else {
					// Log failed AI assisted setup
					logWebviewAiSetupError('Setup failed - no result returned');
					endPerformanceTimer('ai-setup', TelemetryEvents.PERFORMANCE_AI_SETUP, {
						success: false,
						repoName: payload.repo?.fullName || payload.repo?.name || 'unknown',
						usedCloudMcp: !!payload.cloudMcpDetails,
					});
					return false;
				}
			} catch (error) {
				console.error("Error during AI Assisted Setup: ", error);
				
				// Log error with standardized error telemetry
				logWebviewAiSetupError(error as Error);
				endPerformanceTimer('ai-setup', TelemetryEvents.PERFORMANCE_AI_SETUP, {
					success: false,
					repoName: payload.repo?.fullName || payload.repo?.name || 'unknown',
					error: true,
					usedCloudMcp: !!payload.cloudMcpDetails,
				});
				
				// Notify webview about the error
				return false;
			}
		});

		// Direct install path from structured config (Official Registry results)
                messenger.onRequest(installFromConfigType, async (payload) => {
                        try {
                                logWebviewInstallAttempt(payload.name);
                                return await performVscodeInstall(payload);
                        } catch (error) {
                                console.error("Error during direct install: ", error);
                                logError(error as Error, "registry-install", { target: "vscode" });
                                return false;
                        }
                });

                messenger.onRequest(installClaudeFromConfigType, async (payload: ClaudeInstallRequest) => {
                        logWebviewInstallAttempt(payload.name);
                        const { values, canceled } = await collectInstallInputs(payload.inputs);
                        if (canceled) {
                                void vscode.window.showInformationMessage("Claude installation canceled.");
                                return;
                        }

                        const substitutedPayload = applyInputsToPayload(payload, values);

                        try {
                                const config = buildClaudeConfigObject(substitutedPayload, payload.transport);
                                await runClaudeCliTask(payload.name, payload.transport, config);
                        } catch (error) {
                                logError(error as Error, "claude-cli-install", {
                                        transport: payload.transport,
                                        mode: payload.mode,
                                });
                                void vscode.window.showErrorMessage(
                                        error instanceof Error
                                                ? error.message
                                                : "Claude CLI failed to start. Check the terminal output.",
                                );
                        }
                });

                messenger.onRequest(installCodexFromConfigType, async (payload: CodexInstallRequest) => {
                        logWebviewInstallAttempt(payload.name);
                        const { values, canceled } = await collectInstallInputs(payload.inputs);
                        if (canceled) {
                                void vscode.window.showInformationMessage("Codex installation canceled.");
                                return;
                        }

                        const substitutedPayload = applyInputsToPayload(payload, values);

                        try {
                                await runCodexCliTask(payload.name, payload.transport, substitutedPayload);
                        } catch (error) {
                                logError(error as Error, "codex-cli-install", {
                                        transport: payload.transport,
                                        mode: payload.mode,
                                });
                                void vscode.window.showErrorMessage(
                                        error instanceof Error
                                                ? error.message
                                                : "Codex CLI failed to start. Check the terminal output.",
                                );
                        }
                });

		// Official Registry search proxied via extension (avoids webview CORS)
		messenger.onRequest(registrySearchType, async (payload) => {
			try {
				const params: Record<string, any> = {
					version: 'latest',
					limit: payload.limit ?? 10,
					search: payload.search,
				};
                                if (payload.cursor) {
                                        params.cursor = payload.cursor;
                                }
				const res = await axios.get('https://registry.modelcontextprotocol.io/v0/servers', { params });
				const data = res?.data ?? {};
				return {
					servers: data.servers ?? [],
					metadata: data.metadata ?? {},
				};
			} catch (error) {
				console.error('Registry search failed', error);
				return { servers: [], metadata: {} };
			}
		});

		messenger.onRequest(skillsSearchType, async (payload) => {
			const query = payload.query.trim();
			const page = Math.max(1, Math.floor(payload.page ?? 1));
			const pageSize = Math.max(1, Math.floor(payload.pageSize ?? 10));

			if (!query) {
				return {
					items: [],
					page,
					pageSize,
					hasMore: false,
					fetchedCount: 0,
				};
			}

			try {
				const result = await searchSkills(query, { page, pageSize });
				logWebviewSearch(query, result.fetchedCount);
				return {
					items: result.items,
					page: result.page,
					pageSize: result.pageSize,
					hasMore: result.hasMore,
					fetchedCount: result.fetchedCount,
				};
			} catch (error) {
				logError(error as Error, "skills-search", { provider: "skills" });
				throw error;
			}
		});

		messenger.onRequest(skillsListFromSourceType, async (payload) => {
			const source = payload.source.trim();
			if (!source) {
				throw new Error("Source is required");
			}

			try {
				const skills = await listSkillsFromSource(source, {
					fullDepth: true,
					includeInternal: false,
				});
				return { source, skills };
			} catch (error) {
				logError(error as Error, "skills-list-from-source", { source });
				throw error;
			}
		});

		messenger.onRequest(skillsGetAgentsType, async () => {
			const detectedAgents = await detectInstalledAgents();
			const detectedSet = new Set(detectedAgents);

			const skillAgents = (Object.keys(availableSkillAgents) as AgentType[])
				.map((id) => ({
					id,
					displayName: availableSkillAgents[id].displayName,
					detected: detectedSet.has(id),
					supportsGlobal: availableSkillAgents[id].globalSkillsDir !== undefined,
				}))
				.sort((a, b) => {
					if (a.detected !== b.detected) {
						return a.detected ? -1 : 1;
					}
					return a.displayName.localeCompare(b.displayName);
				});

			return {
				agents: skillAgents,
				detectedAgents,
			};
		});

		messenger.onRequest(skillsInstallType, async (payload: SkillsInstallRequest) => {
			const source = payload.source.trim();
			if (!source) {
				throw new Error("Source is required");
			}

			const selectedSkillNames = payload.selectedSkillNames
				.map((name) => name.trim())
				.filter((name) => name.length > 0);
			if (selectedSkillNames.length === 0) {
				throw new Error("Select at least one skill to install");
			}

			const isGlobalInstall = payload.installScope === "global";
			const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!isGlobalInstall && !workspaceCwd) {
				throw new Error(
					"Project installs require an open workspace folder. Open a folder or switch to Global scope."
				);
			}
			const knownAgentIds = new Set(Object.keys(availableSkillAgents));
			const detectedAgents = await detectInstalledAgents();
			const detectedAgentSet = new Set(detectedAgents);

			let targetAgents: AgentType[];
			if (payload.installAllAgents) {
				targetAgents = isGlobalInstall
					? detectedAgents.filter((agent) => availableSkillAgents[agent].globalSkillsDir !== undefined)
					: detectedAgents;
			} else {
				const requestedAgents = payload.selectedAgents.filter((agent): agent is AgentType =>
					knownAgentIds.has(agent) && detectedAgentSet.has(agent)
				);
				targetAgents = isGlobalInstall
					? requestedAgents.filter((agent) => availableSkillAgents[agent].globalSkillsDir !== undefined)
					: requestedAgents;
			}

			if (Array.isArray(targetAgents) && targetAgents.length === 0) {
				throw new Error("No compatible agents selected for this install scope");
			}

			try {
				logWebviewInstallAttempt(payload.searchItem.name);
				return await addSkillsFromSource(source, {
					skillNames: selectedSkillNames,
					agents: targetAgents,
					global: isGlobalInstall,
					cwd: isGlobalInstall ? undefined : workspaceCwd,
					fullDepth: true,
					includeInternal: false,
				});
			} catch (error) {
				logError(error as Error, "skills-install", {
					source,
					installScope: payload.installScope,
					allAgents: payload.installAllAgents,
				});
				throw error;
			}
		});

		messenger.onRequest(skillsListInstalledType, async () => {
			const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const listOptions = workspaceCwd ? { cwd: workspaceCwd } : { global: true as const };

			try {
				const installedSkills = await listInstalledSkills(listOptions);
				const sortedSkills = [...installedSkills].sort((a, b) => {
					if (a.scope !== b.scope) {
						return a.scope === "project" ? -1 : 1;
					}
					return a.name.localeCompare(b.name);
				});

				return {
					skills: sortedSkills.map((skill) => {
						const normalizedAgents = Array.from(new Set(skill.agents))
							.filter((agent): agent is AgentType => Boolean(availableSkillAgents[agent]))
							.sort((a, b) =>
								availableSkillAgents[a].displayName.localeCompare(
									availableSkillAgents[b].displayName
								)
							);

					return {
							name: skill.name,
							description: skill.description,
							path: skill.path,
							canonicalPath: skill.canonicalPath,
							scope: skill.scope,
							agents: normalizedAgents,
							...getInstalledSkillUninstallPolicy(skill.scope, normalizedAgents, workspaceCwd),
						};
					}),
				};
			} catch (error) {
				logError(error as Error, "skills-list-installed", { hasWorkspace: Boolean(workspaceCwd) });
				throw error;
			}
		});

		messenger.onRequest(skillsUninstallType, async (payload: SkillsUninstallRequest) => {
			const skillName = payload.skillName.trim();
			if (!skillName) {
				throw new Error("Skill name is required");
			}

			const scope = payload.scope;
			const isGlobalUninstall = scope === "global";
			const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!isGlobalUninstall && !workspaceCwd) {
				throw new Error(
					"Project uninstalls require an open workspace folder. Open a folder or switch to Global scope."
				);
			}

			const installedSkills = await listInstalledSkills(
				isGlobalUninstall
					? { global: true }
					: { global: false, cwd: workspaceCwd }
			);

			const installedSkill = installedSkills.find(
				(skill) => skill.scope === scope && skill.name === skillName
			);

			if (!installedSkill) {
				throw new Error(`Skill "${skillName}" is not installed in ${scope} scope.`);
			}

			const installedAgentSet = new Set(installedSkill.agents);
			const selectedAgents = Array.from(
				new Set(
					payload.selectedAgents.filter(
						(agent): agent is AgentType =>
							Boolean(availableSkillAgents[agent]) && installedAgentSet.has(agent)
					)
				)
			);

			if (selectedAgents.length === 0) {
				throw new Error("Select at least one installed agent to uninstall.");
			}

			const uninstallPolicy = getInstalledSkillUninstallPolicy(
				scope,
				installedSkill.agents,
				workspaceCwd
			);
			const selectedAgentSet = new Set(selectedAgents);
			const selectedAllInstalledAgents = installedSkill.agents.every((agent) =>
				selectedAgentSet.has(agent)
			);

			if (uninstallPolicy.uninstallPolicy === "all-agents" && !selectedAllInstalledAgents) {
				throw new Error(
					uninstallPolicy.uninstallPolicyReason ??
						"This skill requires uninstalling from all listed agents at once."
				);
			}

			const targetAgents =
				uninstallPolicy.uninstallPolicy === "all-agents"
					? installedSkill.agents
					: selectedAgents;

			try {
				return await uninstallInstalledSkill({
					skillName: installedSkill.name,
					agents: targetAgents,
					global: isGlobalUninstall,
					cwd: isGlobalUninstall ? undefined : workspaceCwd,
				});
			} catch (error) {
				logError(error as Error, "skills-uninstall", {
					skillName: installedSkill.name,
					scope,
					selectedAgentCount: targetAgents.length,
				});
				throw error;
			}
		});

		messenger.onNotification(updateServerEnvVarType, async (payload) => {
			try {
				const { serverName, envKey, newValue } = payload;
				const config = vscode.workspace.getConfiguration("mcp");
				const globalServersInspect = config.inspect<Record<string, any>>("servers");
				let globalServers = globalServersInspect?.globalValue || {};

				if (globalServers[serverName]) {
					const updatedGlobalServers = { ...globalServers };
					if (!updatedGlobalServers[serverName].env) {
						updatedGlobalServers[serverName].env = {};
					}
					updatedGlobalServers[serverName].env[envKey] = newValue;
					await config.update("servers", updatedGlobalServers, vscode.ConfigurationTarget.Global);
					// Optionally, inform webview to refresh if needed, or rely on onDidChangeConfiguration
				} else {
					vscode.window.showErrorMessage(
						`Server '${serverName}' not found in global user settings. Cannot update environment variable.`
					);
				}
			} catch (error) {
				console.error("Error updating server env var: ", error);
				// Log error with standardized telemetry
				logError(error as Error, 'server-env-var-update', {
					serverName: payload.serverName,
					envKey: payload.envKey,
				});
				vscode.window.showErrorMessage("Error updating server environment variable.");
			}
		});

		messenger.onNotification(deleteServerType, async (payload) => {
			try {
				await deleteServer(payload.serverName);
				
				// Log successful server deletion
				logEvent({
					name: 'webview.server.deleted',
					properties: {
						serverName: payload.serverName,
						success: true,
					},
				});
				
				// After deletion, tell the webview to re-fetch the config
				const currentServers = await getAllServers();
				messenger.sendNotification(
					updateMcpConfigType,
					{ type: "webview", webviewType },
					{
						servers: currentServers,
					}
				);
			} catch (error) {
				console.error("Error deleting server: ", error);
				
				// Log server deletion error
				logError(error as Error, 'server-deletion', {
					serverName: payload.serverName,
				});
				
				vscode.window.showErrorMessage("Error deleting server.");
			}
		});

		messenger.onNotification(sendFeedbackType, async () => {
			// Log feedback submission with standardized telemetry
			logWebviewFeedbackSent('general');
			vscode.window.showInformationMessage(
				`Feedback submitted. Thank you!`
			);
		});

		messenger.onNotification(cloudMCPInterestType, async (payload) => {
			// Log CloudMCP interest with telemetry
			logEvent({
				name: 'webview.cloudmcp.interest',
				properties: {
					repoName: payload.repoName,
					repoOwner: payload.repoOwner,
					repoUrl: payload.repoUrl,
					timestamp: payload.timestamp,
				},
			});

			// Redirect to the main CloudMCP dashboard with tracking parameters
			const deployUrl = 'https://cloudmcp.run/dashboard?utm_source=copilot-mcp&utm_medium=vscode&utm_campaign=deploy';
			
			// Open external URL with proper referrer tracking
			await vscode.env.openExternal(vscode.Uri.parse(deployUrl));
			
		});

		messenger.onNotification(previewReadmeType, async (payload) => {
			// Create a temporary markdown file with the README content
			const tempUri = vscode.Uri.parse(`untitled:${payload.fullName}-README.md`);
			const document = await vscode.workspace.openTextDocument(tempUri);
			const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
			
			// Insert the README content
			await editor.edit(editBuilder => {
				editBuilder.insert(new vscode.Position(0, 0), `# ${payload.fullName}\n\n${payload.readme}`);
			});
			
			// Show the markdown preview
			await vscode.commands.executeCommand('markdown.showPreview', tempUri);
		});

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e.affectsConfiguration("mcp.servers")) {
				// Also check if a .vscode/mcp.json might have changed. This is harder to detect directly.
				// For simplicity, we re-fetch all if mcp.servers (from settings) changes.
				// A more robust solution might involve file watchers for .vscode/mcp.json.
				const currentServers = await getAllServers();
				messenger.sendNotification(
					updateMcpConfigType,
					{ type: "webview", webviewType },
					{
						servers: currentServers,
					}
				);
			}
		});

		// All message handling is now done through vscode-messenger
		// No need for legacy onDidReceiveMessage handler
		webviewView.show(false);
	}

	async getOctokit() {
		if (this.octokit) {
			return this.octokit;
		}
		let session: vscode.AuthenticationSession | undefined;
		try {
			session = await vscode.authentication.getSession(
				GITHUB_AUTH_PROVIDER_ID,
				SCOPES,
				{ createIfNone: true }
			);
		} catch (error) {
			outputLogger.warn("Failed to acquire GitHub session for Octokit", error as Error);
			throw new Error("GitHub authentication is required to continue.");
		}
		const accessToken = session?.accessToken;
		if (!accessToken) {
			throw new Error("GitHub authentication is required to continue.");
		}
		const Octokit = await import("octokit");
		this.octokit = new Octokit.Octokit({
			auth: accessToken,
		});
		return this.octokit;
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// The CSS file from the React build output
		const stylesUri = getUri(webview, this._extensionUri, [
			"web",
			"dist",
			"assets",
			"index.css",
		]);
		// The JS file from the React dist output
		const scriptUri = getUri(webview, this._extensionUri, [
			"web",
			"dist",
			"assets",
			"index.js",
		]);
		const assetBaseUri = getUri(webview, this._extensionUri, [
			"web",
			"dist",
			"assets",
		]);
		webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		const nonce = getNonce();
		const initialState = {
			assetBaseUri: assetBaseUri.toString(),
		};
		return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource} https:;">
			<link rel="stylesheet" type="text/css" href="${stylesUri}">
			<title>Hello World</title>
		  </head>
		  <body>
			<div id="root"></div>
			<script nonce="${nonce}">window.__MCP_WEBVIEW__ = ${JSON.stringify(initialState)};</script>
			<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
		  </body>
		</html>
	  `;
	}

	private _getLauncherHtml(webview: vscode.Webview): string {
		return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource};">
            <style>
              body {
                margin: 0;
                padding: 12px;
                color: var(--vscode-foreground);
                background: var(--vscode-sideBar-background);
                font-family: var(--vscode-font-family);
                font-size: 12px;
              }
            </style>
          </head>
          <body>
            Opening Copilot MCP in Secondary Side Bar...
          </body>
        </html>
      `;
	}

	public async vscodeLMResponse(
		readme: string,
		repoURL?: string
	) {
		return await vscode.window.withProgress(
			{
				title: "Installing MCP server with Copilot",
				location: vscode.ProgressLocation.Notification,
			},
			async (progress) => {
				try {
					progress.report({
						message: `Adding server to config...`,
					});
					const object = await readmeExtractionRequest(readme);
					console.dir(object, { depth: null, colors: true });
					progress.report({
						message: `Configuring server...`,
					});
					const cmdResponse = await openMcpInstallUri(object);
					console.log("CMD RESPONSE: ", cmdResponse);
					if (cmdResponse && cmdResponse.uri) {
						// Log install URI opened with standardized telemetry
						logWebviewInstallUriOpened(cmdResponse.uri);
					}
					progress.report({
						message: `Added MCP Server`,
					});
					return object;
					// return object.object;
				} catch (err: any) {
					// Log error with standardized error telemetry
					logError(err, 'ai-assisted-setup', {
						context: 'setup-execution',
					});
					// Making the chat request might fail because
					// - model does not exist
					// - user consent not given
					// - quota limits were exceeded
					if (err instanceof vscode.LanguageModelError) {
						console.log(err.message, err.code, err.cause);
						if (
							err.cause instanceof Error &&
							err.cause.message.includes("off_topic")
						) {
							console.log("off_topic");
						}
					} else {
						// add other error handling logic
						throw err;
					}
				}
			}
		);
	}
}


// This function is deprecated by direct use of getAllServers in the getMcpConfigType handler
// and onDidChangeConfiguration. The webview will be updated with the full merged list.
// async function sendServers(webviewView: vscode.WebviewView) {
//   await deleteServer("mcp-server-time", true); // Suppress info for this specific server
//   const allServers = await getAllServers();
//   webviewView.webview.postMessage({
//     type: "receivedMCPConfigObject",
//     data: { servers: allServers },
//   });
//   return allServers;
// }

// This function is effectively replaced by getAllServers() for read operations.
// function localGetServers() {
//   return getAllServers();
// }

async function deleteServer(
	serverKeyToDelete: string,
	suppressUserNotification: boolean = false
) {
	const config = vscode.workspace.getConfiguration("mcp");
	const globalServersInspect = config.inspect<Record<string, any>>("servers");
	let globalServers = globalServersInspect?.globalValue || {};

	if (globalServers[serverKeyToDelete]) {
		const updatedGlobalServers = { ...globalServers }; // Create a new object
		delete updatedGlobalServers[serverKeyToDelete];
		
		try {
			// Special handling for "mcp-server-time" if it's an internal mechanism
			// This check was inside the original deleteServer, ensuring it's also removed if present.
			if (updatedGlobalServers["mcp-server-time"]) {
				delete updatedGlobalServers["mcp-server-time"];
			}

			await config.update(
				"servers",
				updatedGlobalServers,
				vscode.ConfigurationTarget.Global
			);

			if (serverKeyToDelete !== "mcp-server-time" && !suppressUserNotification) {
				vscode.window.showInformationMessage(
					`Server '${serverKeyToDelete}' deleted from global settings.`
				);
			}
		} catch (error: unknown) {
			if (!suppressUserNotification) {
				vscode.window.showErrorMessage(`Error deleting server '${serverKeyToDelete}' from global settings.`);
			}
			console.error(`Error deleting server '${serverKeyToDelete}':`, error);
		}
	} else {
		if (serverKeyToDelete !== "mcp-server-time" && !suppressUserNotification) {
			// vscode.window.showInformationMessage( // Changed to warning or simply log, as it might exist in workspace
			//   `Server '${serverKeyToDelete}' not found in global settings.`
			// );
			console.log(`Server '${serverKeyToDelete}' not found in global settings for deletion.`);
		}
	}
}
