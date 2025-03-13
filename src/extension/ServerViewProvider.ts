import * as vscode from 'vscode';
import { ErrorHandler } from './utils/ErrorHandler';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { EventBus } from './utils/EventBus';
import { ServerConfig, ServerEventType, ServerType } from './ServerConfig';
import { createToolsExtension, registerMCPServer, NamedClient, unregisterServerTools } from './toolInitHelpers';
import { ChatHandler } from './ChatHandler';
/**
 * WebviewProvider for the MCP Server Manager UI
 */
export class ServerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mcpServerManager';
    private _view?: vscode.WebviewView;

    /**
     * Creates a new server view provider
     * @param context The extension context
     * @param clientManager The client manager instance
     */
    constructor(
        private readonly context: vscode.ExtensionContext,
        private clients: NamedClient[]
    ) {
        // Listen for server events and update the UI accordingly
        this._setupEventListeners();
    }

    /**
     * Set up event listeners to update the UI based on server events
     */
    private _setupEventListeners(): void {
        // Listen for server events to update UI
        const eventBus = EventBus.getInstance();

        // Set up listeners for each event type
        const startedSubscription = eventBus.on(ServerEventType.SERVER_STARTED, (event: any) => {
            console.debug('[EVENT] Server started: ', event);
        });

        const stoppedSubscription = eventBus.on(ServerEventType.SERVER_STOPPED, (event: any) => {
            console.debug('[EVENT] Server stopped: ', event);
        });

        const toolsChangedSubscription = eventBus.on(ServerEventType.TOOLS_CHANGED, (event: any) => {
            console.debug('[EVENT] Tools changed: ', event);
            if (event.data?.tools) {
            }
        });

        const resourcesChangedSubscription = eventBus.on(ServerEventType.RESOURCES_CHANGED, (event: any) => {
            if (event.data?.resources) {
            }
        });

        // Add all subscriptions to context
        this.context.subscriptions.push(
            startedSubscription,
            stoppedSubscription,
            toolsChangedSubscription,
            resourcesChangedSubscription
        );
    }

    /**
     * Resolve the webview view
     * @param webviewView The webview view
     * @param context The webview context
     * @param token The cancellation token
     */
    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ): Promise<void> {
        this._view = webviewView;

        // Configure webview options
        webviewView.webview.options = {
            // Enable JavaScript in the webview
            enableScripts: true,
            // Restrict the webview to only load resources from the extension's directory
            localResourceRoots: [
                ...(vscode.workspace.workspaceFolders?.map(folder => folder.uri) || []),
                vscode.Uri.joinPath(this.context.extensionUri, 'dist')
            ]
        };

        // Set the initial HTML content with a loading placeholder
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(this._handleMessage, this);

        // Show loading indicator while initializing the webview
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Loading MCP Server Manager',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Initializing servers...' });
            // Send the initial server state to the webview
            await this._sendInitialState();
        });
    }

    /**
     * Send the initial server state to the webview
     */
    private async _sendInitialState(): Promise<void> {
        if (!this._view) {
            return;
        }
        try {
            // Notify webview that loading has started
            this._view.webview.postMessage({
                type: 'loadingStatus',
                status: 'started',
                message: 'Fetching server information...'
            });

            const servers: (ServerConfig & { tools: Tool[] })[] = [];
            for (let i = 0; i < this.clients.length; i++) {
                const client = this.clients[i];
                // Update loading progress
                this._view.webview.postMessage({
                    type: 'loadingStatus',
                    status: 'progress',
                    message: `Loading server ${i + 1} of ${this.clients.length}: ${client.name}`,
                    progress: (i / this.clients.length) * 100
                });

                let tools: Tool[] = [];
                try {
                    const toolsResponse = client.enabled ? await client.listTools() : { tools: [] };
                    tools = [...toolsResponse.tools];
                } catch (e) {
                    console.log(`Server tools not available for ${client.name}`, e);
                }

                servers.push({
                    name: client.name,
                    enabled: client.enabled,
                    tools: tools,
                    command: client.command,
                });
            }

            // Notify webview that tools are being processed
            this._view.webview.postMessage({
                type: 'loadingStatus',
                status: 'progress',
                message: 'Processing server tools...',
                progress: 90
            });

            // Send tools for each server separately after initial state
            // This ensures proper tool registration in the UI
            for (const server of servers) {
                if (server.tools && server.tools.length > 0) {
                    this._view.webview.postMessage({
                        type: 'updateServerTools',
                        name: server.name,
                        tools: server.tools,
                        enabled: server.enabled,
                    });
                }
            }

            // Notify webview that loading is complete
            this._view.webview.postMessage({
                type: 'loadingStatus',
                status: 'complete',
                message: 'Loading complete',
                progress: 100
            });

            this._view.webview.postMessage({
                type: 'setServers',
                servers: servers
            });
        } catch (error) {
            // Notify webview that loading has failed
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'loadingStatus',
                    status: 'error',
                    message: error instanceof Error ? error.message : 'Unknown error'
                });
            }
            ErrorHandler.handleError('Send Initial State', error);
        }
    }

    /**
     * Handle error events
     * @param serverId The server ID
     * @param error The error
     */
    private _handleError(serverId: string, error?: any): void {
        if (!this._view) {
            return;
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this._view.webview.postMessage({
            type: 'serverError',
            serverId,
            error: errorMessage
        });
    }

    /**
     * Handle messages from the webview
     * @param message The message from the webview
     */
    private async _handleMessage(message: any): Promise<void> {
        try {
            switch (message.type) {
                case 'getServers':
                    await this._sendInitialState();
                    break;

                case 'addServer':
                    if (message.server) {
                        console.log('Adding server: ', message.server);
                        const serverType = message.server.type || ServerType.PROCESS;

                        try {
                            // const { cmd, args: actualArgs } = findActualExecutable(command, args);
                            const client = await registerMCPServer({
                                context: this.context,
                                serverName: message.server.name,
                                command: message.server.command,
                                ...(Object.keys(message.server.env ?? {}).length > 0 ? { env: { ...message.server.env } } : {}),
                                transport: serverType,
                                url: serverType === ServerType.SSE ? message.server.url : undefined
                            });
                            if (client) {
                                this.clients.push(client);
                                await createToolsExtension(this.clients, this.context);
                                const config = vscode.workspace.getConfiguration('mcpManager');
                                const servers = config.get<ServerConfig[]>('servers', []);
                                servers.push({
                                    name: message.server.name,
                                    command: message.server.command,
                                    type: serverType,
                                    enabled: true,
                                    url: serverType === ServerType.SSE ? message.server.url : undefined,
                                    authToken: message.server.authToken,
                                    ...(Object.keys(message.server.env ?? {}).length > 0 ? { env: { ...message.server.env } } : {}),
                                });
                                await config.update('servers', servers, vscode.ConfigurationTarget.Global);
                                await this._sendInitialState();

                                // Send success message back to webview
                                if (this._view) {
                                    this._view.webview.postMessage({
                                        type: 'serverAdded',
                                        serverName: message.server.name
                                    });
                                }
                            } else {
                                if (this._view) {
                                    this._view.webview.postMessage({
                                        type: 'serverAddError',
                                        message: `Failed to add server ${message.server.name}. Please check the server command and use absolute paths if necessary.`
                                    });
                                }
                            }
                        } catch (error) {
                            console.error('Error adding server:', error);
                            // Send error message back to webview
                            if (this._view) {
                                this._view.webview.postMessage({
                                    type: 'serverAddError',
                                    serverName: message.server.name,
                                    error: error instanceof Error ? error.message : String(error)
                                });
                            }
                        }
                    }
                    break;

                case 'removeServer':
                    if (message.name) {
                        try {
                            console.log('Removing server: ', message.name);

                            // Close the client if it exists
                            const client = this.clients.find(client => client.name === message.name);
                            if (client) {
                                // Unregister tools for this server before closing the client
                                unregisterServerTools(message.name);

                                await client.close();
                                this.clients = this.clients.filter(c => c.name !== message.name);
                            }

                            // Remove from configuration
                            const config = vscode.workspace.getConfiguration('mcpManager');
                            const servers = config.get<ServerConfig[]>('servers', []);
                            const updatedServers = servers.filter(s => s.name !== message.name);
                            await config.update('servers', updatedServers, vscode.ConfigurationTarget.Global);
                            await createToolsExtension(this.clients, this.context);
                            // Update the UI
                            await this._sendInitialState();

                            console.log(`Removed server: ${message.name}`);
                        } catch (error) {
                            console.error(`Error removing server ${message.name}:`, error);
                            // Maybe show an error message?
                        }
                    }
                    break;

                case 'editServer':
                    if (message.server) {
                        try {
                            console.log('Editing server: ', message.server);
                            const newServerName = message.server.name;
                            // Use the original name to find the server in configuration
                            const originalServerName = message.server.originalName || newServerName;
                            const serverType = message.server.type || ServerType.PROCESS;

                            // Get the current server configuration
                            const config = vscode.workspace.getConfiguration('mcpManager');
                            const servers = config.get<ServerConfig[]>('servers', []);
                            // Find the server using the original name
                            const serverIndex = servers.findIndex(s => s.name === originalServerName);

                            if (serverIndex === -1) {
                                throw new Error(`Server "${originalServerName}" not found`);
                            }

                            // Get the existing client
                            const existingClient = this.clients.find(client => client.name === originalServerName);
                            if (existingClient) {
                                // Close the existing client
                                await existingClient.close();
                                this.clients = this.clients.filter(c => c.name !== originalServerName);
                            }

                            // Create a new client with the updated configuration
                            const client = await registerMCPServer({
                                context: this.context,
                                serverName: newServerName, // Use the new name for the new client
                                command: message.server.command,
                                ...(Object.keys(message.server.env ?? {}).length > 0 ? { env: { ...message.server.env } } : {}),
                                transport: serverType,
                                url: serverType === ServerType.SSE ? message.server.url : undefined
                            });
                            if (client) {
                                this.clients.push(client);
                                // Update the server configuration
                                const oldServer = servers[serverIndex];
                                const updatedServer = {
                                    ...oldServer,  // Start with existing properties
                                    // Apply new properties from the message, including the new name
                                    name: newServerName,
                                    type: serverType,
                                    enabled: true,
                                    command: message.server.command,
                                    url: message.server.url,
                                    authToken: message.server.authToken,
                                    ...(Object.keys(message.server.env ?? {}).length > 0 ? { env: { ...message.server.env } } : {}),
                                };
                                servers[serverIndex] = updatedServer;

                                await config.update('servers', servers, vscode.ConfigurationTarget.Global);
                                await this._sendInitialState();

                                // Send success message back to webview
                                if (this._view) {
                                    this._view.webview.postMessage({
                                        type: 'serverEdited',
                                        serverName: newServerName,
                                        originalName: originalServerName
                                    });
                                }
                                console.log(`Edited server: ${originalServerName} -> ${newServerName}`);
                            } else {
                                if (this._view) {
                                    this._view.webview.postMessage({
                                        type: 'serverEditError',
                                        message: `Failed to edit server ${message.server.name}. Please check the server command and use absolute paths if necessary.`
                                    });
                                }
                            }


                        } catch (error) {
                            console.error('Error editing server:', error);
                            // Send error message back to webview
                            if (this._view) {
                                this._view.webview.postMessage({
                                    type: 'serverEditError',
                                    serverName: message.server.name,
                                    error: error instanceof Error ? error.message : String(error)
                                });
                            }
                        }
                    }
                    break;

                case 'toggleServer':
                    if (message.name !== undefined) {
                        // Get running servers from the server manager
                        const client = this.clients.find(client => client.name === message.name);
                        if (!client) {
                            return;
                        }
                        if (message.enabled) {
                            // toggle the server on
                            console.log('Starting server: ', message.name);
                            client.enabled = true;
                            const config = vscode.workspace.getConfiguration('mcpManager');
                            const servers = config.get<ServerConfig[]>('servers', []);
                            const serverIndex = servers.findIndex(s => s.name === message.name);
                            servers[serverIndex].enabled = true;
                            await config.update('servers', servers, vscode.ConfigurationTarget.Global);
                        } else {
                            // toggle the server off
                            await client.close();
                            const config = vscode.workspace.getConfiguration('mcpManager');
                            const servers = config.get<ServerConfig[]>('servers', []);
                            const serverIndex = servers.findIndex(s => s.name === message.name);
                            servers[serverIndex].enabled = false;
                            await config.update('servers', servers, vscode.ConfigurationTarget.Global);
                        }


                        // Update UI immediately with server status and tools
                        await this._sendInitialState();
                    }
                    break;
            }
        } catch (error) {
            ErrorHandler.handleError('Handle Webview Message', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'error',
                    message: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
    }

    /**
     * Generate the HTML for the webview
     * @param webview The webview
     * @returns The HTML content
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Create URIs for the scripts and styles
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
        );

        // HTML for the webview
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:;">
                <title>MCP Server Manager</title>
                <style>
                    body {
                        padding: 0;
                        margin: 0;
                        width: 100%;
                        height: 100%;
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-panel-background);
                        font-family: var(--vscode-font-family);
                    }
                    .mcp-server-manager {
                        padding: 0 16px;
                    }
                    .server-item {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 8px;
                        margin: 8px 0;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-widget-border);
                        border-radius: 4px;
                    }
                    .server-info {
                        display: flex;
                        flex-direction: column;
                    }
                    .server-name {
                        font-weight: bold;
                    }
                    .server-command {
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                    }
                    .server-controls {
                        display: flex;
                        gap: 8px;
                        align-items: center;
                    }
                    .empty-state {
                        text-align: center;
                        padding: 16px;
                        color: var(--vscode-descriptionForeground);
                    }
                    button {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 4px 8px;
                        cursor: pointer;
                        border-radius: 2px;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .remove-button {
                        background: var(--vscode-errorForeground);
                    }
                    .loading-container {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        height: 100%;
                        padding: 20px;
                        text-align: center;
                    }
                    .loading-spinner {
                        margin: 20px 0;
                        width: 40px;
                        height: 40px;
                        border: 4px solid var(--vscode-editor-background);
                        border-top: 4px solid var(--vscode-progressBar-background);
                        border-radius: 50%;
                        animation: spin 1.5s linear infinite;
                    }
                    .loading-progress {
                        width: 100%;
                        max-width: 300px;
                        margin: 10px 0;
                    }
                    .loading-progress-bar {
                        height: 4px;
                        background-color: var(--vscode-progressBar-background);
                        width: 0%;
                        transition: width 0.3s ease-in-out;
                    }
                    .loading-progress-track {
                        height: 4px;
                        background-color: var(--vscode-editor-background);
                        width: 100%;
                    }
                    .loading-message {
                        margin: 10px 0;
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div id="root">
                    <div class="loading-container" id="loadingContainer">
                        <h3>Loading MCP Server Manager</h3>
                        <div class="loading-spinner"></div>
                        <div class="loading-progress">
                            <div class="loading-progress-track">
                                <div class="loading-progress-bar" id="loadingProgressBar"></div>
                            </div>
                        </div>
                        <p class="loading-message" id="loadingMessage">Initializing servers...</p>
                    </div>
                </div>
                <script>
                    // Debug logging
                    console.log('Debug: Starting script execution');
                    window.addEventListener('error', function(event) {
                        console.error('Script error:', event.error);
                    });
                    
                    // Create the vscode API for messaging
                    const vscode = acquireVsCodeApi();
                    window.vscodeApi = vscode;
                    
                    // Set up message handler for loading status
                    window.addEventListener('message', function(event) {
                        const message = event.data;
                        
                        // Handle loading status
                        if (message.type === 'loadingStatus') {
                            var loadingMsg = document.getElementById('loadingMessage');
                            var progressBar = document.getElementById('loadingProgressBar');
                            var loadingContainer = document.getElementById('loadingContainer');
                            
                            // Update loading message
                            if (loadingMsg && message.message) {
                                loadingMsg.textContent = message.message;
                            }
                            
                            // Update progress bar
                            if (progressBar && message.progress !== undefined) {
                                progressBar.style.width = message.progress + '%';
                            }
                            
                            // Handle error state
                            if (message.status === 'error' && loadingContainer) {
                                loadingContainer.innerHTML = '<h3>Error Loading Servers</h3>' +
                                    '<p class="loading-message">' + 
                                    (message.message || 'An error occurred while loading servers.') + 
                                    '</p>' +
                                    '<button onclick="window.vscodeApi.postMessage({ type: \\'getServers\\' })">Retry</button>';
                            }
                        }
                        
                        // When servers data is received, hide loading container
                        if (message.type === 'setServers') {
                            var loadingContainer = document.getElementById('loadingContainer');
                            if (loadingContainer) {
                                loadingContainer.style.display = 'none';
                            }
                        }
                    });
                </script>
                <script src="${scriptUri}" async defer></script>
                <script>
                    // More debug logging
                    console.log('Debug: After script tag');
                    window.addEventListener('load', function() {
                        console.log('Debug: Window loaded');
                        console.log('Debug: React available:', typeof React !== 'undefined');
                        console.log('Debug: Root element:', document.getElementById('root'));
                        
                        // Request initial server list
                        window.vscodeApi.postMessage({ type: 'getServers' });
                    });
                </script>
            </body>
            </html>`;
    }

    /**
     * Show the webview panel
     */
    public async show(): Promise<void> {
        if (this._view) {
            this._view.show?.(true);
        }
    }

    /**
     * Reveal the webview in the primary column
     */
    public static async createOrShow(
        context: vscode.ExtensionContext,
        clients: NamedClient[]
    ): Promise<ServerViewProvider> {
        const provider = new ServerViewProvider(context, clients);

        // Register the webview provider
        const provider_registration = vscode.window.registerWebviewViewProvider(
            ServerViewProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        );
        // Register the ChatHandler, it will push the ChatHandler to the context
        // for disposal when the extension is deactivated
        ChatHandler.register(context, clients);

        context.subscriptions.push(provider_registration);
        context.subscriptions.push(provider);
        return provider;
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        // Nothing to dispose, as the webview is managed by VS Code
    }
}