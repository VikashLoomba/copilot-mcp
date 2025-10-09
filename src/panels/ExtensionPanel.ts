import * as vscode from "vscode";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { searchMcpServers2 } from "../utilities/repoSearch";
import { type TelemetryReporter } from "@vscode/extension-telemetry";
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
        registrySearchType,
} from "../shared/types/rpcTypes";
import type {
        InstallCommandPayload,
        InstallInput,
        InstallTransport,
        ClaudeInstallRequest,
} from "../shared/types/rpcTypes";
import axios from "axios";
import { outputLogger } from "../utilities/outputLogger";
import { resolve } from "dns";

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

async function runClaudeCliTask(
        name: string,
        transport: InstallTransport,
        config: Record<string, unknown>,
): Promise<void> {
        const claudeBinary = "claude";
        const configJson = JSON.stringify(config);
		outputLogger.info("Config", config);

		const shellExecution = vscode.window.createTerminal({
			name: `Claude MCP Install (${name})`,
		});
		
		shellExecution.show();
		shellExecution.sendText(`${claudeBinary} mcp add-json ${name} '${configJson}'`);

		void vscode.window.showInformationMessage(
			"Claude CLI install started. See Terminal Output for progress.",
		);
}


export class CopilotMcpViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "copilotMcpView";
	octokit: any;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _accessToken: string	) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		const messenger = new Messenger();
		messenger.registerWebviewView(webviewView);

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
			await deleteServer(webviewView, "mcp-server-time", true); // Pass a flag to suppress info for this specific server
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
					webviewView,
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
				await deleteServer(webviewView, payload.serverName);
				
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
					{ type: "webview", webviewType: webviewView.viewType },
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
					{ type: "webview", webviewType: webviewView.viewType },
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
		const Octokit = await import("octokit");
		this.octokit = new Octokit.Octokit({
			auth: this._accessToken,
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
		webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		const nonce = getNonce();
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
			<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
		  </body>
		</html>
	  `;
	}

	public async vscodeLMResponse(
		readme: string,
		webviewView?: vscode.WebviewView,
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
//   await deleteServer(webviewView, "mcp-server-time", true); // Suppress info for this specific server
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
	webviewView: vscode.WebviewView, // webviewView might not be needed if not posting message from here
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
