import * as vscode from "vscode";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { getReadme, searchMcpServers } from "../utilities/repoSearch";
import { type TelemetryReporter } from "@vscode/extension-telemetry";
import { CopilotChatProvider } from "../utilities/CopilotChat";
import { dspyExamples } from "../utilities/const";
import { AxGen } from "@ax-llm/ax";
import { openMcpInstallUri, readmeExtractionRequest } from "../McpAgent";
import { getLogger } from "../telemetry";
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
} from "../shared/types/rpcTypes";

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
			getLogger().logUsage("searchMcpServers", {
				query: payload.query,
				accountId: this._session.account.id,
				accountLabel: this._session.account.label,
			});
			return { results, totalCount, currentPage: page, perPage };
		});

		messenger.onRequest(getReadmeType, async (payload) => {
			console.log("getReadmeType", payload);
			const { fullName, owner, name } = payload;
			try {
				const readmeContent = await getReadme({
					repoOwner: owner.login,
					repoName: name,
				});
				console.log("readmeContent", readmeContent);
				return { readme: readmeContent, fullName };
			} catch (e) {
				console.error("Error getting readme", e);
				return { readme: "", fullName };
			}
		});

		messenger.onRequest(getMcpConfigType, async (payload) => {
			const servers = await sendServers(webviewView);
			return { servers };
		});

		messenger.onRequest(aiAssistedSetupType, async (payload) => {
			getLogger().logUsage("attemptMcpServerInstall", {
				repoId: payload.repo?.id,
				repoName: payload.repo?.name,
				repoUrl: payload.repo?.url.split("//")[1],
			});
			// Expecting payload.repo and payload.readme
			const readmeToParse = payload.repo.readme;
			if (!readmeToParse) {
				vscode.window.showErrorMessage(
					"README content is missing in aiAssistedSetup message."
				);
				return false;
			}

			try {
				const result = await this.vscodeLMResponse(
					readmeToParse,
					webviewView,
					payload.repo?.fullName
				);
				if (result) {
					getLogger().logUsage("aiAssistedSetupSuccess", {
						repoId: payload.repo?.id,
						repoName: payload.repo?.name,
						repoUrl: payload.repo?.url.split("//")[1],
					});
					return true;
				} else {
					getLogger().logUsage("aiAssistedSetupError", {
						repoId: payload.repo?.id,
						repoName: payload.repo?.name,
						repoUrl: payload.repo?.url.split("//")[1],
					});
					return false;
				}
			} catch (error) {
				console.error("Error during AI Assisted Setup: ", error);
				getLogger().logError("aiAssistedSetupError", {
					repoId: payload.repo?.id,
					repoName: payload.repo?.name,
					repoUrl: payload.repo?.url.split("//")[1],
				});
				// Notify webview about the error
				return false;
			}
		});

		messenger.onNotification(updateServerEnvVarType, async (payload) => {
			try {
				console.log("updateServer message: ", payload);
				const configKey = `mcp.servers.${payload.serverName}.env`;
				const config = vscode.workspace.getConfiguration(configKey);
				await config.update(payload.envKey, payload.newValue, vscode.ConfigurationTarget.Global);
			} catch (error) {
				console.error("Error updating server env var: ", error);
			}
		});

		messenger.onNotification(deleteServerType, async (payload) => {
			try {
				console.log("deleteServer message: ", payload);
				await deleteServer(webviewView, payload.serverName);
				messenger.sendNotification(
					updateMcpConfigType,
					{ type: "webview", webviewType: webviewView.viewType },
					{
						servers: localGetServers(),
					}
				);
			} catch (error) {
				console.error("Error deleting server: ", error);
			}
		});

		messenger.onNotification(sendFeedbackType, async (payload) => {
			getLogger().logUsage("sendFeedback", {
				feedback: payload.feedback,
			});
			vscode.window.showInformationMessage(
				`Feedback submitted. Thank you!`
			);
		});

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e.affectsConfiguration("mcp.servers")) {
				messenger.sendNotification(
					updateMcpConfigType,
					{ type: "webview", webviewType: webviewView.viewType },
					{
						servers: localGetServers(),
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

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				// case "deleteServer": {
				// 	const serverKeyToDelete = message.key;
				// 	if (!serverKeyToDelete) {
				// 		vscode.window.showErrorMessage(
				// 			"Server key to delete is missing."
				// 		);
				// 		// Optionally, inform the webview about the error
				// 		webviewView.webview.postMessage({
				// 			type: "error",
				// 			data: {
				// 				message: "Server key to delete is missing.",
				// 			},
				// 		});
				// 		return;
				// 	}

				// 	try {
				// 		await deleteServer(webviewView, serverKeyToDelete);
				// 	} catch (error) {}
				// 	break;
				// }
				// It's good practice to have a default case, even if just for logging
				default:
					console.warn(
						"Received unknown message type from webview:",
						message.type
					);
					break;
			}
		}, undefined);
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
					if (cmdResponse) {
						getLogger().logUsage("openedInstallURI", {
							server: JSON.stringify(object),
						});
					}
					progress.report({
						message: `Added MCP Server`,
					});
					return object;
					// return object.object;
				} catch (err: any) {
					getLogger().logUsage("error.aiAssistedSetup", {
						...err,
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

async function sendServers(webviewView: vscode.WebviewView) {
	await deleteServer(webviewView, "mcp-server-time");
	const config = vscode.workspace.getConfiguration("mcp");
	const servers = config.get("servers", {} as Record<string, any>);
	try {
		if (servers["mcp-server-time"]) {
			delete servers["mcp-server-time"];
		}
	} catch (error) {}
	webviewView.webview.postMessage({
		type: "receivedMCPConfigObject",
		data: { servers },
	});
	return servers;
}

function localGetServers() {
	const config = vscode.workspace.getConfiguration("mcp");
	const servers = config.get("servers", {} as Record<string, any>);
	return servers;
}

async function deleteServer(
	webviewView: vscode.WebviewView,
	serverKeyToDelete: string
) {
	const config = vscode.workspace.getConfiguration("mcp");
	let servers = config.get("servers", {} as Record<string, unknown>);

	if (servers[serverKeyToDelete]) {
		// Create a new object without the server to delete
		const updatedServers = { ...servers };
		delete updatedServers[serverKeyToDelete];
		try {
			if (updatedServers["mcp-server-time"]) {
				delete updatedServers["mcp-server-time"];
			}
		} catch (error) {}

		try {
			await config.update(
				"servers",
				updatedServers,
				vscode.ConfigurationTarget.Global
			);

			if (serverKeyToDelete !== "mcp-server-time") {
				vscode.window.showInformationMessage(
					`Server '${serverKeyToDelete}' deleted.`
				);
			}
		} catch (error: unknown) {}
	}
}
