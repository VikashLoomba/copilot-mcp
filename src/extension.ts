import { logger, getLogger } from "./telemetry";
import { setCommonLogAttributes } from "./utilities/signoz";
import { shutdownLogs } from "./utilities/logging";
import * as vscode from "vscode";
import { TelemetryReporter } from "@vscode/extension-telemetry";
import { CopilotMcpViewProvider } from "./panels/ExtensionPanel";
import { GITHUB_AUTH_PROVIDER_ID, SCOPES } from "./utilities/const";
import { CopilotChatProvider } from "./utilities/CopilotChat";
import { handler } from "./McpAgent";
const connectionString =
	"InstrumentationKey=2c71cf43-4cb2-4e25-97c9-bd72614a9fe8;IngestionEndpoint=https://westus2-2.in.applicationinsights.azure.com/;LiveEndpoint=https://westus2.livediagnostics.monitor.azure.com/;ApplicationId=862c3c9c-392a-4a12-8475-5c9ebeff7aaf";
const telemetryReporter = new TelemetryReporter(connectionString);

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	
	const Octokit = await import("@octokit/rest");
	context.subscriptions.push(logger, { dispose: shutdownLogs });
	context.subscriptions.push(telemetryReporter);
	context.subscriptions.push(logger);
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
	setCommonLogAttributes({ ...session.account });
	if (vscode.env.isNewAppInstall) {
		getLogger().logUsage("newUserInstall");
	}
	getLogger().logUsage("activate");
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
	// await showUpdatesToUser(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
