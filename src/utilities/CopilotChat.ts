import * as vscode from "vscode";

import { ai, AxAI, AxAIOpenAIModel } from "@ax-llm/ax";
import { logError, logEvent } from "../telemetry/standardizedTelemetry";

const GITHUB_AUTH_PROVIDER_ID = "github";
// The GitHub Authentication Provider accepts the scopes described here:
// https://developer.github.com/apps/building-oauth-apps/understanding-scopes-for-oauth-apps/
const SCOPES = ["user:email", "read:org", "read:user"];
const GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"; // This is a public client ID for Copilot

// Known-good fallback model used when the live Copilot /models catalog cannot
// be reached or returns nothing usable. Must be a currently-GA Copilot model:
// 'gpt-5.2-codex' was retired 2026-06-01, so we lead getModelId() with
// claude-sonnet-4.6 (safest for structured extraction) and fall back here.
const FALLBACK_MODEL_ID = "gpt-5.3-codex";
// Upper bound on the live /models lookup during provider construction so a slow
// or hung catalog request can never stall initialization; on timeout we use the
// fallback model instead.
const MODEL_RESOLUTION_TIMEOUT_MS = 4000;

/**
 * True when a failed background auth/token attempt is an *expected* unavailable
 * state (the user is simply signed out or offline) rather than a real fault.
 * These dominate error.general volume during the activation-time auth probe
 * (issue #58.3: "device_code has expired", "fetch failed"), so they are routed
 * to a non-error signal instead. Matches conservatively on the underlying
 * error/cause text so genuine faults still surface as errors.
 */
function isExpectedBackgroundAuthFailure(error: unknown): boolean {
	const parts: string[] = [];
	let current: unknown = error;
	// Walk the cause chain (bounded) so a wrapped 'fetch failed' is still seen.
	for (let depth = 0; depth < 4 && current; depth++) {
		if (typeof current === "string") {
			parts.push(current);
			break;
		}
		if (typeof current === "object") {
			const e = current as { message?: unknown; cause?: unknown };
			if (typeof e.message === "string") {
				parts.push(e.message);
			}
			current = e.cause;
		} else {
			break;
		}
	}
	const text = parts.join(" ").toLowerCase();
	return (
		text.includes("device_code has expired") ||
		text.includes("device_code") ||
		text.includes("expired_token") ||
		text.includes("authorization_pending") ||
		text.includes("slow_down") ||
		text.includes("fetch failed") ||
		text.includes("network") ||
		text.includes("enotfound") ||
		text.includes("econnrefused") ||
		text.includes("etimedout") ||
		text.includes("offline")
	);
}

/**
 * Records an expected "auth not available" condition as a non-error telemetry
 * signal (ext.auth.unavailable) so background probe failures don't inflate
 * error.general. Fail-safe: never throws into the caller. `reason` is a short,
 * non-secret label (no 'token'/'secret'/'auth'/'key'/'user'/'session' key).
 */
function logAuthUnavailable(error: unknown, site: string): void {
	try {
		const cls =
			error instanceof Error
				? error.constructor?.name || "Error"
				: typeof error;
		logEvent({
			name: "auth.unavailable",
			properties: {
				reason: site.slice(0, 32),
				cause_class: cls.slice(0, 200),
			},
		});
	} catch {
		// Telemetry must never break auth flow.
	}
}

