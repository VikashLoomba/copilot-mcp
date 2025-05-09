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

    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("mcp.servers")) {
        await sendServers(webviewView);
      }
    });

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "aiAssistedSetup": {
          const result = await vscodeLMResponse(message.readme);
          console.log("Result: ", result);
          break;
        }
        case "updateServerEnvVar": {
          console.log("updateServer message: ", message);
          const configKey = `mcp.servers.${message.payload.serverName}.env`;
          const config = vscode.workspace.getConfiguration(configKey);
          await config.update(message.payload.envKey, message.payload.newValue);
          //   await sendServers(webviewView);
          break;
        }
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
          webviewView.webview.postMessage({
            type: "finish"
          });
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
          await sendServers(webviewView);
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

          await deleteServer(webviewView, serverKeyToDelete);
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

function openMcpInstallUri(mcpConfig: object) {
  // Create the URI with the mcp configuration
  const uriString = `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify(mcpConfig)
  )}`;
  const uri = vscode.Uri.parse(uriString);

  // Open the URI using VS Code commands
  return vscode.commands.executeCommand("vscode.open", uri);
}

const craftedPrompt = vscode.LanguageModelChatMessage.User(`
You are a helpful assistant that can expertly parse a README.md file and extract the MCP JSON object for a given open source 
MCP server. You will be given the contents of a README.md file and you will need to parse the JSON configuration to provide
that will be used to construct a vscode URI.
The vscode URI mcp server object is in the same format as you would provide to --add-mcp (i.e. code --add-mcp "{\"name\":\"my-server\",\"command\": \"uvx\",\"args\": [\"mcp-server-fetch\"]}"), 
and will be used like so:
// For Insiders, use vscode-insiders instead of code
const link = \\\`vscode:mcp/install?\${encodeURIComponent(JSON.stringify(obj))}\\\`;

Provide the JSON server configuration in the form {\"name\":\"server-name\",\"command\":...}
The text below contains correct examples of VSCode mcp server configurations. Your response should
only include the JSON server configuration, including any required \`inputs\` entries for
environment variables that should be stored securely, like shown below.

// Example .vscode/mcp.json
{
  // 💡 Inputs will be prompted on first server start,
  //    then stored securely by VS Code.
  "inputs": [
    {
      "type": "promptString",
      "id": "perplexity-key",
      "description": "Perplexity API Key",
      "password": true
    }
  ],
  "servers": {
    // https://github.com/ppl-ai/modelcontextprotocol/
    "Perplexity": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "PERPLEXITY_API_KEY", "mcp/perplexity-ask"],
      "env": {
        "PERPLEXITY_API_KEY": "\${input:perplexity-key}\"
      }
    },
    // https://github.com/modelcontextprotocol/servers/tree/main/src/fetch
    "fetch": {
      "type": "stdio",
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    },
    "my-remote-server": {
      "type": "sse",
      "url": "http://api.contoso.com/sse",
      "headers": { "VERSION": "1.2" }
    }
  }
}

`);
async function vscodeLMResponse(readme: string) {
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
        const models = await vscode.lm.selectChatModels();
        console.log("models", models);
        const model = models.find(
          (m) =>
            m.vendor === "copilot" && (m.id === "gpt-4.1" || m.id === "gpt-4o")
        );
        if (!model) {
          throw new Error("No model found");
        }

        const request = await model.sendRequest(
          [craftedPrompt, vscode.LanguageModelChatMessage.User(readme)],
          //   { tools: toolsArray },
          {},
          new vscode.CancellationTokenSource().token
        );
        const parsedResponse = await parseChatResponse(request);
        progress.report({
          message: `Configuring server...`,
        });
        const cmdResponse = await openMcpInstallUri(parsedResponse);
        progress.report({
          message: `Added MCP Server`,
        });
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
  );
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
  if (servers["mcp-server-time"]) {
    delete servers["mcp-server-time"];
  }
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
    if (updatedServers["mcp-server-time"]) {
      delete updatedServers["mcp-server-time"];
    }

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
  }
}
