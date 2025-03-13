import { ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { Resource, Tool } from '@modelcontextprotocol/sdk/types.js';
import { NamedClient as MCPClient } from './toolInitHelpers';

/**
 * Server types supported by the extension
 */
export enum ServerType {
    /** Command-line process server */
    PROCESS = 'process',
    /** Server-Sent Events (SSE) server */
    SSE = 'sse'
}

/**
 * Represents the configuration for an MCP server
 */
export interface ServerConfig {
    /** Display name for the server */
    name: string;
    /** Type of server - process or SSE */
    type?: ServerType;
    /** Command to start the server (for process servers) */
    command: string;
    /** Arguments for the server command (for process servers) */
    args?: string[];
    /** URL for SSE connection (for SSE servers) */
    url?: string;
    /** Whether the server is enabled and should auto-start */
    enabled: boolean;
    /** Environment variables to pass to the server process (for process servers) */
    env?: { [key: string]: string };
    /** Authentication token for SSE servers */
    authToken?: string;
}

/**
 * Represents a running server process and its associated resources
 */
export interface ServerProcess {
    /** The child process running the server */
    process: ChildProcess;
    /** Output channel for server logs */
    outputChannel: vscode.OutputChannel;
    /** MCP client connected to the server */
    mcpClient?: MCPClient;
    /** Tools provided by the server */
    tools: Tool[];
    /** Resources provided by the server */
    resources: Resource[];
}

/**
 * Server event types for internal event bus communication
 */
export enum ServerEventType {
    SERVER_STARTED = 'server-started',
    SERVER_STOPPED = 'server-stopped',
    TOOLS_CHANGED = 'tools-changed',
    RESOURCES_CHANGED = 'resources-changed'
}

/**
 * Server event data structure
 */
export interface ServerEvent {
    /** Type of the event */
    type: ServerEventType;
    /** Name of the server this event relates to */
    serverName: string;
    /** Additional event data */
    data?: any;
}