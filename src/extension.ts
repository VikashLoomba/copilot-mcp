// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { CopilotMcpViewProvider } from './panels/ExtensionPanel';
const GITHUB_AUTH_PROVIDER_ID = 'github';
const SCOPES = ['user:email', "read:org",
    "read:user",
    "repo",
    "workflow",];
	
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	const Octokit = await import("@octokit/rest");
	const session = await vscode.authentication.getSession(GITHUB_AUTH_PROVIDER_ID, SCOPES, { createIfNone: true });
	const octokit = new Octokit.Octokit({
		auth: session.accessToken
	});
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "copilot-mcp" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('copilot-mcp.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from copilot-mcp!');
	});

	context.subscriptions.push(disposable);

	const provider = new CopilotMcpViewProvider(context.extensionUri, session.accessToken);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(CopilotMcpViewProvider.viewType, provider)
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
