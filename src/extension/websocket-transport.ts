/**
 * WebSocket server transport for MCP
 */
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage, JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import WebSocket, { WebSocketServer } from 'ws';

const SUBPROTOCOL = "mcp";

/**
 * Server transport for WebSocket: this will serve clients over the WebSocket protocol.
 */
export class WebSocketServerTransport implements Transport {
    private _wss?: WebSocketServer;
    private _socket?: WebSocket;
    private _port: number;
    private _hostname: string;

    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    constructor(options: { port: number, hostname?: string }) {
        this._port = options.port;
        this._hostname = options.hostname || 'localhost';
    }

    async start(): Promise<void> {
        if (this._wss) {
            throw new Error(
                "WebSocketServerTransport already started!"
            );
        }

        return new Promise((resolve, reject) => {
            try {
                this._wss = new WebSocketServer({
                    port: this._port,
                    host: this._hostname,
                    clientTracking: true,
                    handleProtocols: (protocols) => {
                        if (protocols.has(SUBPROTOCOL)) {
                            return SUBPROTOCOL;
                        }
                        return false;
                    }
                });

                this._wss.on('error', (error) => {
                    console.error('WebSocket server error:', error);
                    this.onerror?.(error);
                });

                this._wss.on('connection', (socket, request) => {
                    console.log(`Client connected from ${request.socket.remoteAddress}`);

                    // Only handle one connection for simplicity
                    // In a real implementation, we would manage multiple connections
                    this._socket = socket;

                    socket.on('message', (data: WebSocket.Data) => {
                        let message: JSONRPCMessage;
                        try {
                            const msgText = data.toString();
                            message = JSONRPCMessageSchema.parse(JSON.parse(msgText));
                        } catch (error) {
                            console.error('Failed to parse message:', error);
                            this.onerror?.(error as Error);
                            return;
                        }

                        this.onmessage?.(message);
                    });

                    socket.on('close', () => {
                        console.log('Client disconnected');
                        if (this._socket === socket) {
                            this._socket = undefined;
                        }
                        // Don't call this.onclose() here; that would close the entire server
                    });

                    socket.on('error', (error) => {
                        console.error('Socket error:', error);
                        this.onerror?.(error);
                    });
                });

                this._wss.on('close', () => {
                    console.log('WebSocket server closed');
                    this.onclose?.();
                });

                // Wait for the server to start listening
                this._wss.on('listening', () => {
                    console.log(`WebSocket server listening on ws://${this._hostname}:${this._port}`);
                    resolve();
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async close(): Promise<void> {
        return new Promise((resolve) => {
            if (this._socket) {
                this._socket.close();
                this._socket = undefined;
            }

            if (this._wss) {
                this._wss.close(() => {
                    this._wss = undefined;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    async send(message: JSONRPCMessage): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this._socket || this._socket.readyState !== WebSocket.OPEN) {
                reject(new Error("No connected client"));
                return;
            }

            this._socket.send(JSON.stringify(message), (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
} 