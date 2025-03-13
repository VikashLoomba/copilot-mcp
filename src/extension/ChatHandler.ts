import * as vscode from 'vscode';
import { sendChatParticipantRequest } from '@vscode/chat-extension-utils';
import { NamedClient } from './toolInitHelpers';
import { Tool, Resource, ListResourcesResult } from '@modelcontextprotocol/sdk/types.js';
import { getSystemPrompt } from './utilities';

/**
 * Handles chat functionality for MCP integration by providing
 * chat handling and followup capabilities
 */
export class ChatHandler implements vscode.ChatFollowupProvider {
  private static _instance: ChatHandler | undefined;

  private _participant?: vscode.ChatParticipant;
  private _logoPath: vscode.Uri;
  private _clients: NamedClient[];
  private _clientToolMap: Map<string, Tool[]>;

  /**
   * Private constructor to enforce singleton pattern
   * @param clients The named clients
   * @param extensionUri The extension URI
   */
  private constructor(
    clients: NamedClient[],
    private readonly extensionUri: vscode.ExtensionContext['extensionUri']
  ) {
    console.log('ChatHandler initialized');
    console.log('Tools: ', vscode.lm.tools.filter(tool => tool.tags?.includes('mcpManager')));
    // Set the logo path for the participant
    this._logoPath = vscode.Uri.joinPath(this.extensionUri, 'icon.png');
    this._clients = clients;
    this._clientToolMap = new Map<string, Tool[]>();

    // Initialize the client tool map
    this._populateClientToolMap();
  }

  /**
   * Populates the client tool map with tools from each client
   * @private
   */
  private async _populateClientToolMap(): Promise<void> {
    for (const client of this.clients) {
      try {
        const toolsResponse = await client.listTools();
        if (toolsResponse && toolsResponse.tools) {
          this._clientToolMap.set(client.name, toolsResponse.tools);
        }
      } catch (error) {
        console.error(`Error fetching tools for client ${client.name}:`, error);
      }
    }
  }

