import { logger, flushTelemetry } from "./telemetry";
import {
	initializeContext,
	logExtensionActivate,
	logError,
	logEvent,
} from "./telemetry/standardizedTelemetry";
import { TelemetryEvents } from "./telemetry/types";
import * as vscode from "vscode";
import { CopilotMcpViewProvider } from "./panels/ExtensionPanel";
import { GITHUB_AUTH_PROVIDER_ID, SCOPES } from "./utilities/const";
import { CopilotChatProvider } from "./utilities/CopilotChat";
import { handler } from "./McpAgent";
import { cloudMcpIndexer } from "./utilities/cloudMcpIndexer";
import { outputLogger, LogLevel } from "./utilities/outputLogger";

// Helper function to convert string to LogLevel enum
function getLogLevelFromString(level: string): LogLevel {
	switch (level.toLowerCase()) {
		case "debug":
			return LogLevel.DEBUG;
		case "info":
			return LogLevel.INFO;
		case "warn":
			return LogLevel.WARN;
		case "error":
			return LogLevel.ERROR;
		case "none":
			return LogLevel.NONE;
		default:
			return LogLevel.INFO;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// Initialize output logger with configuration
	const config = vscode.workspace.getConfiguration("copilotMcp");
	const logLevelConfig = config.get<string>("logLevel", "info");
	const logLevel = getLogLevelFromString(logLevelConfig);
	outputLogger.setLogLevel(logLevel);

	// Watch for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("copilotMcp.logLevel")) {
				const newLogLevel = vscode.workspace
					.getConfiguration("copilotMcp")
					.get<string>("logLevel", "info");
				outputLogger.setLogLevel(getLogLevelFromString(newLogLevel));
				outputLogger.info(`Log level changed to: ${newLogLevel}`);
			}
		}),
	);

	context.subscriptions.push({ dispose: () => outputLogger.dispose() });
	outputLogger.info("Copilot MCP extension activation started");

	context.subscriptions.push(logger);
	// console.dir(await vscode.authentication.getAccounts('github'), {depth: null});
	outputLogger.debug("Checking for existing GitHub authentication session");
	let session: vscode.AuthenticationSession | undefined;
	try {
		session = await vscode.authentication.getSession(
			GITHUB_AUTH_PROVIDER_ID,
			SCOPES,
			{ createIfNone: false },
		);
	} catch (error) {
		outputLogger.warn(
			"Failed to retrieve existing GitHub session",
			error as Error,
		);
	}

	outputLogger.info("Configuring Copilot MCP LM Provider");
	const copilot = await CopilotChatProvider.configure(context);
	const initialized = await copilot.tryEnsureInitialized();
	if (initialized) {
		try {
			const models = await copilot.getModels();
			outputLogger.info("Available Copilot models", models);
		} catch (modelError) {
			outputLogger.warn(
				"Failed to retrieve Copilot models",
				modelError as Error,
			);
		}
	} else {
		outputLogger.debug(
			"Copilot provider not initialized yet; will initialize on demand",
		);
	}

	// Initialize standardized telemetry context
	const extensionVersion =
		vscode.extensions.getExtension("AutomataLabs.copilot-mcp")?.packageJSON
			?.version || "unknown";
	initializeContext(session, extensionVersion);

	// Initialize CloudMCP indexer
	outputLogger.info("Initializing CloudMCP indexer");
	cloudMcpIndexer.initialize(context);

	// Log extension activation with new standardized telemetry
	logExtensionActivate(vscode.env.isNewAppInstall);
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	outputLogger.info("Copilot MCP extension is now active!", {
		version: extensionVersion,
		isNewInstall: vscode.env.isNewAppInstall,
	});

	outputLogger.debug("Creating CopilotMcpViewProvider");
	const provider = new CopilotMcpViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			CopilotMcpViewProvider.viewType,
			provider,
		),
	);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			CopilotMcpViewProvider.launcherViewType,
			provider,
		),
	);
	outputLogger.info("Webview provider registered");

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const helloWorldCommand = vscode.commands.registerCommand(
		"copilot-mcp.helloWorld",
		() => {
			// The code you place here will be executed every time your command is executed
			// Display a message box to the user
			vscode.window.showInformationMessage(
				"Hello World from copilot-mcp!",
			);
		},
	);

	const showLogsCommand = vscode.commands.registerCommand(
		"copilot-mcp.showLogs",
		() => {
			outputLogger.show();
		},
	);

	context.subscriptions.push(helloWorldCommand, showLogsCommand);

	// Register the chat participant and its request handler
	outputLogger.debug("Registering MCP chat participant");
	const mcpChatAgent = vscode.chat.createChatParticipant(
		"copilot.mcp-agent",
		handler,
	);
	outputLogger.info("MCP chat participant registered");

	// Optionally, set some properties for @cat
	mcpChatAgent.iconPath = vscode.Uri.joinPath(
		context.extensionUri,
		"logo.png",
	);

	// Show "What's New" page if the extension has been updated
	await showUpdatesToUser(context);
}

// Remote source of truth for the What's New page; the bundled copy is the fallback.
const WHATS_NEW_REMOTE_URL =
	"https://raw.githubusercontent.com/VikashLoomba/copilot-mcp/main/WHATS_NEW.md";
