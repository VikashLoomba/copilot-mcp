import * as vscode from "vscode";

import {
  zodSchema,
} from "ai";

import { z } from "zod";
import { AxAIOpenAIBase } from "@ax-llm/ax";

const GITHUB_AUTH_PROVIDER_ID = "github";
// The GitHub Authentication Provider accepts the scopes described here:
// https://developer.github.com/apps/building-oauth-apps/understanding-scopes-for-oauth-apps/
const SCOPES = ["user:email", "read:org", "read:user", "repo", "workflow"];
const GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"; // This is a public client ID for Copilot

export class CopilotChatProvider {
  private static instance: CopilotChatProvider;
  private session: vscode.AuthenticationSession | undefined;
  private copilotToken: string | undefined;
  private _headers: Record<string, string> = {
    "Editor-Version": `vscode/${vscode.version}`,
    "Editor-Plugin-Version": "copilot-chat/0.27.0",
    "X-GitHub-Api-Version": "2025-04-01"
  };
  private _baseUrl = `https://api.githubcopilot.com`;
  private _baseModel = ""; // Will be set dynamically from available models
  public modelDetails: any = null;
  private _modelCapabilities: any = null; // Store model capabilities
  private _provider!: AxAIOpenAIBase<"gpt-4o", "text-embedding-ada-002">;

  private _initialized = false;

  public get provider() {
    if (!this._provider) {
      this.provider = new AxAIOpenAIBase({
        apiKey: this.copilotToken!,
        apiURL: this.baseUrl,
        config: {
            model: 'gpt-4o',
            embedModel: "text-embedding-ada-002"
        },
        modelInfo: [{name: "gpt-4o"}]
      });
      this.provider.setHeaders(() => Promise.resolve(this.headers));
    }
    return this._provider;
  }
  public set provider(provider) {
    this._provider = provider;
  }

  public get modelCapabilities() {
    return this._modelCapabilities;
  }

