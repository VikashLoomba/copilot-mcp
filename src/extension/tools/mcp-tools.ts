import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// Import dynamically to avoid issues
import { z } from 'zod';
// Import necessary types for request handlers
import { startSseMcpServer } from '../sse-server';
import { baseClient } from '../sse-client';
import { McpProxyTool } from './McpProxyTool';
import { LoggingLevelSchema } from '@modelcontextprotocol/sdk/types.js';
// Edit Preview Provider (same as original)
class EditPreviewProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public onDidChange = this._onDidChange.event;
    private previewTextMap = new Map<string, string>();

    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
        const key = uri.toString();
        return this.previewTextMap.get(key) || 'No preview available';
    }

    public updatePreview(uri: vscode.Uri, newText: string) {
        this.previewTextMap.set(uri.toString(), newText);
        this._onDidChange.fire(uri);
    }
}

// Helper for shell integration
async function waitForShellIntegration(
    terminal: vscode.Terminal,
    timeout: number
): Promise<void> {
    let resolve: () => void;
    let reject: (e: Error) => void;
    const p = new Promise<void>((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });

    const timer = setTimeout(() => reject(new Error('Could not run terminal command: shell integration is not enabled')), timeout);

    const listener = vscode.window.onDidChangeTerminalShellIntegration((e) => {
        if (e.terminal === terminal) {
            clearTimeout(timer);
            listener.dispose();
            resolve();
        }
    });

    await p;
}

// Helper functions for file editing
function applyEditsInMemory(
    document: vscode.TextDocument,
    edits: Array<{
        startLine: number;
        startCharacter: number;
        endLine: number;
        endCharacter: number;
        newText: string;
    }>
): string {
    // Sort edits in ascending order so we process from top to bottom
    const sortedEdits = edits.slice().sort((a, b) => {
        if (a.startLine !== b.startLine) {
            return a.startLine - b.startLine;
        }
        return a.startCharacter - b.startCharacter;
    });

    let finalText = '';
    let lastPos = new vscode.Position(0, 0);

    for (const edit of sortedEdits) {
        // Build start/end Positions
        const startPos = new vscode.Position(edit.startLine, edit.startCharacter);
        const endPos = new vscode.Position(edit.endLine, edit.endCharacter);

        // Append text from the last position up to this edit's start
        finalText += document.getText(new vscode.Range(lastPos, startPos));
        // Insert the replacement text for this edit
        finalText += edit.newText;

        // Move the 'cursor' to the end of this edit
        lastPos = endPos;
    }

    // Finally, append the text from the last edit to the end of the document
    const docEndPos = document.positionAt(document.getText().length);
    finalText += document.getText(new vscode.Range(lastPos, docEndPos));

    return finalText;
}

// Helper function for directory tree
async function buildFileTree(
    path: string,
    currentDepth: number,
    maxDepth: number
): Promise<Record<string, { type: vscode.FileType, children?: Record<string, any> }>> {
    const fileTreeObject: Record<string, { type: vscode.FileType, children?: Record<string, any> }> = {};

    // Read the current directory
    const filesAndFolders = await vscode.workspace.fs.readDirectory(vscode.Uri.file(path));

    for (const [name, type] of filesAndFolders) {
        // Skip hidden files and node_modules to avoid cluttering the result
        if (name.startsWith('.') || name === 'node_modules') {
            continue;
        }

        if (type === vscode.FileType.Directory) {
            fileTreeObject[name] = {
                type
            };

            // Recursively explore subdirectories if we haven't reached max depth
            if (currentDepth < maxDepth) {
                const subPath = path + '/' + name;
                const children = await buildFileTree(subPath, currentDepth + 1, maxDepth);

                // Only add children property if there are actual children
                if (Object.keys(children).length > 0) {
                    fileTreeObject[name].children = children;
                }
            }
        } else {
            fileTreeObject[name] = {
                type
            };
        }
    }

    return fileTreeObject;
}

