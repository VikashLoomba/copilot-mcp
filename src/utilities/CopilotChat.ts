import * as vscode from "vscode";

import { ai, AxAI, AxAIOpenAIModel,  } from "@ax-llm/ax";
import { logError } from '../telemetry/standardizedTelemetry';

const GITHUB_AUTH_PROVIDER_ID = "github";
// The GitHub Authentication Provider accepts the scopes described here:
// https://developer.github.com/apps/building-oauth-apps/understanding-scopes-for-oauth-apps/
const SCOPES = ["user:email", "read:org", "read:user"];
const GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"; // This is a public client ID for Copilot

export class CopilotChatProvider {
	public _context: vscode.ExtensionContext | undefined;
	private static instance: CopilotChatProvider;
	private session: vscode.AuthenticationSession | undefined;
	private copilotToken: string | undefined;
	private readonly defaultHeaders: Record<string, string> = {
		"Editor-Version": `vscode/${vscode.version}`,
		"Editor-Plugin-Version": "copilot-chat/0.27.0",
		"X-GitHub-Api-Version": "2025-04-01",
	};
	private _headers: Record<string, string> = { ...this.defaultHeaders };
	private _baseUrl = `https://api.githubcopilot.com`;
	private _baseModel = ""; // Will be set dynamically from available models
	public modelDetails: any = null;
	private _modelCapabilities: any = null; // Store model capabilities
	private _provider?: AxAI<string>;
	private initializationPromise: Promise<void> | undefined;

	private _initialized = false;

	public get provider(): AxAI<string> {
		if (!this._initialized || !this.copilotToken) {
			throw new Error("CopilotChatProvider is not initialized");
		}
		if (!this._provider) {
			this.provider = ai({
				name: 'openai',
				apiKey: this.copilotToken,
				apiURL: this.baseUrl,
				options: {
					fetch: (input: RequestInfo | URL, init?: RequestInit) => {
						init!.headers = {
							...init?.headers,
							...this.headers,
						};
						return fetch(input, init);
					}
				},
				config: {
					model: AxAIOpenAIModel.GPT5Mini,
				},
			});
		}
		return this._provider!;
	}
	public set provider(provider: AxAI<string>) {
		this._provider = provider;
	}

	public get modelCapabilities() {
		return this._modelCapabilities;
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

	// Static method to configure the singleton instance without forcing authentication
	public static async configure(
		context: vscode.ExtensionContext
	): Promise<CopilotChatProvider> {
		const instance = CopilotChatProvider.getInstance();
		await instance._configure(context);
		return instance;
	}

	// Method to check if provider is initialized
	public isInitialized(): boolean {
		return this._initialized;
	}

	private async _configure(context: vscode.ExtensionContext): Promise<void> {
		if (!this._context) {
			this._context = context;
			this.registerListeners(context);
		}
		// Attempt silent initialization for returning users; ignore failures
		await this.ensureInitialized({ interactive: false });
	}

	public async tryEnsureInitialized(): Promise<boolean> {
		await this.ensureInitialized({ interactive: false });
		return this._initialized;
	}

	public async ensureInitialized(options?: { interactive?: boolean }): Promise<void> {
		const interactive = options?.interactive ?? true;
		if (this._initialized) {
			return;
		}
		if (!this._context) {
			throw new Error("CopilotChatProvider has not been configured");
		}
		if (this.initializationPromise) {
			await this.initializationPromise;
			return;
		}
		this.initializationPromise = this.initializeSession(interactive);
		try {
			await this.initializationPromise;
		} finally {
			this.initializationPromise = undefined;
		}
	}

	public async getProvider(options?: { interactive?: boolean }): Promise<AxAI> {
		await this.ensureInitialized(options);
		return this.provider;
	}

	private async initializeSession(interactive: boolean): Promise<void> {
		try {
			const session = await vscode.authentication.getSession(
				GITHUB_AUTH_PROVIDER_ID,
				SCOPES,
				{ createIfNone: interactive }
			);
			if (!session) {
				// Silent initialization failed; wait for user-triggered call.
				return;
			}
			this.session = session;
			this.copilotToken = undefined;
		this._provider = undefined;
			this._headers = { ...this.defaultHeaders };
			await this.getCopilotToken(this._context!);
			const existingSessions = await vscode.authentication.getAccounts(
				GITHUB_AUTH_PROVIDER_ID
			);
			console.log("existingSessions", existingSessions);
			this._initialized = true;
			console.log("CopilotChatProvider initialization complete");
		} catch (error) {
			if (interactive) {
				logError(error as Error, 'github-authentication', {
					provider: GITHUB_AUTH_PROVIDER_ID,
					scopes: SCOPES.join(','),
					createIfNone: interactive,
				});
				vscode.window.showErrorMessage(
					"GitHub authentication failed. Please sign in to GitHub."
				);
				throw error;
			}
		}
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
						...this.headers,
					},
				}
			);

			if (githubTokenResponse.ok) {
				const tokenData = await githubTokenResponse.json();
				console.dir(tokenData, { depth: null, colors: true });
				if (tokenData.token) {
					this.copilotToken = tokenData.token;
					await context.globalState.update(
						"copilotToken",
						this.copilotToken
					);
					console.log(
						"Successfully retrieved Copilot token from GitHub API"
					);
					if (tokenData.endpoints.api) {
						console.log("Got and api url.");
						this.baseUrl = tokenData.endpoints.api;

						const userResponseTest = await fetch(
							`${GITHUB_API_BASE_URL}/copilot_internal/user`,
							{
								headers: {
									...this.headers,
									Authorization: `token ${this.session.accessToken}`,
								},
							}
						);
						if (userResponseTest.ok) {
							const userdata = await userResponseTest.json();
							console.dir(userdata, {
								depth: null,
								colors: true,
							});
							this._headers = {
								...this._headers,
								Authorization: `Bearer ${this.copilotToken}`,
							};
						} else {
							console.log(
								"failed to fetch user data from copilot internal"
							);
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
						vscode.env.openExternal(
							vscode.Uri.parse(verification_uri)
						);
					}
				});

			// Step 2: Poll for user authentication completion
			let authenticated = false;
			const pollingInterval = (interval || 5) * 1000; // Default to 5 seconds if not provided

			while (!authenticated) {
				await new Promise((resolve) =>
					setTimeout(resolve, pollingInterval)
				);

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
							grant_type:
								"urn:ietf:params:oauth:grant-type:device_code",
						}),
					}
				);

				const tokenData = await tokenResponse.json();

				if (tokenData.access_token) {
					this.copilotToken = tokenData.access_token;
					authenticated = true;

					// Store the token for future use
					await context.globalState.update(
						"copilotToken",
						this.copilotToken
					);

					vscode.window.showInformationMessage(
						"GitHub Copilot authentication successful!"
					);

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
			
			// Log token retrieval failure with standardized telemetry
			logError(error, 'copilot-token-retrieval', {
				clientId: GITHUB_COPILOT_CLIENT_ID,
				context: 'token-exchange',
			});
			
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
					this.session = undefined;
					this.copilotToken = undefined;
		this._provider = undefined;
					this._headers = { ...this.defaultHeaders };
					this._initialized = false;
					try {
						await this.ensureInitialized({ interactive: false });
					} catch (sessionError) {
						console.warn("Silent GitHub session refresh failed", sessionError);
					}
				}
			})
		);
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
		if (!this._initialized) {
			throw new Error("CopilotChatProvider is not initialized");
		}
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
		} catch (error) {
			console.log("getModels failed");
			throw error;
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