// Base URL (derived from WHATS_NEW_REMOTE_URL) for resolving the doc's
// relative image/link refs once it is staged outside the repo.
const WHATS_NEW_REMOTE_BASE_URL = WHATS_NEW_REMOTE_URL.slice(
	0,
	WHATS_NEW_REMOTE_URL.lastIndexOf("/") + 1,
);
const WHATS_NEW_FETCH_TIMEOUT_MS = 3000;
// Sanity bounds for the remote body; anything outside falls back to the bundled file.
const WHATS_NEW_MIN_LENGTH = 200;
const WHATS_NEW_MAX_LENGTH = 1024 * 1024; // 1MB

/**
 * Best-effort fetch of the latest WHATS_NEW.md from the repo, staged into the
 * extension's global storage so the Markdown preview can open it. Returns
 * undefined on ANY failure (timeout, non-200, implausible body, fs error) so
 * the caller falls back to the bundled copy — this never throws or rejects.
 */
async function tryStageRemoteWhatsNew(
	context: vscode.ExtensionContext,
): Promise<vscode.Uri | undefined> {
	try {
		const response = await fetch(WHATS_NEW_REMOTE_URL, {
			cache: "no-store",
			signal: AbortSignal.timeout(WHATS_NEW_FETCH_TIMEOUT_MS),
		});
		if (response.status !== 200) {
			return undefined;
		}
		const body = await response.text();
		// Only trust a body that plausibly is our markdown document.
		if (
			!body.trim().startsWith("#") ||
			body.length <= WHATS_NEW_MIN_LENGTH ||
			body.length >= WHATS_NEW_MAX_LENGTH
		) {
			return undefined;
		}
		// The doc references images by relative path (they sit next to it in
		// the repo and in the installed extension, but NOT in global storage),
		// so rewrite relative link/image targets to absolute raw URLs. The
		// Markdown preview's default security mode allows https images.
		const stagedBody = body.replace(
			/\]\((?!https?:|#)([^)]+)\)/g,
			`](${WHATS_NEW_REMOTE_BASE_URL}$1)`,
		);
		await vscode.workspace.fs.createDirectory(context.globalStorageUri);
		const stagedUri = vscode.Uri.joinPath(
			context.globalStorageUri,
			"WHATS_NEW.md",
		);
		await vscode.workspace.fs.writeFile(
			stagedUri,
			new TextEncoder().encode(stagedBody),
		);
		return stagedUri;
	} catch (error) {
		outputLogger.debug(
			"Remote WHATS_NEW.md unavailable; falling back to bundled copy",
			error as Error,
		);
		return undefined;
	}
}

// Helper that shows the WHATS_NEW.md preview when appropriate
async function showUpdatesToUser(context: vscode.ExtensionContext) {
	let currentVersion = "unknown";
	let lastVersion: string | undefined;

	try {
		// Locate this extension in VS Code's registry so we can read its package.json metadata
		const thisExtension = vscode.extensions.all.find(
			(ext) =>
				ext.extensionUri.toString() === context.extensionUri.toString(),
		);
		if (!thisExtension) {
			return; // Should never happen, but guard just in case
		}

		currentVersion = thisExtension.packageJSON.version;
		const storageKey = "copilotMcp.whatsNewVersionShown";
		lastVersion = context.globalState.get(storageKey);

		// Show the What's New page only for new installs or when the user upgrades to a version they haven't seen yet
		if (lastVersion === currentVersion) {
			return; // User has already been shown this version's notes
		}

		// Open WHATS_NEW.md in the built-in Markdown preview. Remote-first:
		// try the latest notes from the repo, but fall back to the file
		// bundled with the extension on ANY failure so the page always opens.
		let whatsNewUri = vscode.Uri.joinPath(
			context.extensionUri,
			"WHATS_NEW.md",
		);
		let whatsNewSource: "remote" | "bundled" = "bundled";
		const remoteUri = await tryStageRemoteWhatsNew(context);
		if (remoteUri) {
			whatsNewUri = remoteUri;
			whatsNewSource = "remote";
		}
		await vscode.commands.executeCommand(
			"markdown.showPreview",
			whatsNewUri,
		);

		// Persist that we've shown the notes for this version so we don't show again
		await context.globalState.update(storageKey, currentVersion);

		// Impression telemetry (sender maps the name to ext.whats_new_shown);
		// the logger/sender are fail-safe and never throw into activation.
		logEvent({
			name: TelemetryEvents.WHATS_NEW_SHOWN,
			properties: {
				version: currentVersion,
				source: whatsNewSource,
			},
		});
	} catch (error) {
		outputLogger.error(
			"Failed to display What's New information",
			error as Error,
		);
		// Log error with standardized telemetry
		logError(error as Error, "whats-new-display", {
			currentVersion,
			lastVersion: lastVersion || "none",
		});
	}
}

// This method is called when your extension is deactivated
export function deactivate(): Thenable<void> {
	outputLogger.info("Copilot MCP extension deactivating");
	// Log extension deactivation
	logEvent({
		name: TelemetryEvents.EXTENSION_DEACTIVATE,
		properties: {
			timestamp: new Date().toISOString(),
		},
	});
	// Flush pending telemetry; flushTelemetry races an internal 2s timeout
	// and never rejects, so shutdown can never hang on the network.
	return flushTelemetry();
}
