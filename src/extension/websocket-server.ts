import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express, { Response } from 'express';


/**
 * Start the MCP server using WebSocket transport
 */
export async function startWebSocketMcpServer(port = 8080, hostname = 'localhost', server: McpServer) {

    const app = express();

    app.get("/sse", async (req, res) => {
        const transport = new SSEServerTransport("/messages", res as Response);
        await server.connect(transport);
        // Store the transport instance for later use. For simplicity, we assume a single client here.
        app.locals.transport = transport;
    });

    app.post("/messages", async (req, res) => {
        const transport = app.locals.transport;
        await transport.handlePostMessage(req, res);
    });

    app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
    });

    console.log(`MCP server started on port ${port}`);

    return {
        server,
        dispose: () => {
            console.log('Closing MCP WebSocket server');
            server.close();
        }
    };
}