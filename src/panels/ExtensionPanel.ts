import * as vscode from "vscode";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { searchMcpServers } from "../utilities/repoSearch";

export class CopilotMcpViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "copilotMcpView";
  octokit: any;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _accessToken: string
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "installServer": {
          const server = message.server.mcpServers;
          const config = vscode.workspace.getConfiguration("mcp");
          let servers = config.get("servers", {});
          servers = { ...servers, ...server };
          await config.update(
            "servers",
            servers,
            vscode.ConfigurationTarget.Global
          );
          break;
        }
        case "getInstallObject": {
          const readme = message.readme;
          // show loading notification
          vscode.window.withProgress(
            {
              title: "Installing MCP server with Copilot...",
              location: vscode.ProgressLocation.Notification,
            },
            async (progress, token) => {
              const installObject: Record<string, any> = await vscodeLMResponse(
                readme
              );
              console.log("installObject", installObject);
              // Add the mcp server to the config
              const config = vscode.workspace.getConfiguration("mcp");
              let servers = config.get("servers", {});
              // for each key in the installObject, add it to the servers object
              for (const key in installObject) {
                servers = { ...servers, ...installObject[key] };
                // servers[key] = installObject[key];
              }
              progress.report({ message: "Adding MCP server to config..." });
              await config.update(
                "servers",
                servers,
                vscode.ConfigurationTarget.Global
              );
              progress.report({ message: "Starting MCP server..." });
              // Send the updated list back to the webview
              webviewView.webview.postMessage({
                type: "receivedMCPConfigObject",
                data: { servers },
              });
              // show a notification
              const clicked = await vscode.window.showInformationMessage(
                "MCP server installed successfully",
                "Start Server"
              );
              if (clicked) {
                // use the first key in the mcpServers object
                const serverKey = Object.keys(installObject.mcpServers)[0];
                console.log("attempting to start server", serverKey);
                const response = await vscode.commands.executeCommand(
                  "workbench.mcp.startServer",
                  serverKey
                );
                console.log("response", response);
              }
              progress.report({ message: "MCP server installed successfully" });
              vscode.window.showInformationMessage(
                "MCP server installed successfully"
              );
            }
          );
          break;
        }
        case "search": {
          console.log("search", message.query);
          const page = message.page || 1;
          const perPage = message.perPage || 10;
          const searchResponse = await searchMcpServers(
            await this.getOctokit(),
            { userQuery: message.query, page, perPage }
          );

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
          const commands = (await vscode.commands.getCommands()).filter((c) =>
            c.includes("mcp")
          );
          console.log("commands", commands);
          const config = vscode.workspace.getConfiguration("mcp");
          const servers = config.get("servers", {});
          webviewView.webview.postMessage({
            type: "receivedMCPConfigObject",
            data: { servers },
          });
          break;
        }
        case "deleteServer": {
          const serverKeyToDelete = message.key;
          if (!serverKeyToDelete) {
            vscode.window.showErrorMessage("Server key to delete is missing.");
            // Optionally, inform the webview about the error
            webviewView.webview.postMessage({
              type: "error",
              data: { message: "Server key to delete is missing." },
            });
            return;
          }

          const config = vscode.workspace.getConfiguration("mcp");
          let servers = config.get("servers", {} as Record<string, unknown>);

          if (servers[serverKeyToDelete]) {
            // Create a new object without the server to delete
            const updatedServers = { ...servers };
            delete updatedServers[serverKeyToDelete];

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
              vscode.window.showInformationMessage(
                `Server '${serverKeyToDelete}' deleted.`
              );
            } catch (error: unknown) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              vscode.window.showErrorMessage(
                `Error deleting server '${serverKeyToDelete}': ${errorMessage}`
              );
              // Send back the original servers list on error
              webviewView.webview.postMessage({
                type: "receivedMCPConfigObject",
                data: { servers },
              });
            }
          } else {
            vscode.window.showWarningMessage(
              `Server '${serverKeyToDelete}' not found in configuration.`
            );
            // Send the current list back
            webviewView.webview.postMessage({
              type: "receivedMCPConfigObject",
              data: { servers },
            });
          }
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
    const Octokit = await import("@octokit/rest");
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
}
const craftedPrompt = vscode.LanguageModelChatMessage.User(`
You are a helpful assistant that can expertly parse a README.md file and extract the install command for a given open source 
MCP server. You will be given the contents of a README.md file and you will need to extract the MCP server JSON object 
specifically containing the key "mcpServers" in a JSON object
Your response should be the JSON object parsed from the README.md file. If no JSON object is found, your response should simply be "No JSON object found".
`);
async function vscodeLMResponse(readme: string) {
  console.log("vscodeLMResponse starting");
  try {
    const tools = vscode.lm.tools;
    const models = await vscode.lm.selectChatModels();
    console.log("models", models);
    const model = models.find(
      (m) => m.vendor === "copilot" && (m.id === "gpt-4.1" || m.id === "gpt-4o")
    );
    if (!model) {
      throw new Error("No model found");
    }
    console.log("selected model", model);
    const toolsArray: vscode.LanguageModelChatTool[] = tools.map((t) => ({
      name: t.name,
      inputSchema: t.inputSchema,
      description: t.description,
      // execute: t.execute
    }));
    console.log("toolsArray", toolsArray);
    const request = await model.sendRequest(
      [craftedPrompt, vscode.LanguageModelChatMessage.User(readme)],
      { tools: toolsArray },
      new vscode.CancellationTokenSource().token
    );
    const parsedResponse = await parseChatResponse(request);
    return parsedResponse;
  } catch (err) {
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
        console.log("Error parsing response", e);
        // do nothing
      }
    }
  }
  console.log("accumulatedResponse", accumulatedResponse);
  if (accumulatedResponse.startsWith("```json")) {
    const jsonString = accumulatedResponse
      .replace("```json", "")
      .replace("```", "");
    const parsedResponse = JSON.parse(jsonString);
    return parsedResponse;
  }
  return null;
}
