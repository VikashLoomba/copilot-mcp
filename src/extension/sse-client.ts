import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * Simple MCP client that connects to our SSE server
 */
export async function baseClient(): Promise<{ client: Client, tools: Tool[], dispose: () => void }> {
    const client = new Client({
        name: "example-client",
        version: "1.0.0"
    }, {
        capabilities: {}
    });
    const transport = new SSEClientTransport(
        new URL("http://localhost:8080/sse")
    );

    try {
        // Connect to the server
        console.log('Connecting to MCP server...');
        await client.connect(transport);
        console.log('Connected to server!');

        // List available tools
        console.log('Listing tools...');
        const { tools } = await client.listTools();
        console.log('Available tools:', tools.map(t => t.name).join(', '));

        return { client, tools, dispose: () => client.close() };

    } catch (error) {
        throw error;
    }
}