  /**
   * Implement the ChatRequestHandler interface method
   * @param request The chat request
   * @param context The chat context
   * @param stream The response stream
   * @param token The cancellation token
   * @returns The chat result
   */
  public async handleRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    try {
      console.log(`Handling chat request: ${request.prompt}`);

      // Handle special commands
      if (request.command === 'listResources') {
        return this._handleListResourcesCommand(stream);
      }

      const workspaceRoots = vscode.workspace.workspaceFolders ?? [];
      console.log("Available tools:", vscode.lm.tools.length);
      // Render TSX prompt

      // Forward the request to VS Code's chat system with our tools
      const prompt = (await getSystemPrompt()).join('\n');

      const chatResult = sendChatParticipantRequest(request, context, {
        prompt: prompt,
        responseStreamOptions: {
          stream,
          references: true,
          responseText: true,
        },
        tools: vscode.lm.tools,
      }, token);
      stream.progress(
        "Thinking..."
      );

      const result = await chatResult.result;
      console.log('Result:', result);
      return result;
    } catch (error) {
      console.debug('Error handling chat request:', error);

      // Return a fallback response
      stream.push(new vscode.ChatResponseMarkdownPart(
        new vscode.MarkdownString(`I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      ));

      return {};
    }
  }

  /**
   * Implement the ChatFollowupProvider interface method
   * @param result The chat result
   * @param context The context
   * @param token The cancellation token
   * @returns The followup items
   */
  public provideFollowups(
    result: vscode.ChatResult,
    context: vscode.ChatContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.ChatFollowup[]> {
    // Check if this is a resource-related result
    if (result.metadata?.command === 'readResource') {
      return [
        {
          label: 'Read Resource',
          command: 'copilot-mcp.readResource',
          prompt: 'Read the resource'
        }
      ];
    }
    return [];
  }

  private getChatHistory(context: vscode.ChatContext): vscode.LanguageModelChatMessage[] {
    // get all the previous participant messages
    const messages: vscode.LanguageModelChatMessage[] = [];
    const previousMessages = context.history.filter(
      h => h instanceof vscode.ChatResponseTurn
    );
    // add the previous messages to the messages array
    previousMessages.forEach(m => {
      let fullMessage = '';
      m.response.forEach(r => {
        const mdPart = r as vscode.ChatResponseMarkdownPart;
        fullMessage += mdPart.value.value;
      });
      messages.push(vscode.LanguageModelChatMessage.Assistant(fullMessage));
    });
    return messages;
  }

  public static async getPrompt(): Promise<string> {
    const tools = vscode.lm.tools;
    const toolNames = tools.map(_ => _.name).join(', ');
    const FileReadTool = tools.find(tool => tool.name === 'FileReadTool');
    const FindFilesTool = tools.find(tool => tool.name === 'FindFilesTool');
    return `Launch a new agent that has access to the following tools: ${toolNames}. When you are searching for a keyword or file and are not confident that you will find the right match on the first try, use the Agent tool to perform the search for you. For example:
  
  - If you are searching for a keyword like "config" or "logger", the Agent tool is appropriate
  - If you want to read a specific file path, use the ${FileReadTool?.name} or ${FindFilesTool?.name} tool instead of the Agent tool, to find the match more quickly
  - If you are searching for a specific class definition like "class Foo", use the ${FindFilesTool?.name} tool instead, to find the match more quickly
  
  Usage notes:
  1. Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
  2. When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
  3. Each agent invocation is stateless. You will not be able to send additional messages to the agent, nor will the agent be able to communicate with you outside of its final report. Therefore, your prompt should contain a highly detailed task description for the agent to perform autonomously and you should specify exactly what information the agent should return back to you in its final and only message to you.
  4. The agent's outputs should generally be trusted`;
  }

  /**
   * Handle the listResources command
   * @param stream The response stream
   */
  private async _handleListResourcesCommand(
    stream: vscode.ChatResponseStream
  ): Promise<vscode.ChatResult> {
    // Get resources from the resource manager
    const resources: Resource[] = [];
    for (const client of this.clients) {
      try {
        const resourcesResponse: ListResourcesResult = client.enabled ? await client.listResources() : { resources: [] };
        resources.push(...resourcesResponse.resources);
      } catch (e) {
        console.warn(`Failed to list resources for client ${client.getServerVersion()?.name}:`);
      }
    }

    if (resources.length === 0) {
      stream.push(new vscode.ChatResponseMarkdownPart(
        new vscode.MarkdownString("No resources found")
      ));
      return {};
    }

    const markdown = new vscode.MarkdownString();
    markdown.supportHtml = true;
    markdown.appendMarkdown(`<h2>Resources</h2>`);

    for (const resource of resources) {
      markdown.appendMarkdown(`<strong>${resource.name}:</strong>`);

      // Display appropriate resource info based on its type
      if (resource.mimeType === 'text/plain' && resource.text) {
        markdown.appendMarkdown(`<p>${resource.text}</p>`);
      } else if (resource.mimeType === 'application/octet-stream' && resource.blob) {
        try {
          const text = Buffer.from(resource.blob as string, 'base64').toString('utf-8');
          markdown.appendMarkdown(`<p>${text}</p>`);
        } catch (error) {
          markdown.appendMarkdown(`<p>Binary content (cannot display inline)</p>`);
        }
      } else {
        markdown.appendMarkdown(`<p>Type: ${resource.mimeType || 'unknown'}</p>`);
      }

      markdown.appendMarkdown(`<p>URI: ${resource.uri}</p>`);
      markdown.appendMarkdown('<hr>');
    }

    stream.push(new vscode.ChatResponseMarkdownPart(markdown));

    return {
      metadata: {
        command: 'readResource'
      }
    };
  }

  /**
   * Register the chat participant
   * @returns The chat participant disposable
   */
  public register(): vscode.Disposable {
    // Create the chat participant with a handler function
    const participant = vscode.chat.createChatParticipant(
      'copilot-mcp.mcp',
      this.handleRequest,
      // (request, context, stream, token) => myChatHandler(request, context, stream, token)
    );

    // Set followup provider (this class implements the interface)
    participant.followupProvider = this;

    // Set icon path
    participant.iconPath = this._logoPath;

    // Store the participant reference
    this._participant = participant;

    return participant;
  }

  set clients(clients: NamedClient[]) {
    this._clients = clients;
    // Repopulate the client tool map when clients change
    this._populateClientToolMap();
  }

  get clients() {
    return this._clients.filter(client => client.enabled);
  }

  /**
   * Get the map of client tools
   */
  get clientToolMap() {
    return this._clientToolMap;
  }

  set participant(participant: vscode.ChatParticipant) {
    this._participant = participant;
  }

  get participant() {
    if (!this._participant) {
      throw new Error('Participant not set');
    }
    return this._participant;
  }

  /**
   * Gets the singleton instance of ChatHandler
   * @param clients The named clients (only used when creating the instance)
   * @param extensionUri The extension URI (only used when creating the instance)
   * @returns The singleton ChatHandler instance
   */
  public static getInstance(
    clients?: NamedClient[],
    extensionUri?: vscode.ExtensionContext['extensionUri']
  ): ChatHandler {
    if (!ChatHandler._instance) {
      if (!clients || !extensionUri) {
        throw new Error('Clients and extensionUri are required when creating a new ChatHandler instance');
      }
      ChatHandler._instance = new ChatHandler(clients, extensionUri);
    }
    return ChatHandler._instance;
  }

  /**
   * Static factory method to create and register a chat handler
   * @param context The extension context
   * @param clients The named clients
   * @returns The chat participant disposable
   */
  public static register(
    context: vscode.ExtensionContext,
    clients: NamedClient[]
  ): vscode.Disposable {
    const handler = ChatHandler.getInstance(clients, context.extensionUri);
    const participantDisposable = handler.register();
    context.subscriptions.push(participantDisposable);
    return participantDisposable;
  }
}