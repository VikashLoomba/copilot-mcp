import { logger, getLogger } from "./telemetry";
import { setCommonLogAttributes } from "./utilities/signoz";
import { shutdownLogs } from "./utilities/logging";
import { initializeContext, logExtensionActivate, logError, logEvent } from "./telemetry/standardizedTelemetry";
import { TelemetryEvents } from "./telemetry/types";
import * as vscode from "vscode";
import { TelemetryReporter } from "@vscode/extension-telemetry";
import { CopilotMcpViewProvider } from "./panels/ExtensionPanel";
import { GITHUB_AUTH_PROVIDER_ID, SCOPES } from "./utilities/const";
import { CopilotChatProvider } from "./utilities/CopilotChat";
import { handler } from "./McpAgent";
import { cloudMcpIndexer } from "./utilities/cloudMcpIndexer";
const connectionString =
	"InstrumentationKey=2c71cf43-4cb2-4e25-97c9-bd72614a9fe8;IngestionEndpoint=https://westus2-2.in.applicationinsights.azure.com/;LiveEndpoint=https://westus2.livediagnostics.monitor.azure.com/;ApplicationId=862c3c9c-392a-4a12-8475-5c9ebeff7aaf";
const telemetryReporter = new TelemetryReporter(connectionString);

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	const Octokit = await import("@octokit/rest");
	context.subscriptions.push(logger, { dispose: shutdownLogs });
	context.subscriptions.push(telemetryReporter);
	// console.dir(await vscode.authentication.getAccounts('github'), {depth: null});
	const session = await vscode.authentication.getSession(
		GITHUB_AUTH_PROVIDER_ID,
		SCOPES,
		{ createIfNone: true }
	);
	const octokit = new Octokit.Octokit({
		auth: session.accessToken,
	});
	console.log("Initializing Copilot Provider");
	const copilot = await CopilotChatProvider.initialize(context);
	const models = await copilot.getModels();
	
	// Initialize standardized telemetry context  
	const extensionVersion = vscode.extensions.getExtension('AutomataLabs.copilot-mcp')?.packageJSON?.version || 'unknown';
	initializeContext(session, extensionVersion);
	setCommonLogAttributes({ ...session.account });
	
	// Initialize CloudMCP indexer
	cloudMcpIndexer.initialize(context);
	
	// Log extension activation with new standardized telemetry
	logExtensionActivate(vscode.env.isNewAppInstall);
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "copilot-mcp" is now active!');
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand(
		"copilot-mcp.helloWorld",
		() => {
			// The code you place here will be executed every time your command is executed
			// Display a message box to the user
			vscode.window.showInformationMessage(
				"Hello World from copilot-mcp!"
			);
		}
	);

	context.subscriptions.push(disposable);

	const provider = new CopilotMcpViewProvider(
		context.extensionUri,
		session.accessToken,
		telemetryReporter,
		session
	);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			CopilotMcpViewProvider.viewType,
			provider
		)
	);

	// Register the chat participant and its request handler
	const mcpChatAgent = vscode.chat.createChatParticipant(
		"copilot.mcp-agent",
		handler
	);

	// Optionally, set some properties for @cat
	mcpChatAgent.iconPath = vscode.Uri.joinPath(
		context.extensionUri,
		"logo.png"
	);

	// Show "What's New" page if the extension has been updated
	await showUpdatesToUser(context);
}

// Helper that shows the WHATS_NEW.md preview when appropriate
async function showUpdatesToUser(context: vscode.ExtensionContext) {
	let currentVersion = 'unknown';
	let lastVersion: string | undefined;
	
	try {
		// Locate this extension in VS Code's registry so we can read its package.json metadata
		const thisExtension = vscode.extensions.all.find(
			ext => ext.extensionUri.toString() === context.extensionUri.toString()
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

		// Open the WHATS_NEW.md file bundled with the extension in the built-in Markdown preview
		const whatsNewUri = vscode.Uri.joinPath(context.extensionUri, "WHATS_NEW.md");
		await vscode.commands.executeCommand("markdown.showPreview", whatsNewUri);

		// Persist that we've shown the notes for this version so we don't show again
		await context.globalState.update(storageKey, currentVersion);
	} catch (error) {
		console.error("Failed to display What's New information:", error);
		// Log error with standardized telemetry
		logError(error as Error, 'whats-new-display', {
			currentVersion,
			lastVersion: lastVersion || 'none',
		});
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Log extension deactivation
	logEvent({
		name: TelemetryEvents.EXTENSION_DEACTIVATE,
		properties: {
			timestamp: new Date().toISOString(),
		},
	});
}
