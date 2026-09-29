import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { normalizeHost } from '../net/host.js';

export class WsHub {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, string>();
  private aliveClients = new WeakMap<WebSocket, boolean>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(server: Server, path = '/ws') {
    this.wss = new WebSocketServer({ server, path, maxPayload: 16 * 1024 });
    this.wss.on('error', (err) => {
      if (server.listening) console.error(`[ws] 服务错误: ${err.message}`);
    });
    this.wss.on('connection', (ws, request) => {
      if (this.clients.size >= 5000) { ws.close(1013, '连接数量已达上限'); return; }
      // 与 HTTP 侧使用同一套归一化逻辑，兼容 IPv6 字面量（[::1]:4321）。
      const host = normalizeHost(request.headers.host || '');
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
    const normalizedHost = normalizeHost(host);
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
        // 状态消息可由下一次更新补齐，慢连接不应无限占用服务端内存。
        if (ws.bufferedAmount > 1024 * 1024) { ws.terminate(); this.clients.delete(ws); continue; }
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
    for (const client of this.clients.keys()) client.terminate();
    this.clients.clear();
    this.wss.close();
  }
}
