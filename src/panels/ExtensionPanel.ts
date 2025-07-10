import * as vscode from "vscode";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { getReadme, searchMcpServers, type McpServerResult } from "../utilities/repoSearch";
import { type TelemetryReporter } from "@vscode/extension-telemetry";
import { CopilotChatProvider } from "../utilities/CopilotChat";
import { dspyExamples } from "../utilities/const";
import { AxGen } from "@ax-llm/ax";
import { openMcpInstallUri, readmeExtractionRequest } from "../McpAgent";
import { getLogger } from "../telemetry";
import { cloudMcpIndexer } from "../utilities/cloudMcpIndexer";
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
	getReadmeType,
	searchServersType,
	sendFeedbackType,
	updateMcpConfigType,
	updateServerEnvVarType,
	cloudMCPInterestType,
	checkCloudMcpType,
} from "../shared/types/rpcTypes";

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


export class CopilotMcpViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "copilotMcpView";
	octokit: any;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _accessToken: string,
		private readonly _telemetryReporter: TelemetryReporter,
		private readonly _session: vscode.AuthenticationSession
	) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		const messenger = new Messenger();
		messenger.registerWebviewView(webviewView);

		messenger.onRequest(searchServersType, async (payload) => {
			const page = payload.page || 1;
			const perPage = payload.perPage || 10;
			
			const searchResponse = await searchMcpServers({
				query: payload.query,
				page,
				perPage,
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
				currentPage: page, 
				perPage
			};
		});

		messenger.onRequest(checkCloudMcpType, async (payload) => {
			const { repoUrl, repoName, repoFullName } = payload;
			
			try {
				// Check single repository with CloudMCP
				const result = await cloudMcpIndexer.checkSingleRepository({
					url: repoUrl,
					name: repoName,
					fullName: repoFullName
				});
				
				// Return the CloudMCP check result directly
				return result;
			} catch (error) {
				console.error("Error checking CloudMCP for repository:", error);
				return {
					success: false,
					exists: false,
					error: error instanceof Error ? error.message : 'Unknown error'
				};
			}
		});

		messenger.onRequest(getReadmeType, async (payload) => {
			console.log("getReadmeType", payload);
			const { fullName, owner, name } = payload;
			try {
				const readmeContent = await getReadme({
					repoOwner: owner.login,
					repoName: name,
				});

				return { readme: readmeContent, fullName };
			} catch (e) {
				console.error("Error getting readme", e);
				
				// Log README fetch error with standardized telemetry
				logError(e as Error, 'readme-fetch', {
					fullName,
					repoOwner: owner.login,
					repoName: name,
				});
				
				return { readme: "", fullName };
			}
		});

		messenger.onRequest(getMcpConfigType, async (payload) => {
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
				if (payload.cloudMcpDetails && payload.cloudMcpDetails.success && payload.cloudMcpDetails.installConfig) {
					console.log("Using CloudMCP installation configuration", payload);
					
					// Use the installConfig directly - it's already in the right format
					const installConfig = payload.cloudMcpDetails.installConfig;
					
					const cmdResponse = await openMcpInstallUri(installConfig);
					console.log("CMD RESPONSE: ", cmdResponse);
					
					if (cmdResponse && cmdResponse.uri) {
						logWebviewInstallUriOpened(cmdResponse.uri);
					}
					
					setupResult = installConfig;
				} else {
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
						payload.repo?.fullName
					);
				}
				
				if (setupResult) {
					// Log successful AI assisted setup
					logWebviewAiSetupSuccess();
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

		messenger.onNotification(sendFeedbackType, async (payload) => {
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
					timestamp: payload.timestamp,
				},
			});
			
			// Show notification to user
			vscode.window.showInformationMessage(
				`Thanks for your interest in CloudMCP.run! We'll notify you when it's available. This service will allow you to deploy ${payload.repoName} to the cloud with one click.`,
				{ modal: false }
			);
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
		// if(vscode.)
		// vscode.window.showInformationMessage("Help shape Copilot MCP Pro → 60-sec poll", {modal: true, detail: 'Let us know what features you would want to see from a Pro plan'}, "Cloud hosting ☁️", "Team sharing 🤝", "Enterprise security 🔒")
		// .then((response?: string) => {
		//     getLogger().logUsage('pro.features.poll', {response, accountId: this._session.account.id,
		//         accountLabel: this._session.account.label,});
		// });

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
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:;">
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
		repoFullName?: string
	) {
		return await vscode.window.withProgress(
			{
				title: "Installing MCP server with Copilot...",
				location: vscode.ProgressLocation.Notification,
			},
			async (progress, token) => {
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

async function parseChatResponse(
	chatResponse: vscode.LanguageModelChatResponse
) {
	let accumulatedResponse = "";

	for await (const fragment of chatResponse.text) {
		accumulatedResponse += fragment;

		// if the fragment is a }, we can try to parse the whole line
		if (fragment.includes("}")) {
			try {
				const parsedResponse = JSON.parse(accumulatedResponse);
				return parsedResponse;
			} catch (e) {
				// do nothing
			}
		}
		// return accumulatedResponse;
	}
	console.log("accumulatedResponse", accumulatedResponse);
	if (accumulatedResponse.startsWith("```json")) {
		const jsonString = accumulatedResponse
			.replace("```json", "")
			.replace("```", "");
		const parsedResponse = JSON.parse(jsonString);
		return parsedResponse;
	}
	return accumulatedResponse;
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