export class CopilotChatProvider {
	public _context: vscode.ExtensionContext | undefined;
	private static instance: CopilotChatProvider;
	private session: vscode.AuthenticationSession | undefined;
	private copilotToken: string | undefined;
	private readonly defaultHeaders: Record<string, string> = {
		"Editor-Version": `vscode/${vscode.version}`,
		"Editor-Plugin-Version": "copilot-chat/0.35.0",
		"User-Agent": "GitHubCopilotChat/0.35.0",
		"Copilot-Integration-Id": "vscode-chat",
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
			// Use the model resolved from the live Copilot /models catalog during
			// initialization (see resolveBaseModel). If that never ran or came up
			// empty, fall back to a known-good GA model rather than a retired one.
			const model = this._baseModel || FALLBACK_MODEL_ID;
			this.provider = ai(
				//@ts-expect-error config.model is typed as the AxAIOpenAIModel enum, but the live Copilot catalog id is a valid model string.
				{
					name: "openai",
					apiKey: this.copilotToken,
					apiURL: this.baseUrl,
					options: {
						fetch: (
							input: RequestInfo | URL,
							init?: RequestInit,
						) => {
							init!.headers = {
								...init?.headers,
								...this.headers,
							};
							return fetch(input, init);
						},
					},
					config: {
						model,
					},
				},
			);
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
		context: vscode.ExtensionContext,
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

	public async ensureInitialized(options?: {
		interactive?: boolean;
	}): Promise<void> {
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

	public async getProvider(options?: {
		interactive?: boolean;
	}): Promise<AxAI> {
		await this.ensureInitialized(options);
		return this.provider;
	}

	private async initializeSession(interactive: boolean): Promise<void> {
		try {
			const session = await vscode.authentication.getSession(
				GITHUB_AUTH_PROVIDER_ID,
				SCOPES,
				{ createIfNone: interactive },
			);
			if (!session) {
				// Silent initialization failed; wait for user-triggered call.
				return;
			}
			this.session = session;
			this.copilotToken = undefined;
			this._provider = undefined;
			this._baseModel = "";
			this._headers = { ...this.defaultHeaders };
			await this.getCopilotToken(this._context!, interactive);
			// Resolve the chat model from the live Copilot /models catalog now that
			// the bearer header is set, so the (synchronous) provider getter can read
			// a current model id instead of a hardcoded — and possibly retired — one.
			await this.resolveBaseModel();
			const existingSessions = await vscode.authentication.getAccounts(
				GITHUB_AUTH_PROVIDER_ID,
			);
			console.log("existingSessions", existingSessions);
			this._initialized = true;
			console.log("CopilotChatProvider initialization complete");
		} catch (error) {
			if (interactive) {
				// error_site renamed off 'github-authentication': the substring
				// 'auth' is PII-scrubbed by the telemetry sender, which blinded
				// these events (issue #58.1). 'github-signin' carries no
				// secret-pattern substring.
				logError(error as Error, "github-signin", {
					provider: GITHUB_AUTH_PROVIDER_ID,
					scopes: SCOPES.join(","),
					createIfNone: interactive,
				});
				vscode.window.showErrorMessage(
					"GitHub authentication failed. Please sign in to GitHub.",
				);
				throw error;
			} else {
				// Background (silent) probe: a missing/expired session is the
				// expected steady state for signed-out users, not an error, so it
				// must never reach error.general (issue #58.3). Token-exchange
				// failures already self-report inside getCopilotToken and arrive
				// here flagged telemetryReported; this outer branch then only
				// emits for the rarer getSession-origin faults, which during a
				// silent probe are themselves an "auth unavailable" condition.
				// Emit the non-error signal and wait for a user-triggered call.
				const reported =
					typeof error === "object" &&
					error !== null &&
					(error as { telemetryReported?: boolean }).telemetryReported === true;
				if (!reported) {
					logAuthUnavailable(error, "signin-probe");
				}
				console.warn("Silent GitHub initialization failed", error);
			}
		}
	}

	private async getCopilotToken(
		context: vscode.ExtensionContext,
		// True only for user-initiated flows. Defaults to background-safe so any
		// future caller is treated as a silent probe (expected-unavailable
		// failures are not surfaced as errors) unless it opts in.
		interactive: boolean = false,
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
				},
			);

			if (githubTokenResponse.ok) {
				const tokenData = await githubTokenResponse.json();
				console.dir(tokenData, { depth: null, colors: true });
				if (tokenData.token) {
					this.copilotToken = tokenData.token;
					await context.globalState.update(
						"copilotToken",
						this.copilotToken,
					);
					console.log(
						"Successfully retrieved Copilot token from GitHub API",
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
							},
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
								"failed to fetch user data from copilot internal",
							);
							console.log(await userResponseTest.text());
						}
					}
					return;
				}
			}

			console.log(
				"Could not get Copilot token from GitHub API, falling back to device flow",
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
						"User-Agent": "GitHubCopilotChat/0.35.0",
					},
					body: JSON.stringify({
						client_id: GITHUB_COPILOT_CLIENT_ID,
						scope: "read:user",
					}),
				},
			);

			if (!deviceCodeResponse.ok) {
				throw new Error(
					`Failed to get device code: ${deviceCodeResponse.statusText}`,
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
							vscode.Uri.parse(verification_uri),
						);
					}
				});

			// Step 2: Poll for user authentication completion
			let authenticated = false;
			const pollingInterval = (interval || 5) * 1000; // Default to 5 seconds if not provided

			while (!authenticated) {
				await new Promise((resolve) =>
					setTimeout(resolve, pollingInterval),
				);

				const tokenResponse = await fetch(
					"https://github.com/login/oauth/access_token",
					{
						method: "POST",
						headers: {
							Accept: "application/json",
							"Content-Type": "application/json",
							"User-Agent": "GitHubCopilotChat/0.35.0",
						},
						body: JSON.stringify({
							client_id: GITHUB_COPILOT_CLIENT_ID,
							device_code: device_code,
							grant_type:
								"urn:ietf:params:oauth:grant-type:device_code",
						}),
					},
				);

				const tokenData = await tokenResponse.json();

				if (tokenData.access_token) {
					this.copilotToken = tokenData.access_token;
					authenticated = true;

					// Store the token for future use
					await context.globalState.update(
						"copilotToken",
						this.copilotToken,
					);

					vscode.window.showInformationMessage(
						"GitHub Copilot authentication successful!",
					);
				} else if (tokenData.error === "authorization_pending") {
					// User hasn't completed authentication yet, continue polling
					continue;
				} else if (tokenData.error) {
					throw new Error(
						`Authentication error: ${
							tokenData.error_description || tokenData.error
						}`,
					);
				}
			}
		} catch (error: any) {
			console.error("Error getting Copilot token:", error);

			// During a background probe, an expired device code or an offline
			// network is the expected steady state, not a user-facing error
			// (issue #58.3). Route those to a non-error signal; surface everything
			// else, and anything from a user-initiated flow, as an error.
			// error_site renamed off 'copilot-token-retrieval': the substring
			// 'token' is PII-scrubbed by the telemetry sender, which blinded these
			// events (issue #58.1). 'copilot-credential-exchange' is clean.
			if (!interactive && isExpectedBackgroundAuthFailure(error)) {
				logAuthUnavailable(error, "copilot-credential-exchange");
			} else {
				logError(error, "copilot-credential-exchange", {
					clientId: GITHUB_COPILOT_CLIENT_ID,
				});
			}

			// Mark the wrapper so the initializeSession catch doesn't re-report a
			// failure we've already classified here (avoids a duplicate signal).
			const wrapped = new Error(
				`Failed to authenticate with GitHub Copilot: ${error.message}`,
			);
			(wrapped as { telemetryReported?: boolean }).telemetryReported = true;
			throw wrapped;
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
						console.warn(
							"Silent GitHub session refresh failed",
							sessionError,
						);
					}
				}
			}),
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
					response.statusText,
				);
				throw new Error(
					`Failed to fetch models: ${response.status} ${response.statusText}`,
				);
			}

			const data = await response.json();
			return data.data;
		} catch (error) {
			console.log("getModels failed");
			throw error;
		}
	}

	/**
	 * Resolves the chat model from the live Copilot /models catalog and stores it
	 * in this._baseModel for the provider getter to use. Safe to call during
	 * initialization: it never throws and never hangs — getModelId() is raced
	 * against a timeout, and any failure (network error, empty catalog, timeout)
	 * falls back to a known-good GA model so provider construction always has a
	 * valid model id.
	 */
	private async resolveBaseModel(): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("model resolution timed out")),
					MODEL_RESOLUTION_TIMEOUT_MS,
				);
				timer.unref?.();
			});
			const modelId = await Promise.race([this.getModelId(), timeout]);
			if (typeof modelId === "string" && modelId.length > 0) {
				return; // getModelId already set this._baseModel/_modelCapabilities
			}
			throw new Error("empty model id from catalog");
		} catch (error) {
			console.warn(
				`Falling back to ${FALLBACK_MODEL_ID}; live model resolution failed`,
				error,
			);
			this._baseModel = FALLBACK_MODEL_ID;
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
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
					response.statusText,
				);
				throw new Error(
					`Failed to fetch models: ${response.status} ${response.statusText}`,
				);
			}

			const data = await response.json();
			console.log("Available models:", JSON.stringify(data, null, 2));

			const models = data.data;
			// filter out the models that are not enabled for the current editor
			const enabledModels = models.filter(
				(model: any) => model.model_picker_enabled,
			);

			if (enabledModels.length === 0) {
				console.error("No enabled models found");
				throw new Error("No enabled models found");
			}

			// Find models matching the models we want in the exact order of
			// preference. claude-sonnet-4.6 leads (safest for structured README
			// extraction) followed by the GA gpt-5.3-codex. 'gpt-5.2-codex' is
			// deliberately omitted: GitHub retired it 2026-06-01 and selecting it
			// produces a 4xx on every request (issue #57).
			const preferredModelIds = [
				"claude-sonnet-4.6",
				"gpt-5.3-codex",
				"gpt-5.1-codex",
				"gpt-5.1-codex-codex-max",
			];

			// Instead of filter, we'll find the first model that matches our preferences in order
			for (const preferredId of preferredModelIds) {
				const foundModel = enabledModels.find(
					(model: any) => model.id === preferredId,
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
