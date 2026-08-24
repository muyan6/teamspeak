import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';

export class WsHub {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, string>();
  private aliveClients = new WeakMap<WebSocket, boolean>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(server: Server, path = '/ws') {
    this.wss = new WebSocketServer({ server, path });
    this.wss.on('error', (err) => {
      if (server.listening) console.error(`[ws] 服务错误: ${err.message}`);
    });
    this.wss.on('connection', (ws, request) => {
      const host = (request.headers.host || '').split(':')[0].toLowerCase();
      this.clients.set(ws, host);
      this.aliveClients.set(ws, true);

      ws.on('pong', () => {
        this.aliveClients.set(ws, true);
      });

      const cleanup = (): void => {
        this.clients.delete(ws);
      };

      ws.on('close', cleanup);
      ws.on('error', cleanup);
    });

    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      for (const [ws] of this.clients.entries()) {
        if (this.aliveClients.get(ws) === false) {
          this.clients.delete(ws);
          try {
            ws.terminate();
          } catch {
            /* ignore */
          }
          continue;
        }

        this.aliveClients.set(ws, false);
        try {
          ws.ping();
        } catch {
          this.clients.delete(ws);
          try {
            ws.terminate();
          } catch {
            /* ignore */
          }
        }
      }
    }, 30000);
    this.heartbeatTimer.unref();
  }

  broadcast(event: string, data: unknown): void {
    if (this.clients.size === 0) return;
    this.sendToClients(Array.from(this.clients.keys()), event, data);
  }

  broadcastToHost(host: string, event: string, data: unknown): void {
    const normalizedHost = host.toLowerCase();
    const matching: WebSocket[] = [];
    for (const [client, clientHost] of this.clients.entries()) {
      if (clientHost === normalizedHost) {
        matching.push(client);
      }
    }
    if (matching.length === 0) return;
    this.sendToClients(matching, event, data);
  }

  broadcastWhere(shouldReceive: (host: string) => boolean, event: string, data: unknown): void {
    const matching: WebSocket[] = [];
    for (const [client, clientHost] of this.clients.entries()) {
      if (shouldReceive(clientHost)) {
        matching.push(client);
      }
    }
    if (matching.length === 0) return;
    this.sendToClients(matching, event, data);
  }

  private sendToClients(clients: Array<WebSocket>, event: string, data: unknown): void {
    if (clients.length === 0) return;
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

  close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.wss.close();
  }
}
