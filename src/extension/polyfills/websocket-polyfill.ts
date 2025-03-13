// WebSocket polyfill for Node.js environment
import * as ws from 'ws';

// Global WebSocket polyfill that makes ws compatible with the browser WebSocket API
if (typeof globalThis.WebSocket === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = ws.WebSocket;
    console.log('WebSocket polyfill applied');
}

export default ws.WebSocket; 