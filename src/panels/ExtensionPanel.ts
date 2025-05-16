import * as vscode from "vscode";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { searchMcpServers } from "../utilities/repoSearch";
import { type TelemetryReporter } from "@vscode/extension-telemetry";
import { CopilotChatProvider } from "../utilities/CopilotChat";
import { dspyExamples } from "../utilities/const";
import { AxGen } from "@ax-llm/ax";
import { openMcpInstallUri, readmeExtractionRequest } from "../McpAgent";
import { getLogger } from "../telemetry";

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
		if (vscode.env.isNewAppInstall) {
			getLogger().logUsage("newUserInstall", {
				accountId: this._session.account.id,
				accountLabel: this._session.account.label,
			});
		}
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e.affectsConfiguration("mcp.servers")) {
				await sendServers(webviewView);
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
				case "getNewMcpServers": {
				}
				case "aiAssistedSetup": {
					getLogger().logUsage("attemptMcpServerInstall", {
						accountId: this._session.account.id,
						accountLabel: this._session.account.label,
						repoId: message.payload.repo?.id,
						repoName: message.payload.repo?.name,
						repoUrl: message.payload.repo?.url.split("//")[1],
					});
					// Expecting payload.repo and payload.readme
					const readmeToParse = message.payload.repo.readme;
					if (!readmeToParse) {
						vscode.window.showErrorMessage(
							"README content is missing in aiAssistedSetup message."
						);
						webviewView.webview.postMessage({
							type: "finishInstall", // Notify webview to stop loading
							payload: {
								fullName: message.payload.repo?.fullName,
							},
						});
						return;
					}

					try {
						const result = await this.vscodeLMResponse(
							readmeToParse,
							webviewView,
							message.payload.repo?.fullName
						);
						console.log("Result: ", result);
						// Potentially send a success message or the result back to the webview
					} catch (error) {
						console.error(
							"Error during AI Assisted Setup: ",
							error
						);
						// Notify webview about the error
					} finally {
						webviewView.webview.postMessage({
							type: "finishInstall",
							payload: {
								fullName: message.payload.repo?.fullName,
							}, // Send fullName for identification
						});
					}
					break;
				}
				case "updateServerEnvVar": {
					try {
						console.log("updateServer message: ", message);
						const configKey = `mcp.servers.${message.payload.serverName}.env`;
						const config =
							vscode.workspace.getConfiguration(configKey);
						await config.update(
							message.payload.envKey,
							message.payload.newValue
						);
					} catch (error) {}
					//   await sendServers(webviewView);
					break;
				}
				case "requestReadme": {
					const { fullName, owner, name } = message.payload; // repoUrl is kept for now, though not used for owner/repo extraction
					try {
						const octokit = await this.getOctokit();
						console.log("got teh repo backend: ", message.payload);
						console.log("LOGIN: ", owner.login);
						console.log("NAME: ", message.payload.name);
						// { owner: owner.login, name: message.payload.name }
						const readmeData = await octokit.request(
							`GET /repos/${owner.login}/${name}/readme`
						);
						const readmeContent = Buffer.from(
							readmeData.data.content,
							"base64"
						).toString("utf8");

						webviewView.webview.postMessage({
							type: "receivedReadme",
							payload: {
								fullName: fullName, // Send back the fullName for matching
								readme: readmeContent,
							},
						});
					} catch (error) {
						console.error(
							`Failed to fetch README for ${fullName}:`,
							error
						);
						webviewView.webview.postMessage({
							type: "receivedReadme",
							payload: {
								fullName: fullName,
								readme: null, // Indicate failure
								error:
									error instanceof Error
										? error.message
										: "Unknown error fetching README",
							},
						});
					}
					break;
				}
				case "search": {
					console.log("search", message.query);
					getLogger().logUsage("searchMcpServers", {
						query: message.query,
						accountId: this._session.account.id,
						accountLabel: this._session.account.label,
					});
					const page = message.page || 1;
					const perPage = message.perPage || 10;
					const searchResponse = await searchMcpServers({
						query: message.query,
						page,
						perPage,
					});

					const results = searchResponse?.results || [];
					const totalCount = searchResponse?.totalCount || 0;

					webviewView.webview.postMessage({
						type: "receivedSearchResults",
						data: {
							results: results,
							totalCount: totalCount,
							currentPage: page,
							perPage: perPage,
						},
					});
					break;
				}
				case "requestMCPConfigObject": {
					const commands = (
						await vscode.commands.getCommands()
					).filter((c) => c.includes("mcp"));
					console.log("commands", commands);
					await sendServers(webviewView);
					break;
				}
				case "deleteServer": {
					const serverKeyToDelete = message.key;
					if (!serverKeyToDelete) {
						vscode.window.showErrorMessage(
							"Server key to delete is missing."
						);
						// Optionally, inform the webview about the error
						webviewView.webview.postMessage({
							type: "error",
							data: {
								message: "Server key to delete is missing.",
							},
						});
						return;
					}

					try {
						await deleteServer(webviewView, serverKeyToDelete);
					} catch (error) {}
					break;
				}
				// It's good practice to have a default case, even if just for logging
				default:
					console.warn(
						"Received unknown message type from webview:",
						message.type
					);
					break;
			}
		}, undefined);
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
			// Send the updated list back to the webview
			webviewView.webview.postMessage({
				type: "receivedMCPConfigObject",
				data: { servers: updatedServers },
			});
			if (serverKeyToDelete !== "mcp-server-time") {
				vscode.window.showInformationMessage(
					`Server '${serverKeyToDelete}' deleted.`
				);
			}
		} catch (error: unknown) {
			// Send back the original servers list on error
			webviewView.webview.postMessage({
				type: "receivedMCPConfigObject",
				data: { servers },
			});
		}
	}
}