function convertTreeToMarkdown(
    tree: Record<string, { type: vscode.FileType, children?: Record<string, any> }>,
    basePath: string
) {
    let markdown = `# Directory Tree: ${basePath}\n\n`;

    const buildMarkdownTree = (
        subtree: Record<string, { type: vscode.FileType, children?: Record<string, any> }>,
        indent = ''
    ): string => {
        let result = '';

        // Sort entries: directories first, then files, both alphabetically
        const entries = Object.entries(subtree).sort((a, b) => {
            // If types are different (directory vs file), sort directories first
            if (a[1].type !== b[1].type) {
                return a[1].type === vscode.FileType.Directory ? -1 : 1;
            }
            // Otherwise sort alphabetically
            return a[0].localeCompare(b[0]);
        });

        for (const [name, info] of entries) {
            if (info.type === vscode.FileType.Directory) {
                result += `${indent}- 📁 **${name}**/\n`;

                if (info.children && Object.keys(info.children).length > 0) {
                    result += buildMarkdownTree(info.children, indent + '  ');
                }
            } else {
                // Add file icon based on extension
                const extension = name.split('.').pop()?.toLowerCase() || '';
                let fileIcon = '📄';

                // Common file type icons
                if (['js', 'ts', 'jsx', 'tsx'].includes(extension)) { fileIcon = '📜'; }
                else if (['json'].includes(extension)) { fileIcon = '📋'; }
                else if (['md', 'txt'].includes(extension)) { fileIcon = '📝'; }
                else if (['html', 'htm'].includes(extension)) { fileIcon = '🌐'; }
                else if (['css', 'scss', 'less'].includes(extension)) { fileIcon = '🎨'; }
                else if (['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(extension)) { fileIcon = '🖼️'; }

                result += `${indent}- ${fileIcon} ${name}\n`;
            }
        }

        return result;
    };

    markdown += buildMarkdownTree(tree);
    return markdown;
}

// Create the MCP server with VS Code tools
export async function createMcpServer() {
    // Get port from configuration
    const config = vscode.workspace.getConfiguration('mcpManager');
    const port = config.get<number>('serverPort') || 8888;

    // Static variables for file edit tool
    const previewScheme = 'fileedit-preview';
    const previewProvider = new EditPreviewProvider();
    let providerRegistration: vscode.Disposable | null = null;

    if (!providerRegistration) {
        providerRegistration = vscode.workspace.registerTextDocumentContentProvider(
            previewScheme,
            previewProvider
        );
    }

    // Create MCP server
    const server = new McpServer({
        name: 'vscode-mcp-tools',
        version: '0.1.0'
    });
    // Typed parameter interfaces
    type FileReadParams = {
        path: string;
        offset?: number;
        limit?: number;
    };
    type FileEditParams = {
        path: string;
        edits: Array<{
            startLine: number;
            startCharacter: number;
            endLine: number;
            endCharacter: number;
            newText: string;
        }>;
    };
    type FindFilesParams = {
        pattern: string;
    };
    type ListDirectoryParams = {
        path?: string;
    };
    type RunInTerminalParams = {
        command: string;
    };
    // File Read Tool
    server.tool(
        'fileReadTool',
        'Read a file with optional offset and limit',
        {
            path: z.string().describe('The path to the file to read. Can be absolute or relative to the workspace root.'),
            offset: z.number().optional().describe('Line number to start reading from (0-indexed). If not provided, starts from the beginning of the file.'),
            limit: z.number().optional().describe('Maximum number of lines to read. If not provided, reads to the end of the file.')
        },
        async (params: FileReadParams) => {
            try {
                const file = await vscode.workspace.openTextDocument(params.path);
                let range;

                if (params.offset !== undefined && params.limit !== undefined) {
                    range = new vscode.Range(params.offset, 0, params.offset + params.limit, 0);
                }

                const text = file.getText(range);
                return {
                    content: [{
                        type: 'text',
                        text
                    }]
                };
            } catch (error: unknown) {
                console.error('Error reading file:', error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to read file: ${errorMessage}`);
            }
        }
    );

    // File Edit Tool
    server.tool(
        'fileEditTool',
        'Edit a file with preview and apply changes',
        {
            path: z.string().describe('The path to the file to edit. Can be absolute or relative to the workspace root.'),
            edits: z.array(
                z.object({
                    startLine: z.number().describe('Starting line of the edit (0-indexed).'),
                    startCharacter: z.number().describe('Starting character position on the start line.'),
                    endLine: z.number().describe('Ending line of the edit (0-indexed).'),
                    endCharacter: z.number().describe('Ending character position on the end line.'),
                    newText: z.string().describe('The text to replace the specified range with.')
                })
            ).describe('Array of edit operations to apply to the file.')
        },
        async (params: FileEditParams) => {
            try {
                const fileUri = vscode.Uri.file(params.path);

                // Open the file in VS Code
                const document = await vscode.workspace.openTextDocument(fileUri);

                // Apply edits in memory
                const updatedText = applyEditsInMemory(document, params.edits);

                // Show a diff preview
                const previewUri = fileUri.with({
                    scheme: previewScheme,
                    query: 'preview',
                });

                previewProvider.updatePreview(previewUri, updatedText);

                // Show the diff
                await vscode.commands.executeCommand('vscode.diff', fileUri, previewUri, 'Preview Edits');

                // Apply the workspace edits
                const workspaceEdit = new vscode.WorkspaceEdit();

                for (const edit of params.edits) {
                    const range = new vscode.Range(
                        new vscode.Position(edit.startLine, edit.startCharacter),
                        new vscode.Position(edit.endLine, edit.endCharacter)
                    );
                    workspaceEdit.replace(fileUri, range, edit.newText);
                }

                const success = await vscode.workspace.applyEdit(workspaceEdit);

                if (!success) {
                    throw new Error('Failed to apply edits.');
                }

                // Get diagnostics
                const diagnostics = vscode.languages.getDiagnostics(fileUri);
                const errors = diagnostics.filter(diag => diag.severity === vscode.DiagnosticSeverity.Error);
                const warnings = diagnostics.filter(diag => diag.severity === vscode.DiagnosticSeverity.Warning);

                let result = 'File edited successfully with no errors or warnings.';

                if (errors.length || warnings.length) {
                    const errorMessages = errors.map(err =>
                        `${err.message} (at ${err.range.start.line}:${err.range.start.character})`);
                    const warningMessages = warnings.map(warn =>
                        `${warn.message} (at ${warn.range.start.line}:${warn.range.start.character})`
                    );

                    result = 'Edits applied with issues:';
                    if (errors.length) {
                        result += '\nErrors: ' + errorMessages.join(', ');
                    }
                    if (warnings.length) {
                        result += '\nWarnings: ' + warningMessages.join(', ');
                    }
                }

                return {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                };
            } catch (error: unknown) {
                console.error('Error editing file:', error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to edit file: ${errorMessage}`);
            }
        }
    );

    // Find Files Tool
    server.tool(
        'findFilesTool',
        'Find files in the workspace matching a glob pattern',
        {
            pattern: z.string().describe('A glob pattern to match files against (e.g., "**/*.ts" for all TypeScript files). Uses VS Code\'s built-in file search capabilities.')
        },
        async (params: FindFilesParams) => {
            try {
                const files = await vscode.workspace.findFiles(
                    params.pattern,
                    '**/node_modules/**'
                );

                const filesList = files.map((f) => f.fsPath);

                return {
                    content: [{
                        type: 'text',
                        text: `Found ${files.length} files matching "${params.pattern}":\n${filesList.join('\n')}`
                    }]
                };
            } catch (error: unknown) {
                console.error('Error finding files:', error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to find files: ${errorMessage}`);
            }
        }
    );

    // List Directory Tree Tool
    server.tool(
        'listDirectoryTreeTool',
        'List the contents of a directory in a tree structure',
        {
            path: z.string().optional().describe('The directory path to start from. If not provided, uses the workspace root. The tree is limited to a depth of 5 levels.')
        },
        async (params: ListDirectoryParams) => {
            try {
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceRoot) {
                    throw new Error('No workspace root found');
                }

                const dirPath = params.path ?? workspaceRoot.uri.fsPath;

                // Build file tree with max depth of 5
                const fileTreeObject = await buildFileTree(dirPath, 0, 5);

                // Convert the file tree object to markdown 
                const markdownContent = convertTreeToMarkdown(fileTreeObject, dirPath);

                return {
                    content: [{
                        type: 'text',
                        text: markdownContent
                    }]
                };
            } catch (error: unknown) {
                console.error('Error listing directory tree:', error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to list directory tree: ${errorMessage}`);
            }
        }
    );

    // Run In Terminal Tool
    server.tool(
        'runInTerminalTool',
        'Run a command in a terminal with shell integration',
        {
            command: z.string().describe('The shell command to execute in the terminal. Creates a new terminal instance for each command execution.')
        },
        async (params: RunInTerminalParams) => {
            try {
                const terminal = vscode.window.createTerminal('MCP Tool Terminal');
                terminal.show();

                try {
                    await waitForShellIntegration(terminal, 5000);
                } catch (e: unknown) {
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    throw new Error(errorMessage);
                }

                const execution = terminal.shellIntegration!.executeCommand(params.command);
                const terminalStream = execution.read();

                let terminalResult = '';
                for await (const chunk of terminalStream) {
                    terminalResult += chunk;
                }

                return {
                    content: [{
                        type: 'text',
                        text: terminalResult
                    }]
                };
            } catch (error: unknown) {
                console.error('Error running terminal command:', error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to run terminal command: ${errorMessage}`);
            }
        }
    );
    return await startSseMcpServer(port, 'localhost', server);
}

// Function to start the server with express and SSE transport
export async function startMcpServer() {
    // Create the MCP server and Express application
    const server = await createMcpServer();
    const { client, tools, dispose: disposeClient } = await baseClient();
    console.log('client', client);

    //create proxy tools
    const proxyTools = tools.map(tool => new McpProxyTool(client, tool));

    //register proxy tools
    const toolDisposables = proxyTools.map(tool => vscode.lm.registerTool(tool.name, tool));

    return {
        server, client, tools: toolDisposables, dispose: () => {
            disposeClient();
            server.dispose();
        }
    };
}
