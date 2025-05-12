import * as vscode from "vscode";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { searchMcpServers } from "../utilities/repoSearch";
import { type TelemetryReporter } from "@vscode/extension-telemetry";

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
        case "getNewMcpServers": {

        }
        case "aiAssistedSetup": {
          this._telemetryReporter.sendTelemetryEvent("attemptMcpServerInstall", {
            accountId: this._session.account.id,
            accountLabel: this._session.account.label,
            repoId: message.payload.repo?.id,
            repoName: message.payload.repo?.name,
            repoUrl: message.payload.repo?.url.split("//")[1],
          });
          // Expecting payload.repo and payload.readme
          const readmeToParse = message.payload.repo.readme; 
          if (!readmeToParse) {
            vscode.window.showErrorMessage("README content is missing in aiAssistedSetup message.");
            webviewView.webview.postMessage({
              type: "finishInstall", // Notify webview to stop loading
              payload: { fullName: message.payload.repo?.fullName },
            });
            return;
          }
          try {
            const result = await vscodeLMResponse(readmeToParse, webviewView, message.payload.repo?.fullName);
            console.log("Result: ", result);
            // Potentially send a success message or the result back to the webview
          } catch (error) {
            console.error("Error during AI Assisted Setup: ", error);
            // Notify webview about the error
          } finally {
            webviewView.webview.postMessage({
              type: "finishInstall",
              payload: { fullName: message.payload.repo?.fullName }, // Send fullName for identification
            });
          }
          break;
        }
        case "updateServerEnvVar": {
          try {
            console.log("updateServer message: ", message);
            const configKey = `mcp.servers.${message.payload.serverName}.env`;
            const config = vscode.workspace.getConfiguration(configKey);
            await config.update(message.payload.envKey, message.payload.newValue);
          } catch (error) {
            
          }
          //   await sendServers(webviewView);
          break;
        }
        case "requestReadme": {
          const { fullName, url: repoUrl } = message.payload; // repoUrl is kept for now, though not used for owner/repo extraction
          if (!fullName) {
            vscode.window.showErrorMessage("Repository fullName not provided for README request.");
            return;
          }
          try {
            const octokit = await this.getOctokit();
            // Extract owner and repo from fullName (e.g., "owner/repo")
            const parts = fullName.split('/');
            if (parts.length !== 2) {
              throw new Error(`Invalid repository fullName format: ${fullName}. Expected 'owner/repo'.`);
            }
            const owner = parts[0];
            const repo = parts[1];

            const readmeData = await octokit.repos.getReadme({ owner, repo });
            const readmeContent = Buffer.from(readmeData.data.content, 'base64').toString('utf8');
            
            webviewView.webview.postMessage({
              type: "receivedReadme",
              payload: {
                fullName: fullName, // Send back the fullName for matching
                readme: readmeContent,
              },
            });
          } catch (error) {
            console.error(`Failed to fetch README for ${fullName}:`, error);
            webviewView.webview.postMessage({
              type: "receivedReadme",
              payload: {
                fullName: fullName,
                readme: null, // Indicate failure
                error: error instanceof Error ? error.message : "Unknown error fetching README"
              },
            });
          }
          break;
        }
        case "search": {
          console.log("search", message.query);
          this._telemetryReporter.sendTelemetryEvent("searchMcpServers", {
            query: message.query,
            page: message.page?.toString() || "1",
            perPage: message.perPage?.toString() || "10",
            accountId: this._session.account.id,
            accountLabel: this._session.account.label 
          });
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

          try {
            await deleteServer(webviewView, serverKeyToDelete);
          } catch (error) {
            
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
const responseFormatPrompt = vscode.LanguageModelChatMessage.User(`
  The response MUST be in the form of a JSON object conforming to the following JSON schema.
  JSON Schema:
  {
  "name": "server_configuration",
  "schema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Unified Server Configuration",
    "description": "Defines a single server configuration. The 'type' and 'name' properties are mandatory. The 'type' property dictates which other fields are relevant and potentially required. The LLM must carefully read the descriptions of each property to determine the correct structure based on the chosen 'type'. Any user-specific configurable values (like API keys or user-specific/user-configurable values) should be declared in the 'inputs' array and referenced elsewhere using the \${input:<id_from_inputs_array>} syntax.",
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "REQUIRED. A user-friendly and unique name for this server configuration."
      },
      "type": {
        "type": "string",
        "enum": ["stdio", "sse"],
        "description": "REQUIRED. The type of the server. If 'stdio', then 'command' and 'args' are required. If 'sse', then 'url' is required. Other properties become relevant based on this type."
      },
      "command": {
        "type": "string",
        "description": "The command to execute. This property is ONLY applicable and REQUIRED if 'type' is 'stdio'. Do not include for 'sse' type."
      },
      "args": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "Arguments for the command. This property is ONLY applicable and REQUIRED if 'type' is 'stdio'. Values can reference shared inputs using \${input:<id>}. Do not include for 'sse' type."
      },
      "env": {
        "type": "object",
        "additionalProperties": {
          "type": "string"
        },
        "description": "Environment variables for the command. This property is ONLY applicable if 'type' is 'stdio'. It is optional for 'stdio' type servers. Values can reference shared inputs using \${input:<id>}. Do not include for 'sse' type."
      },
      "url": {
        "type": "string",
        "format": "uri",
        "description": "The URL for the Server-Sent Events (SSE) endpoint. This property is ONLY applicable and REQUIRED if 'type' is 'sse'. Do not include for 'stdio' type."
      },
      "headers": {
        "type": "object",
        "additionalProperties": {
          "type": "string"
        },
        "description": "Headers to include in the SSE request. This property is ONLY applicable if 'type' is 'sse'. It is optional for 'sse' type servers. Values can reference shared inputs using \${input:<id>}. Do not include for 'stdio' type."
      },
      "inputs": {
        "type": "array",
        "description": "Optional. Defines a list of input parameters that this server configuration requires, such as API keys or user-specific paths. These inputs can then be referenced elsewhere in the configuration (e.g., in 'env', 'args', or 'url' for dynamic parts) using the syntax \${input:<id_from_this_inputs_array>}. For example, if an input has id 'my-api-key', it can be referenced as '\${input:my-api-key}'.",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "description": "REQUIRED. A unique identifier for this input. This ID is used in the \${input:<id>} syntax to reference the value."
            },
            "type": {
              "type": "const",
              "value": "promptString",
              "description": "REQUIRED. The type of input expected (e.g., 'promptString'). Tells UI to render appropriate input fields for the user to fill in information."
            },
            "description": {
              "type": "string",
              "description": "Optional. A human-readable description of what this input is for, often used as a label in UIs."
            },
            "password": {
              "type": "boolean",
              "description": "Optional. If true, indicates that the input is sensitive (e.g., a password or API key) and its value should be obscured in UIs. Defaults to false if not provided."
            }
          },
          "required": ["id", "type"],
          "additionalProperties": false
        }
      }
    },
    "required": [
      "name",
      "type"
    ],
    "additionalProperties": false
  }
}



  `);
async function vscodeLMResponse(readme: string, webviewView?: vscode.WebviewView, repoFullName?: string) {
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
          [craftedPrompt, responseFormatPrompt, vscode.LanguageModelChatMessage.User(readme)],
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
        // Optionally, notify webview upon successful addition if webviewView is provided
        if (webviewView && repoFullName) {
          webviewView.webview.postMessage({
            type: "serverInstallSuccess", // Or a more generic success message
            payload: { 
              fullName: repoFullName,
              serverConfig: parsedResponse 
            }
          });
        }
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
  } catch (error) {
    
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
    try {
      if (updatedServers["mcp-server-time"]) {
        delete updatedServers["mcp-server-time"];
      }
    } catch (error) {
      
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
      // Send back the original servers list on error
      webviewView.webview.postMessage({
        type: "receivedMCPConfigObject",
        data: { servers },
      });
    }
  }
}