  /**
   * Generate a random ID for messages
   * @returns Random string ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  // Private constructor to prevent direct instantiation
  private constructor() {}

  // Static method to get the singleton instance
  public static getInstance(): CopilotChatProvider {
    if (!CopilotChatProvider.instance) {
      CopilotChatProvider.instance = new CopilotChatProvider();
    }
    return CopilotChatProvider.instance;
  }

  // Static method to initialize the singleton instance
  public static async initialize(
    context: vscode.ExtensionContext
  ): Promise<CopilotChatProvider> {
    const instance = CopilotChatProvider.getInstance();
    await instance._initialize(context);
    return instance;
  }

  // Method to check if provider is initialized
  public isInitialized(): boolean {
    return this._initialized;
  }

  // Renamed to _initialize to avoid confusion with the static method
  private async _initialize(context: vscode.ExtensionContext): Promise<void> {
    if (this._initialized) {
      console.log("CopilotChatProvider already initialized");
      return;
    }

    this.registerListeners(context);

    if (!this.session) {
      try {
        this.session = await vscode.authentication.getSession(
          GITHUB_AUTH_PROVIDER_ID,
          SCOPES,
          { createIfNone: true }
        );
      } catch (error) {
        console.error("Failed to get GitHub authentication session:", error);
        vscode.window.showErrorMessage(
          "GitHub authentication failed. Please sign in to GitHub."
        );
        return;
      }
    }

    if (this.session) {
      try {
        // Get Copilot token using the GitHub auth token
        await this.getCopilotToken(context);
      } catch (error) {
        console.error("Failed to get Copilot token:", error);
        vscode.window.showErrorMessage(
          "GitHub Copilot authentication failed. Ensure you have an active Copilot subscription."
        );
        return;
      }
    }

    const existingSessions = await vscode.authentication.getAccounts(
      GITHUB_AUTH_PROVIDER_ID
    );
    console.log("existingSessions", existingSessions);

    // Set initialized flag to true
    this._initialized = true;
    console.log("CopilotChatProvider initialization complete");
  }

  private async getCopilotToken(
    context: vscode.ExtensionContext
  ): Promise<void> {
    if (!this.session?.accessToken) {
      throw new Error("No GitHub authentication token available");
    }

    try {
      // Try to get the Copilot token through the GitHub API first
      const GITHUB_API_BASE_URL = "https://api.github.com";
      const githubTokenResponse = await fetch(
        `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
        {
          headers: {
            Authorization: `token ${this.session.accessToken}`,
            ...this.headers
          },
        }
      );

      if (githubTokenResponse.ok) {
        const tokenData = await githubTokenResponse.json();
        console.dir(tokenData, {depth: null, colors:true});
        if (tokenData.token) {
          this.copilotToken = tokenData.token;
          await context.globalState.update("copilotToken", this.copilotToken);
          console.log("Successfully retrieved Copilot token from GitHub API");
          if (tokenData.endpoints.api) {
            console.log("Got and api url.");
            this.baseUrl = tokenData.endpoints.api;

            const userResponseTest = await fetch(`${GITHUB_API_BASE_URL}/copilot_internal/user`, {
                headers: {
                    ...this.headers,
                    Authorization: `token ${this.session.accessToken}`,
                }
            });
            if(userResponseTest.ok) {
                const userdata = await userResponseTest.json();
                console.dir(userdata, {depth: null, colors:true});
                this._headers = {
                    ...this._headers,
                    Authorization: `Bearer ${this.copilotToken}`
                };
            } else {
                console.log("failed to fetch user data from copilot internal");
                console.log(await userResponseTest.text());
            }
          }
          return;
        }
      }

      console.log(
        "Could not get Copilot token from GitHub API, falling back to device flow"
      );

      // If direct token retrieval failed, we need to initiate the device code flow
      // Step 1: Request device code
      const deviceCodeResponse = await fetch(
        "https://github.com/login/device/code",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "GithubCopilot/1.155.0",
            "editor-version": `vscode/${vscode.version}`,
          },
          body: JSON.stringify({
            client_id: GITHUB_COPILOT_CLIENT_ID,
            scope: "read:user",
          }),
        }
      );

      if (!deviceCodeResponse.ok) {
        throw new Error(
          `Failed to get device code: ${deviceCodeResponse.statusText}`
        );
      }

      const deviceCodeData = await deviceCodeResponse.json();
      const { device_code, user_code, verification_uri, interval } =
        deviceCodeData;

      // Show user code and verification URL to authenticate
      const message = `Please authenticate GitHub Copilot by visiting ${verification_uri} and entering code: ${user_code}`;
      vscode.window
        .showInformationMessage(message, "Open in Browser")
        .then((selection) => {
          if (selection === "Open in Browser") {
            vscode.env.openExternal(vscode.Uri.parse(verification_uri));
          }
        });

      // Step 2: Poll for user authentication completion
      let authenticated = false;
      const pollingInterval = (interval || 5) * 1000; // Default to 5 seconds if not provided

      while (!authenticated) {
        await new Promise((resolve) => setTimeout(resolve, pollingInterval));

        const tokenResponse = await fetch(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "User-Agent": "GithubCopilot/1.155.0",
              "editor-version": `vscode/${vscode.version}`,
            },
            body: JSON.stringify({
              client_id: GITHUB_COPILOT_CLIENT_ID,
              device_code: device_code,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            }),
          }
        );

        const tokenData = await tokenResponse.json();

        if (tokenData.access_token) {
          this.copilotToken = tokenData.access_token;
          authenticated = true;

          // Store the token for future use
          await context.globalState.update("copilotToken", this.copilotToken);

          vscode.window.showInformationMessage(
            "GitHub Copilot authentication successful!"
          );

          // Ensure consistent headers
          this._headers = {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${this.copilotToken}`,
            "copilot-integration-id": "vscode-chat",
            "editor-version": `vscode/${vscode.version}`,
            "editor-plugin-version": "copilot-chat/0.24.1",
            "openai-intent": "conversation-panel",
            "x-github-api-version": "2024-12-15",
            "x-request-id": globalThis.crypto.randomUUID(),
            "x-vscode-user-agent-library-version": "electron-fetch",
          };
        } else if (tokenData.error === "authorization_pending") {
          // User hasn't completed authentication yet, continue polling
          continue;
        } else if (tokenData.error) {
          throw new Error(
            `Authentication error: ${
              tokenData.error_description || tokenData.error
            }`
          );
        }
      }
    } catch (error: any) {
      console.error("Error getting Copilot token:", error);
      throw new Error(
        `Failed to authenticate with GitHub Copilot: ${error.message}`
      );
    }
  }

  registerListeners(context: vscode.ExtensionContext): void {
    /**
     * Sessions are changed when a user logs in or logs out.
     */
    context.subscriptions.push(
      vscode.authentication.onDidChangeSessions(async (e) => {
        if (e.provider.id === GITHUB_AUTH_PROVIDER_ID) {
          // await this.setOctokit();
        }
      })
    );
  }

  public getJson() {
    const inputSchema = z
      .object({
        id: z
          .string()
          .describe(
            "REQUIRED. A unique identifier for this input. This ID is used in the ${input:<id>} syntax to reference the value."
          ),
        type: z
          .enum(["promptString"])
          .describe(
            "REQUIRED. The type of input expected (e.g., 'promptString'). Tells UI to render appropriate input fields for the user to fill in information."
          ),
        description: z
          .string()
          .optional()
          .describe(
            "Optional. A human-readable description of what this input is for, often used as a label in UIs."
          ),
        password: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Optional. If true, indicates that the input is sensitive (e.g., a password or API key) and its value should be obscured in UIs. Defaults to false if not provided."
          ),
      })
      .strict(); // additionalProperties: false

    const stdioServerSchema = z.object({
      type: z
        .literal("stdio")
        .describe(
          "REQUIRED. The type of the server. If 'stdio', then 'command' and 'args' are required. If 'sse', then 'url' is required. Other properties become relevant based on this type."
        ),
      name: z.string().describe("The name of the server."),
      command: z
        .string()
        .describe(
          "The command to execute. This property is ONLY applicable and REQUIRED if 'type' is 'stdio'. Do not include for 'sse' type."
        ),
      args: z
        .array(z.string())
        .describe(
          "Arguments for the command. This property is ONLY applicable and REQUIRED if 'type' is 'stdio'. Values can reference shared inputs using ${input:<id>}. Do not include for 'sse' type."
        ),
      env: z
        .record(z.string())
        .optional()
        .describe(
          "Environment variables for the command. This property is ONLY applicable if 'type' is 'stdio'. It is optional for 'stdio' type servers. Values can reference shared inputs using ${input:<id>}. Do not include for 'sse' type."
        ),
    });

    const sseServerSchema = z.object({
      name: z.string().describe("The name of the server."),
      type: z
        .literal("sse")
        .describe(
          "REQUIRED. The type of the server. If 'stdio', then 'command' and 'args' are required. If 'sse', then 'url' is required. Other properties become relevant based on this type."
        ),
      url: z
        .string()
        .url()
        .describe(
          "The URL for the Server-Sent Events (SSE) endpoint. This property is ONLY applicable and REQUIRED if 'type' is 'sse'. Do not include for 'sse' type."
        ), // Assuming format: "uri" means it should be a URL
      headers: z
        .record(z.string())
        .optional()
        .describe(
          "Headers to include in the SSE request. This property is ONLY applicable if 'type' is 'sse'. It is optional for 'sse' type servers. Values can reference shared inputs using ${input:<id>}. Do not include for 'sse' type."
        ),
    });

    const serverConfigSchema = z.discriminatedUnion("type", [
      stdioServerSchema,
      sseServerSchema,
    ]);

    return zodSchema(
      z
        .object({
          inputs: z
            .array(inputSchema)
            .optional()
            .describe(
              "Optional. Defines shared input parameters that server configurations can reference."
            ),
          servers: z
            .record(serverConfigSchema)
            .describe(
              "Object containing server configuration. The 'type' property dictates which other fields are relevant and potentially required. The LLM must carefully read the descriptions of each property to determine the correct structure based on the chosen 'type'. Any user-specific configurable values (like API keys or user-specific/user-configurable values) should be declared in the 'inputs' array and referenced elsewhere using the ${input:<id_from_inputs_array>} syntax."
            ),
        })
        .required({
          servers: true,
        })
        .describe("Defines a server configuration.")
    ); // Added description from root schema
  }

  set baseUrl(url) {
    this._baseUrl = url;
  }
  get baseUrl() {
    return this._baseUrl;
  }

  get headers() {
    return this._headers;
  }

  get baseModel() {
    return this._baseModel;
  }
  set baseModel(model: string) {
    this._baseModel = model;
  }

  get maxOutputTokens(): number {
    if (
      this._modelCapabilities &&
      this._modelCapabilities.limits &&
      this._modelCapabilities.limits.max_output_tokens
    ) {
      return this._modelCapabilities.limits.max_output_tokens;
    }
    // Default value if capabilities are not available
    return 4096;
  }

  public async getModels() {
    try {
      const response = await fetch(`${this._baseUrl}/models`, {
        headers: this._headers,
      });

      if (!response.ok) {
        console.error(
          "Failed to fetch models:",
          response.status,
          response.statusText
        );
        throw new Error(
          `Failed to fetch models: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      return data.data;
    } catch {
      console.log("getModels failed");
    }
  }

  async getModelId() {
    try {
      const response = await fetch(`${this._baseUrl}/models`, {
        headers: this._headers,
      });

      if (!response.ok) {
        console.error(
          "Failed to fetch models:",
          response.status,
          response.statusText
        );
        throw new Error(
          `Failed to fetch models: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      console.log("Available models:", JSON.stringify(data, null, 2));

      const models = data.data;
      // filter out the models that are not enabled for the current editor
      const enabledModels = models.filter(
        (model: any) => model.model_picker_enabled
      );

      if (enabledModels.length === 0) {
        console.error("No enabled models found");
        throw new Error("No enabled models found");
      }

      // Find models matching the models we want in the exact order of preference
      const preferredModelIds = [
        "claude-3.7-sonnet",
        "o3-mini",
        "gemini-2.0-flash-001",
        "claude-3.5-sonnet",
        "gpt-4.1",
      ];

      // Instead of filter, we'll find the first model that matches our preferences in order
      for (const preferredId of preferredModelIds) {
        const foundModel = enabledModels.find(
          (model: any) => model.id === preferredId
        );
        if (foundModel) {
          this.modelDetails = foundModel;
          console.log(`Selected model: ${foundModel.id}`);
          this._baseModel = foundModel.id;
          this._modelCapabilities = foundModel.capabilities;
          console.log(`Model capabilities:`, this._modelCapabilities);
          return foundModel.id;
        }
      }

      // If none of our preferred models are available, use the first enabled model
      this._baseModel = enabledModels[0].id;
      this._modelCapabilities = enabledModels[0].capabilities;
      this.modelDetails = enabledModels[0];
      console.log(`Using first available model: ${this._baseModel}`);
      console.log(`Model capabilities:`, this._modelCapabilities);
      return this._baseModel;
    } catch (error) {
      console.error("Error getting models:", error);
      throw error;
    }
  }
}
