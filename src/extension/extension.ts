import * as vscode from 'vscode';
// Import WebSocket polyfill (must be first)
import './polyfills/websocket-polyfill';
import '@vscode/prompt-tsx';
// Import our architectural components
import { ServerViewProvider } from './ServerViewProvider';
import { ServerConfig } from './ServerConfig';
import { registerServerAndClients } from './toolInitHelpers';
// import { CopilotChatProvider } from '@/lib/Github';
import { startMcpServer } from './tools/mcp-tools';

/**
 * Show a message that auto-dismisses after a specified timeout
 * @param message Message to display
 * @param type Type of message (info, warning, error)
 * @param durationMs Duration in milliseconds before auto-dismissing 
 */
function showAutoDisposableMessage(message: string, type: 'info' | 'warning' | 'error' = 'info', durationMs: number = 5000): vscode.Disposable {
    // Always show in status bar
    const statusBarDisposable = vscode.window.setStatusBarMessage(message, durationMs);

    // Show notification based on type
    if (type === 'error') {
        vscode.window.showErrorMessage(message, { modal: false });
    } else if (type === 'warning') {
        vscode.window.showWarningMessage(message, { modal: false });
    } else {
        vscode.window.showInformationMessage(message, { modal: false });
    }

    // VSCode automatically manages notification dismissal, so we don't need to do it manually
    // Just return the status bar disposable
    return statusBarDisposable;
}

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
    // Show loading notification as soon as extension starts activating
    const loadingNotification = vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'MCP Extension',
        cancellable: false
    }, async (progress) => {
        progress.report({ message: 'Initializing MCP servers...' });

        // Return a promise that resolves when everything is loaded
        return new Promise<void>(async (resolve) => {
            try {

                // try {
                //     const copilot = await CopilotChatProvider.initialize(context);
                //     progress.report({ message: 'Connecting to Copilot...' });

                //     console.log('Models:', await copilot.getModelId());
                // } catch (error) {
                //     console.log('Couldnt connect to copilot API directly - falling back to Copilot Chat', error);
                // }

                console.log('Workspace folders:', vscode.workspace.workspaceFolders);
                console.log('Starting activation of copilot-mcp extension...');

                progress.report({ message: 'Starting MCP server...' });
                const { server, client, tools, dispose } = await startMcpServer();

                context.subscriptions.push(...tools, {
                    dispose: () => {
                        dispose();
                        server.dispose();
                    }
                });

                try {
                    console.log('Initializing extension...');
                    progress.report({ message: 'Loading configured servers...' });

                    // Get servers from configuration
                    const config = vscode.workspace.getConfiguration('mcpManager');
                    const servers = config.get<ServerConfig[]>('servers', []);
                    console.log(`Servers: ${JSON.stringify(servers)}`);
                    const clients = await registerServerAndClients(servers, context);

                    // Register the WebView Provider using our ServerViewProvider class
                    progress.report({ message: 'Starting server manager UI...' });
                    await ServerViewProvider.createOrShow(context, clients);

                    console.log('copilot-mcp extension activated successfully');
                    progress.report({ message: 'MCP Extension activated successfully!' });

                    registerVscodeEvents(context);
                    const res = await client.ping();
                    console.log('ping res', res);
                    // Resolve the promise to complete the loading notification
                    resolve();
                } catch (error) {
                    console.debug(`Error during extension activation: ${error}`);
                    const errorMessage = `Failed to activate the extension: ${error instanceof Error ? error.message : 'Unknown error'}`;

                    // Show error with auto-dismiss
                    showAutoDisposableMessage(errorMessage, 'error', 10000);

                    resolve(); // Resolve even on error to ensure the progress completes
                }
            } catch (error) {
                console.debug(`Error during extension activation: ${error}`);
                const errorMessage = `Failed to activate the extension: ${error instanceof Error ? error.message : 'Unknown error'}`;

                // Show error with auto-dismiss
                showAutoDisposableMessage(errorMessage, 'error', 10000);

                resolve(); // Resolve even on error to ensure the progress completes
            }
        });
    });

    // After the progress notification is done, show a final success message
    loadingNotification.then(() => {
        // Get the server count
        const config = vscode.workspace.getConfiguration('mcpManager');
        const servers = config.get<ServerConfig[]>('servers', []);
        const activeServers = servers.filter(s => s.enabled).length;

        if (activeServers > 0) {
            showAutoDisposableMessage(`MCP Extension loaded with ${activeServers} active server${activeServers !== 1 ? 's' : ''}`);
        } else {
            showAutoDisposableMessage('MCP Extension loaded. No active servers configured.');
        }
    });
}

const registerVscodeEvents = (context: vscode.ExtensionContext) => {
    const configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('mcpManager',)) {
            console.log('Servers configuration changed, triggering reload');

            // Show a notification before restarting
            const message = 'MCP Server configuration changed. Restarting extension and loading servers...';
            showAutoDisposableMessage(message, 'info', 3000);

            // Give the notification time to show before restarting
            setTimeout(() => {
                // reload the extension
                vscode.commands.executeCommand('workbench.action.restartExtensionHost');
            }, 1000);
        }
    });
    context.subscriptions.push(configSubscription);

    // Register the openServerManager command
    const openManagerCommand = vscode.commands.registerCommand('copilot-mcp.openServerManager', async () => {
        try {
            await vscode.commands.executeCommand('workbench.view.extension.mcpServers');
        } catch (error) {
            console.warn(`Failed to open server manager: ${error}`);
        }
    });
    context.subscriptions.push(openManagerCommand);
};
// This method is called when your extension is deactivated
export function deactivate() {
    try {
        console.log('Deactivating MCP extension...');

        // The components will be disposed through the context subscriptions
        // Nothing extra to do here for now

        console.log('MCP extension deactivated successfully');
    } catch (error) {
        console.error('Error during extension deactivation:', error);
    }
}

