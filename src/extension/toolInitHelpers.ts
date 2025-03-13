import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { CreateMessageRequestSchema, Implementation, ListRootsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { Client, ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { findActualExecutable } from 'spawn-rx';
import { McpProxyTool } from './tools/McpProxyTool';
import * as vsce from '@vscode/vsce';
import { ServerConfig, ServerType } from './ServerConfig';

export interface RegisterMCPServerParams {
    context: vscode.ExtensionContext;
    serverName: string;
    command?: string;
    env?: {
        [key: string]: string;
    }
    transport?: ServerType;
    url?: string;
    enabled?: boolean;
}

export const toolsExtTemplate = (serverName: string) => `mcpManager-${serverName}-tools-ext`;

// Map to track which tools belong to which server
const serverToolsMap = new Map<string, vscode.Disposable[]>();

export async function registerMCPServer(params: RegisterMCPServerParams) {
    // split the command into args
    const [command, ...pArguments] = params.command?.split(' ') || [];

    let transport: Transport;
    // 2. create a client and transport
    if (params.transport === ServerType.PROCESS || !params.transport) {
        const { cmd: pCmd, args: pArgs } = findActualExecutable(command, pArguments);
        const env = { ...getDefaultEnvironment(), ...params.env, };
        const extDir = path.join(params.context.globalStorageUri.fsPath, 'stdio');
        vscode.workspace.fs.createDirectory(vscode.Uri.file(extDir));
        const stdioWorkDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || extDir;

        const transportParams = {
            command: pCmd,
            args: pArgs,
            env: env,
            cwd: stdioWorkDir,
            stderr: "pipe" as const
        };
        try {
            transport = new StdioClientTransport(transportParams);
            if (!params.enabled) {
                transport.close();
            }
            transport.onclose = () => {
                console.warn(`Transport closed`);
            };
            transport.onerror = (e) => {
                console.warn(`Transport error: ${e}`);
            };
            transport.onmessage = (message) => {
                // console.log(`Transport message: ${message}`);
            };
        } catch (e) {
            console.warn(`Failed to create stdio transport: ${e}`);
            return null;
        }
    } else if (params.transport === ServerType.SSE) {
        if (!params.url) {
            console.warn('URL is required for SSE transport');
            return null;
        }
        transport = new SSEClientTransport(new URL(params.url), {});
        console.log('Transport: ', transport);
    } else {
        console.warn(`Unsupported transport: ${params.transport}`);
        return null;
    }

    // 3. create a client
    const client = new NamedClient(
        {
            name: params.serverName,
            version: "0.0.0",
            command: params.command || "",
            enabled: params.enabled ?? false
        },
        {
            capabilities: {
                prompts: {},
                resources: {},
                tools: {},
                roots: {
                    'listChanged': true
                },
                sampling: {

                }
            },
        },
    );

    try {
        if (params.enabled) {
            await client.connect(transport);
            params.context.subscriptions.push({
                dispose: () => {
                    client.close();
                    transport.close();
                }
            });
        }
    } catch (e) {
        console.log(`Failed to connect to server with error: ${e}\n${JSON.stringify(e)}`);
        return null;
    }
    return client;
}

export async function createToolsExtension(clients: NamedClient[], context: vscode.ExtensionContext) {
    const extDir = path.join(context.globalStorageUri.fsPath, '.cache');
    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(extDir));
        console.log(`Extension directory: ${extDir}`);

        const enabledClients = clients.filter(client => client.enabled);
        if (enabledClients.length === 0) {
            console.log('No enabled clients found, skipping tools extension creation');
            return;
        }

        // First collect all tool responses and map them to the client name
        const toolResponses = await Promise.all(enabledClients.map(async (client, index) => {
            const response = await client.listTools();
            return {
                client: client,
                tools: response.tools
            };
        }));

        // Then extract and flatten the tools arrays
        const tools = toolResponses.flatMap(response => {
            return response.tools.map(tool => ({
                ...tool,
                client: response.client
            }));
        });

        if (tools.length === 0) {
            console.log('No tools found, skipping tools extension creation');
            return;
        }

        const toolManifest = tools.map(tool => ({
            "name": tool.name,
            "tags": ["mcpManager", tool.client.name],
            "toolReferenceName": tool.name,
            "displayName": tool.name,
            "modelDescription": tool.description,
            "inputSchema": tool.inputSchema ? {
                type: tool.inputSchema.type,
                properties: tool.inputSchema.properties,
                required: tool.inputSchema.required
            } : undefined,
            "canBeReferencedInPrompt": true,
            "icon": "$(note)",
            "userDescription": tool.description
        }));

        // 2. Create a minimal package.json with a contributed command
        const manifest = {
            name: 'mcp-manager-tools-ext',
            main: "extension.js",
            publisher: "AutomataLabs",           // (Use your publisher ID if publishing)
            version: "0.0.1",
            engines: { vscode: "^1.97.0" },
            activationEvents: ["*"],            // activate on startup (or specify specific event)
            contributes: {
                languageModelTools: [
                    ...toolManifest
                ]
            }
        };
        await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(extDir, 'package.json')), Buffer.from(JSON.stringify(manifest, null, 2)));
        // 3. Provide an empty extension entry point (required for VSIX packaging) and empty LICENSE file
        await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(extDir, 'extension.js')), Buffer.from(`exports.activate = function() {}; exports.deactivate = function() {};`));
        await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(extDir, 'LICENSE')), Buffer.from(''));

        // 4. Package the extension into a VSIX using the vsce API directly
        try {
            await vsce.createVSIX({
                cwd: extDir,
                allowMissingRepository: true,
                allowStarActivation: true,
            });
        } catch (err) {
            console.warn(`Failed to package extension: ${err instanceof Error ? err.message : String(err)}`);
            // Cleanup in case of failure
            await cleanupExtensionFiles(extDir);
            throw new Error(`Failed to package extension: ${err instanceof Error ? err.message : String(err)}`);
        }

        // 5. Install the VSIX using VS Code's CLI or API:
        try {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(`${extDir}/${manifest.name}-${manifest.version}.vsix`));
            toolResponses.forEach(response => {
                registerChatTools(context, response.tools, response.client);
            });
        } catch (err) {
            console.warn(`Failed to install extension: ${err instanceof Error ? err.message : String(err)}`);
            await cleanupExtensionFiles(extDir);
            throw new Error(`Failed to install extension: ${err instanceof Error ? err.message : String(err)}`);
        }
    } catch (err) {
        console.warn(`Error creating tools extension: ${err instanceof Error ? err.message : String(err)}`);
        throw new Error(`Error creating tools extension: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// Helper function to clean up extension files in case of failure
async function cleanupExtensionFiles(extDir: string): Promise<void> {
    try {
        const vsixPath = path.join(extDir, 'mcp-manager-tools-ext-0.0.1.vsix');
        if (fs.existsSync(vsixPath)) {
            fs.unlinkSync(vsixPath);
        }
        // Optionally, remove other files if needed
    } catch (err) {
        console.warn(`Failed to clean up extension files: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export function registerChatTools(context: vscode.ExtensionContext, tools: Tool[], client: NamedClient) {
    // Initialize array for this server if it doesn't exist
    if (!serverToolsMap.has(client.name)) {
        serverToolsMap.set(client.name, []);
    }
    if (client.enabled) {
        // Set the request handler for the ListRootsRequest
        client.setRequestHandler(ListRootsRequestSchema, async () => {
            const roots = vscode.workspace.workspaceFolders?.map(folder => (`${folder.uri.scheme}://${folder.uri.fsPath}`));
            if (!roots || roots.length === 0) {
                return {
                    roots: []
                };
            }
            return {
                roots: roots.map(root => ({
                    uri: root,
                    name: 'workspace_directory',
                    type: 'directory'
                }))
            };
        });
        registerVscodeTools(tools, client, context);
    }
}

function registerVscodeTools(tools: Tool[], client: NamedClient, context: vscode.ExtensionContext) {
    for (const tool of tools) {
        const vscodeTool: vscode.LanguageModelTool<typeof tool['inputSchema']> = new McpProxyTool(client, tool);
        console.log(`Registering tool: ${tool.name}`);
        const disposable = vscode.lm.registerTool(tool.name, vscodeTool);
        context.subscriptions.push(disposable);
        // Store the disposable in our map for later cleanup
        serverToolsMap.get(client.name)?.push(disposable);
        console.log(`Registered tool: ${tool.name}`);
    }
}

// method to uninstall the tools extension
export async function uninstallToolsExtension(serverName: string) {
    const extDir = path.join(toolsExtTemplate(serverName));
    fs.rmSync(extDir, { recursive: true, force: true });
    await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', toolsExtTemplate(serverName));
}

export async function registerServerAndClients(servers: ServerConfig[], context: vscode.ExtensionContext): Promise<NamedClient[]> {
    const clients: NamedClient[] = [];
    for (const server of servers) {
        console.log(`Installing dynamic tools ext for server`);
        const client = await registerMCPServer({
            context,
            serverName: server.name.trim(),
            command: server.command,
            env: { ...(server.env ?? {}) },
            transport: server.type,
            url: server.type === ServerType.SSE ? server.url : undefined,
            enabled: server.enabled
        });
        if (client) {
            clients.push(client);
        }
    }
    if (clients.length > 0) {
        await createToolsExtension(clients, context);
    }
    return clients;
}

/**
 * Unregister all tools for a specific server
 * @param serverName The name of the server whose tools should be unregistered
 */
export function unregisterServerTools(serverName: string): void {
    const disposables = serverToolsMap.get(serverName);
    if (!disposables || disposables.length === 0) {
        console.log(`No tools to unregister for server: ${serverName}`);
        return;
    }

    // Dispose each tool
    for (const disposable of disposables) {
        disposable.dispose();
        console.log(`Disposed tool for server: ${serverName}`);
    }

    // Clear the map entry
    serverToolsMap.delete(serverName);
    console.log(`Unregistered ${disposables.length} tools for server: ${serverName}`);
}

export class NamedClient extends Client {
    protected _name: string;
    protected _command: string;
    protected _enabled: boolean;

    constructor(info: Implementation & { command: string, enabled: boolean }, options: ClientOptions) {
        super(info, options);
        this._name = info.name;
        this._command = info.command as string;
        this._enabled = info.enabled;
    }

    public get name() {
        return this._name;
    }
    public set name(name: string) {
        this._name = name;
    }
    public get command() {
        return this._command;
    }
    public set command(command: string) {
        this._command = command;
    }
    public get enabled() {
        return this._enabled;
    }
    public set enabled(enabled: boolean) {
        this._enabled = enabled;
    }
}