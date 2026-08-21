import { EventEmitter } from 'node:events';
import { Ts3ClientWrapper } from '../ts3/client.js';
import { StatsService } from './stats.js';
import type { AppDatabase } from '../db/database.js';

export interface MonitorEvents {
  onlineUpdated: { online: number; maxClients: number };
  clientsChanged: { online: number };
}

export class MonitorService extends EventEmitter {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private collectInFlight: Promise<void> | null = null;
  serverState: { name: string; clientsOnline: number; maxClients: number; uptime: number } | null =
    null;

  constructor(
    private ts3: Ts3ClientWrapper,
    private stats: StatsService,
    private db: AppDatabase,
    private collectIntervalMs: number,
    private sampleIntervalMs: number
  ) {
    super();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.collect();
    this.timer = setInterval(() => void this.collect(), this.collectIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private get lastSampleTime(): number {
    const row = this.db
      .prepare('SELECT MAX(sample_time) as t FROM online_samples WHERE server_key = ?')
      .get(this.stats.getServerKey()) as { t: number | null };
    return row.t ?? 0;
  }

  async collect(): Promise<void> {
    if (!this.collectInFlight) {
      this.collectInFlight = this.collectInternal().finally(() => {
        this.collectInFlight = null;
      });
    }
    return this.collectInFlight;
  }

  private async collectInternal(): Promise<void> {
    try {
      const state = await this.ts3.getServerState();
      if (!state) {
        this.serverState = null;
        this.stats.clearOnlineState();
        this.emit('onlineUpdated', { online: 0, maxClients: 0 });
        this.emit('clientsChanged', { online: 0 });
        return;
      }
      this.serverState = state;

      const clients = await this.ts3.getClients();
      const channels = await this.ts3.getChannels();
      this.stats.recordSnapshot(clients, channels);

      const now = Date.now();
      const sampleInterval = this.sampleIntervalMs;
      if (now - this.lastSampleTime * 1000 >= sampleInterval) {
        const humanCount = clients.filter((c) => !this.stats.isBot(c.uniqueIdentifier, c.nickname)).length;
        this.stats.sampleOnline(humanCount, now);
      }

      this.emit('onlineUpdated', {
        online: clients.length,
        maxClients: state.maxClients,
      });
      this.emit('clientsChanged', { online: clients.length });
    } catch (err) {
      console.error('[monitor] 采集失败:', (err as Error).message);
    }
  }
}
