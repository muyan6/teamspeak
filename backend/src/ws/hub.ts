import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';

export class WsHub {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, string>();

  constructor(server: Server, path = '/ws') {
    this.wss = new WebSocketServer({ server, path });
    this.wss.on('error', (err) => {
      if (server.listening) console.error(`[ws] 服务错误: ${err.message}`);
    });
    this.wss.on('connection', (ws, request) => {
      this.clients.set(ws, (request.headers.host || '').split(':')[0].toLowerCase());
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });
  }

  broadcast(event: string, data: unknown): void {
    this.sendToClients(this.clients.keys(), event, data);
  }

  broadcastToHost(host: string, event: string, data: unknown): void {
    const matching = Array.from(this.clients.entries())
      .filter(([, clientHost]) => clientHost === host.toLowerCase())
      .map(([client]) => client);
    this.sendToClients(matching, event, data);
  }

  private sendToClients(clients: Iterable<WebSocket>, event: string, data: unknown): void {
    const msg = JSON.stringify({ event, data });
    for (const ws of clients) {
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
