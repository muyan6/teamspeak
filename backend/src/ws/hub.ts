import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';

export class WsHub {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(server: Server, path = '/ws') {
    this.wss = new WebSocketServer({ server, path });
    this.wss.on('error', (err) => {
      if (server.listening) console.error(`[ws] 服务错误: ${err.message}`);
    });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });
  }

  broadcast(event: string, data: unknown): void {
    const msg = JSON.stringify({ event, data });
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(msg);
        } catch {
          /* ignore */
        }
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
