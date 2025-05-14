import * as vscode from "vscode";

import {
  createOpenAICompatible,
  OpenAICompatibleProvider,
} from "@ai-sdk/openai-compatible";
import {
  streamText,
  generateText,
  ToolSet,
  Message,
  Tool as AITool,
  jsonSchema,
  zodSchema,
} from "ai";

import { z } from "zod";
import { AxAI, AxAIOpenAI, AxAIOpenAIBase } from "@ax-llm/ax";

const GITHUB_AUTH_PROVIDER_ID = "github";
// The GitHub Authentication Provider accepts the scopes described here:
// https://developer.github.com/apps/building-oauth-apps/understanding-scopes-for-oauth-apps/
const SCOPES = ["user:email", "read:org", "read:user", "repo", "workflow"];
const GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"; // This is a public client ID for Copilot

// Interface for OpenAI compatible message format
interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool" | "function";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export class CopilotChatProvider {
  private static instance: CopilotChatProvider;
  private session: vscode.AuthenticationSession | undefined;
  private copilotToken: string | undefined;
  private _headers: Record<string, string> = {
    "content-type": "application/json",
    "copilot-integration-id": "vscode-chat",
    "editor-version": `vscode/${vscode.version}`,
    "editor-plugin-version": "copilot-chat/0.24.1",
    "openai-intent": "conversation-panel",
    "x-github-api-version": "2024-12-15",
    "x-vscode-user-agent-library-version": "electron-fetch",
  };
  private _accountType = "individual";
  private _baseUrl = `https://api.${this._accountType}.githubcopilot.com`;
  private _baseModel = ""; // Will be set dynamically from available models
  public modelDetails: any = null;
  private _modelCapabilities: any = null; // Store model capabilities
  private _provider!: AxAIOpenAIBase<"o4-mini", "text-embedding-ada-002">;

  private _initialized = false;

  public get provider() {
    if (!this._provider) {
      this.provider = new AxAIOpenAIBase({
        apiKey: this.copilotToken!,
        apiURL: this.baseUrl,
        config: {
            model: 'o4-mini',
            embedModel: "text-embedding-ada-002"
        },
        modelInfo: [{name: "o4-mini"}]
      });
      this.provider.setHeaders(() => Promise.resolve(this.headers))

    //   this.provider.setOptions({fetch: async (input, init) => {
    //     let url = input;
    //     if(typeof url === "string") {
    //         url = this.baseUrl;
    //     }
    //     return await globalThis.fetch(input, {
    //         ...init,
    //         headers: {
    //             ...init?.headers ?? {},
    //             ...this.headers
    //         }
    //     });
    //   }});
    //   this.provider = createOpenAICompatible({
    //     name: "GitHub Copilot",
    //     apiKey: this.copilotToken,
    //     baseURL: this.baseUrl,
    //     headers: {
    //       ...this.headers,
    //     },
    //   });
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

    // Make sure the baseUrl includes the account type
    this._baseUrl = `https://api.${this._accountType}.githubcopilot.com`;

    // Try to get the stored token first
    this.copilotToken = context.globalState.get<string>("copilotToken");

    // If we have a stored token, verify it's still valid
    if (this.copilotToken) {
      try {
        const testResponse = await fetch(`${this._baseUrl}/models`, {
          headers: {
            Authorization: `Bearer ${this.copilotToken}`,
            "content-type": "application/json",
            "copilot-integration-id": "vscode-chat",
            "editor-version": `vscode/${vscode.version}`,
            "editor-plugin-version": "copilot-chat/0.24.1",
            "x-github-api-version": "2024-12-15",
            "x-request-id": globalThis.crypto.randomUUID(),
          },
        });

        if (testResponse.ok) {
          console.log("Using stored Copilot token");
          this._headers["Authorization"] = `Bearer ${this.copilotToken}`;

          // Get available models and set a proper model ID
          await this.getModelId();

          // Test if completions work with our configuration
          // const completionWorks = await this.verifyAndRefreshTokenIfNeeded(context);
          // if (completionWorks) {
          //     this._initialized = true;
          //     console.log('CopilotChatProvider initialization complete with stored token');
          //     return;
          // } else {
          //     console.log('Completion test failed with stored token, requesting a new one');
          //     this.copilotToken = undefined;
          //     await context.globalState.update('copilotToken', undefined);
          // }
        } else {
          console.log("Stored Copilot token is invalid, requesting a new one");
          this.copilotToken = undefined;
          await context.globalState.update("copilotToken", undefined);
        }
      } catch (error) {
        console.error("Error validating stored token:", error);
        this.copilotToken = undefined;
        await context.globalState.update("copilotToken", undefined);
      }
    }

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

    // Set the Authorization header with the Copilot token
    if (this.copilotToken) {
      this._headers["Authorization"] = `Bearer ${this.copilotToken}`;
    } else {
      vscode.window.showErrorMessage(
        "Failed to authenticate with GitHub Copilot. No token available."
      );
      return;
    }

    // Get available models and set a proper model ID
    await this.getModelId();

    // // Test if completions work with our configuration
    // const completionWorks = await this.testCompletionRequest();
    // if (!completionWorks) {
    //     vscode.window.showErrorMessage('GitHub Copilot API test failed. Unable to make completion requests.');
    //     console.error('Completion test failed. Check the API URL, token, model, and headers.');
    //     // Continue initialization anyway to allow debugging
    // }

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
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "GithubCopilot/1.155.0",
            "editor-version": `vscode/1.93.0`,
            "editor-plugin-version": "copilot-chat/0.24.1",
            "x-github-api-version": "2024-12-15",
          },
        }
      );

      if (githubTokenResponse.ok) {
        const tokenData = await githubTokenResponse.json();
        if (tokenData.token) {
          this.copilotToken = tokenData.token;
          await context.globalState.update("copilotToken", this.copilotToken);
          console.log("Successfully retrieved Copilot token from GitHub API");

          // Ensure consistent headers
          //   this._headers = {
          //     "content-type": "application/json",
          //     accept: "application/json",
          //     authorization: `Bearer ${this.copilotToken}`,
          //     "copilot-integration-id": "vscode-chat",
          //     "editor-version": `vscode/${vscode.version}`,
          //     "editor-plugin-version": "copilot-chat/0.24.1",
          //     "openai-intent": "conversation-panel",
          //     "x-github-api-version": "2024-12-15",
          //     "x-request-id": globalThis.crypto.randomUUID(),
          //     "x-vscode-user-agent-library-version": "electron-fetch",
          //   };

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

//   public async testGen() {
//     const provider = this.provider;
//     const { text } = await generateText({
//       model: provider("gpt-4.1"),
//       prompt: "Write a vegetarian lasagna recipe for 4 people.",
//     });
//     return text;
//   }

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

  // async getOctokit(): Promise<Octokit.Octokit> {
  //     if (this.octokit) {
  //         return this.octokit;
  //     }

  //     /**
  //      * When the `createIfNone` flag is passed, a modal dialog will be shown asking the user to sign in.
  //      * Note that this can throw if the user clicks cancel.
  //      */
  //     const session = await vscode.authentication.getSession(GITHUB_AUTH_PROVIDER_ID, SCOPES, { createIfNone: true });
  //     this.octokit = new Octokit.Octokit({
  //         auth: session.accessToken
  //     });

  //     return this.octokit;
  // }

  // get openai() {
  //     if (!this._openai) {
  //         throw new Error('OpenAI client not initialized');
  //     }
  //     return this._openai;
  // }
  // set openai(openai: OpenAI) {
  //     this._openai = openai;
  // }

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

  /**
   * Convert VSCode chat history to OpenAI message format
   * @param history Chat history from VSCode
   * @param systemPrompt Optional system prompt to include
   * @returns Array of OpenAI compatible messages
   */
  private vscodeToOpenAIMessages(
    history: vscode.ChatRequestTurn[],
    systemPrompt?: string
  ): Message[] {
    const messages: Message[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      messages.push({
        id: this.generateId(),
        role: "system",
        content: systemPrompt,
      });
    }

    // Convert each history item
    for (const item of history) {
      // Add user messages
      messages.push({
        id: this.generateId(),
        role: "user",
        content: item.prompt,
      });
    }

    // Note: we're not converting response turns here since the history should only contain request turns
    return messages;
  }

  /**
   * Convert VSCode language model chat messages to OpenAI format
   * @param messages VSCode language model chat messages
   * @returns OpenAI compatible messages
   */
  private langModelToOpenAIMessages(
    messages: vscode.LanguageModelChatMessage[]
  ): Message[] {
    return messages.map((message) => {
      const role = message.role.toString().toLowerCase();
      // Convert content to string if it's not already
      let content = "";

      if (typeof message.content === "string") {
        content = message.content;
      } else if (Array.isArray(message.content)) {
        // Join text parts
        // We need to access the text of LanguageModelTextPart differently
        content = message.content
          .filter((part) => part instanceof vscode.LanguageModelTextPart)
          .map((part) => {
            const textPart = part as vscode.LanguageModelTextPart;
            // Try to access text in a type-safe way
            return "text" in textPart ? textPart.text : "";
          })
          .join("");
      }

      if (role === "system") {
        return { id: this.generateId(), role: "system", content };
      } else if (role === "user") {
        return { id: this.generateId(), role: "user", content };
      } else {
        return { id: this.generateId(), role: "assistant", content };
      }
    });
  }

  /**
   * Convert OpenAI tools format to the ai library tool format
   * @param tools Array of VSCode language model tool information
   * @returns Tools in AI library format
   */
  private convertToolsToAIFormat(
    tools: readonly vscode.LanguageModelToolInformation[]
  ): ToolSet {
    const toolSet: ToolSet = {};

    for (const tool of tools) {
      toolSet[tool.name] = {
        execute: async (args: any) => {
          console.log("Executing tool:", tool.name, args);
          return await vscode.lm.invokeTool(tool.name, args);
        },
        parameters: tool.inputSchema,
      };
    }

    return toolSet;
  }

  /**
   * Process text chunks from the stream into VSCode chat response parts
   * @param chunk Text chunk from the stream
   * @param stream VSCode chat response stream
   */
  private processStreamChunk(
    chunk: string,
    stream: vscode.ChatResponseStream
  ): void {
    if (chunk.trim()) {
      stream.push(
        new vscode.ChatResponseMarkdownPart(new vscode.MarkdownString(chunk))
      );
    }
  }

  /**
   * Handle a chat request and generate a streaming response
   * @param request Chat request from VSCode
   * @param context Chat context
   * @param stream Response stream
   * @param token Cancellation token
   * @returns Chat result
   */
  // public async handleChatRequest(
  //     request: vscode.ChatRequest,
  //     context: vscode.ChatContext,
  //     stream: vscode.ChatResponseStream,
  //     token: vscode.CancellationToken
  // ): Promise<vscode.ChatResult> {
  //     if (!this.isInitialized()) {
  //         throw new Error('CopilotChatProvider not initialized');
  //     }

  //     try {
  //         // Progress indicator
  //         stream.progress('Thinking...');

  //         // Get system prompt
  //         const systemPrompt = request.prompt; // This may need to be adjusted based on how system prompts are handled

  //         // Convert history to OpenAI format
  //         const messages = this.vscodeToOpenAIMessages(
  //             context.history as vscode.ChatRequestTurn[],
  //             systemPrompt
  //         );

  //         // Add the current request
  //         messages.push({
  //             id: this.generateId(),
  //             role: 'user',
  //             content: request.prompt
  //         });

  //         // Prepare tools (if available)
  //         const tools = this.convertToolsToAIFormat(vscode.lm.tools);

  //         let responseText = '';
  //         let hasToolCalls = false;

  //         // Stream the response
  //         const response = await streamText({
  //             model: this.openai(this.baseModel),
  //             messages,
  //             headers: this._headers,
  //             tools,
  //             experimental_continueSteps: true,
  //         });

  //         for await (const chunk of response.fullStream) {
  //             if (token.isCancellationRequested) {
  //                 break;
  //             }

  //             // Handle text chunks
  //             if (chunk.type === 'text-delta') {
  //                 responseText += chunk.textDelta;
  //                 this.processStreamChunk(chunk.textDelta, stream);
  //             }
  //             // Handle tool calls
  //             else if (chunk.type === 'tool-call') {
  //                 hasToolCalls = true;
  //                 // Progress indicator for tool call
  //                 stream.progress(`Executing tool: ${chunk.toolName}...`);

  //                 // Here we could stream the tool execution progress if needed
  //             }
  //             // Use a type guard function to handle tool result chunks
  //             else if (this.isToolResultChunk(chunk)) {
  //                 // Tool results could be processed here if needed
  //                 console.log('Tool results:', chunk);
  //             }
  //         }

  //         // Return appropriate metadata based on whether tools were used
  //         if (hasToolCalls) {
  //             return { metadata: { hasToolCalls: true } };
  //         }

  //         return {};
  //     } catch (error) {
  //         console.error('Error handling chat request:', error);
  //         stream.push(new vscode.ChatResponseMarkdownPart(
  //             new vscode.MarkdownString(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  //         ));
  //         return {};
  //     }
  // }

  // async generateText(prompt: string) {
  //     try {
  //         console.log('Generating text with headers:', this._headers);
  //         const response = await generateText({
  //             model: this.openai(this.baseModel),
  //             prompt,
  //             headers: this._headers,
  //             experimental_continueSteps: true,
  //             tools: {
  //                 ...(vscode.lm.tools.reduce((acc, tool) => {
  //                     acc[tool.name] = {
  //                         execute: async (args: any) => {
  //                             console.log('Executing tool:', tool.name, args);
  //                             return await vscode.lm.invokeTool(tool.name, args);
  //                         },
  //                         parameters: tool.inputSchema
  //                     };
  //                     return acc;
  //                 }, {} as ToolSet)),
  //             },
  //         });
  //         return response;
  //     } catch (error) {
  //         console.log('Error generating text:', error);
  //         return {
  //             text: 'Error generating text:',
  //             error: error
  //         };
  //     }
  // }

  /**
   * Generate a streaming text response with the OpenAI compatible provider
   * @param prompt Text prompt
   * @param responseStream VSCode response stream to push updates to
   * @param tools Optional tools to include
   * @param messages Optional history messages
   * @param cancellationToken Cancellation token
   */
  // async streamChatResponse(
  //     prompt: string,
  //     responseStream: vscode.ChatResponseStream,
  //     tools?: readonly vscode.LanguageModelToolInformation[],
  //     messages?: vscode.LanguageModelChatMessage[],
  //     cancellationToken?: vscode.CancellationToken
  // ): Promise<void> {
  //     try {
  //         // Convert messages if provided
  //         const openAIMessages: Message[] = messages
  //             ? this.langModelToOpenAIMessages(messages)
  //             : [{ id: this.generateId(), role: 'user', content: prompt }];

  //         // Convert tools if provided
  //         const toolSet: ToolSet = tools
  //             ? this.convertToolsToAIFormat(tools)
  //             : {};

  //         // Progress indicator
  //         responseStream.progress('Thinking...');

  //         // Stream the response
  //         const response = await streamText({
  //             model: this.openai(this.baseModel),
  //             messages: openAIMessages,
  //             headers: this._headers,
  //             tools: toolSet,
  //             experimental_continueSteps: true,
  //         });

  //         let responseText = '';

  //         for await (const chunk of response.fullStream) {
  //             if (cancellationToken?.isCancellationRequested) {
  //                 break;
  //             }

  //             // Handle text chunks
  //             if (chunk.type === 'text-delta') {
  //                 responseText += chunk.textDelta;
  //                 this.processStreamChunk(chunk.textDelta, responseStream);
  //             }
  //             // Handle tool calls
  //             else if (chunk.type === 'tool-call') {
  //                 // Progress indicator for tool call
  //                 responseStream.progress(`Executing tool: ${chunk.toolName}...`);
  //             }
  //             // Handle tool results
  //             else if (this.isToolResultChunk(chunk)) {
  //                 console.log('Tool result in stream:', chunk);
  //             }
  //         }
  //     } catch (error) {
  //         console.error('Error streaming chat response:', error);
  //         responseStream.push(new vscode.ChatResponseMarkdownPart(
  //             new vscode.MarkdownString(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  //         ));
  //     }
  // }

  // async testCompletionRequest(): Promise<boolean> {
  //     try {
  //         console.log('Testing completion request with model:', this._baseModel);
  //         console.log('Using max_tokens:', this.maxOutputTokens);
  //         console.log('Using headers:', JSON.stringify(this._headers, null, 2));

  //         // Create a minimal test request
  //         const testMessages = [
  //             { role: 'system', content: 'You are a helpful assistant.' } as any,
  //             { role: 'user', content: 'Say hello' } as any
  //         ];

  //         // Try with direct fetch with standard headers
  //         const directResponse = await fetch(`${this._baseUrl}/chat/completions`, {
  //             method: 'POST',
  //             headers: this._headers,
  //             body: JSON.stringify({
  //                 model: this._baseModel,
  //                 messages: testMessages,
  //                 max_tokens: this.maxOutputTokens
  //             })
  //         });

  //         if (directResponse.ok) {
  //             const directResult = await directResponse.json();
  //             console.log('Direct fetch test succeeded:', directResult);

  //             // If direct fetch works, try with OpenAI client too
  //             try {
  //                 const openaiResponse = await this.openai.chat.completions.create({
  //                     model: this._baseModel,
  //                     messages: testMessages as any,
  //                     max_tokens: this.maxOutputTokens
  //                 });

  //                 console.log('Test completion with OpenAI client succeeded:', openaiResponse);
  //                 return true;
  //             } catch (openaiError) {
  //                 console.error('Test with OpenAI client failed even though direct fetch worked:', openaiError);
  //                 return false;
  //             }
  //         } else {
  //             const responseText = await directResponse.text();
  //             console.error(`Test completion request failed with status ${directResponse.status}: ${responseText}`);

  //             // Try with alternative headers if the first attempt failed
  //             console.log('Trying alternative headers configuration...');

  //             // Alternative header set 1: Closer to original GitHub Copilot headers
  //             const alternativeHeaders1 = {
  //                 'Content-Type': 'application/json',
  //                 'Authorization': `Bearer ${this.copilotToken}`,
  //                 'Copilot-Integration-Id': 'vscode-chat',
  //                 'Editor-Version': `vscode/${vscode.version}`,
  //                 'Editor-Plugin-Version': 'copilot-chat/0.24.1',
  //                 'X-Github-Api-Version': '2024-12-15',
  //                 'Openai-Intent': 'conversation-panel'
  //             };

  //             console.log('Trying with alternative headers 1:', JSON.stringify(alternativeHeaders1, null, 2));

  //             const alternativeResponse1 = await fetch(`${this._baseUrl}/chat/completions`, {
  //                 method: 'POST',
  //                 headers: alternativeHeaders1,
  //                 body: JSON.stringify({
  //                     model: this._baseModel,
  //                     messages: testMessages,
  //                     max_tokens: this.maxOutputTokens
  //                 })
  //             });

  //             if (alternativeResponse1.ok) {
  //                 const result = await alternativeResponse1.json();
  //                 console.log('Alternative headers 1 succeeded:', result);

  //                 // Update our headers to match the working configuration
  //                 this._headers = alternativeHeaders1;

  //                 // Update the OpenAI client with the new headers
  //                 this.openai = new OpenAI({
  //                     baseURL: this._baseUrl,
  //                     apiKey: this.copilotToken,
  //                     defaultHeaders: this._headers
  //                 });

  //                 return true;
  //             }

  //             const responseText1 = await alternativeResponse1.text();
  //             console.error(`Alternative headers 1 test failed with status ${alternativeResponse1.status}: ${responseText1}`);

  //             // Alternative header set 2: Minimal headers
  //             const alternativeHeaders2 = {
  //                 'Content-Type': 'application/json',
  //                 'Authorization': `Bearer ${this.copilotToken}`
  //             };

  //             console.log('Trying with minimal headers:', JSON.stringify(alternativeHeaders2, null, 2));

  //             const alternativeResponse2 = await fetch(`${this._baseUrl}/chat/completions`, {
  //                 method: 'POST',
  //                 headers: alternativeHeaders2,
  //                 body: JSON.stringify({
  //                     model: this._baseModel,
  //                     messages: testMessages,
  //                     max_tokens: this.maxOutputTokens
  //                 })
  //             });

  //             if (alternativeResponse2.ok) {
  //                 const result = await alternativeResponse2.json();
  //                 console.log('Minimal headers succeeded:', result);

  //                 // Update our headers to match the working configuration
  //                 this._headers = alternativeHeaders2;

  //                 // Update the OpenAI client with the new headers
  //                 this.openai = new OpenAI({
  //                     baseURL: this._baseUrl,
  //                     apiKey: this.copilotToken,
  //                     defaultHeaders: this._headers
  //                 });

  //                 return true;
  //             }

  //             const responseText2 = await alternativeResponse2.text();
  //             console.error(`Minimal headers test failed with status ${alternativeResponse2.status}: ${responseText2}`);

  //             return false;
  //         }
  //     } catch (error) {
  //         console.error('Error testing completion request:', error);
  //         return false;
  //     }
  // }

  /**
   * Get a fresh copy of headers with a new request ID
   * @returns Headers with a fresh request ID
   */
  public getFreshHeaders(): Record<string, string> {
    return {
      ...this._headers,
      "x-request-id": globalThis.crypto.randomUUID(),
    };
  }

  /**
   * Verify the current token and refresh it if expired
   * @param context The extension context for storing the refreshed token
   * @returns True if the token is valid (or was successfully refreshed), false otherwise
   */
  // public async verifyAndRefreshTokenIfNeeded(context: vscode.ExtensionContext): Promise<boolean> {
  //     console.log('Verifying Copilot token validity...');

  //     try {
  //         // Test if the current token works with a simple model request
  //         const tokenValid = await this.testCompletionRequest();

  //         if (tokenValid) {
  //             console.log('Copilot token is valid');
  //             return true;
  //         }

  //         console.log('Copilot token appears to be expired, attempting to refresh...');

  //         // Token is invalid, clear it and try to get a new one
  //         this.copilotToken = undefined;
  //         await context.globalState.update('copilotToken', undefined);

  //         // Get a new session if needed
  //         try {
  //             this.session = await vscode.authentication.getSession(GITHUB_AUTH_PROVIDER_ID, SCOPES, { createIfNone: true });
  //         } catch (error) {
  //             console.error('Failed to get GitHub authentication session:', error);
  //             vscode.window.showErrorMessage('GitHub authentication failed. Please sign in to GitHub.');
  //             return false;
  //         }

  //         // Get new Copilot token
  //         if (this.session) {
  //             try {
  //                 await this.getCopilotToken(context);

  //                 if (this.copilotToken) {
  //                     // Update headers with new token
  //                     this._headers['Authorization'] = `Bearer ${this.copilotToken}`;

  //                     // Recreate OpenAI client with new token
  //                     this.openai = new OpenAI({
  //                         baseURL: this._baseUrl,
  //                         apiKey: this.copilotToken,
  //                         defaultHeaders: this._headers
  //                     });

  //                     // Get available models and set a proper model ID
  //                     await this.getModelId();

  //                     // Test if the new token works
  //                     const refreshedTokenValid = await this.testCompletionRequest();
  //                     if (refreshedTokenValid) {
  //                         console.log('Successfully refreshed Copilot token');
  //                         return true;
  //                     } else {
  //                         console.error('Refreshed token still fails completion test');
  //                         return false;
  //                     }
  //                 }
  //             } catch (error) {
  //                 console.error('Failed to refresh Copilot token:', error);
  //                 return false;
  //             }
  //         }

  //         return false;
  //     } catch (error) {
  //         console.error('Error verifying token:', error);
  //         return false;
  //     }
  // }
}
