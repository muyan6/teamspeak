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
  private lastSampleTimeMs = 0;
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
    this.initLastSampleTime();
  }

  private initLastSampleTime(): void {
    try {
      const row = this.db
        .prepare('SELECT MAX(sample_time) as t FROM online_samples WHERE server_key = ?')
        .get(this.stats.getServerKey()) as { t: number | null } | undefined;
      this.lastSampleTimeMs = (row?.t ?? 0) * 1000;
    } catch {
      this.lastSampleTimeMs = 0;
    }
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

      // 统一口径：页面展示、WS 推送、趋势采样都使用「剔除机器人后」的人数。
      // 旧实现页面用 clients.length（含机器人）而采样用 humanCount，
      // 造成同一页面上「实时在线人数」与「趋势图峰值」对不上。
      const humans = clients.filter((c) => !this.stats.isBot(c.uniqueIdentifier, c.nickname));
      const humanCount = humans.length;

      const now = Date.now();
      const sampleInterval = this.sampleIntervalMs;
      if (now - this.lastSampleTimeMs >= sampleInterval) {
        // 采样失败不应影响本轮事件推送，因此单独捕获。
        try {
          this.stats.sampleOnline(humanCount, now);
          this.lastSampleTimeMs = now;
        } catch (err) {
          console.error('[monitor] 在线采样失败:', (err as Error).message);
        }
      }

      this.emit('onlineUpdated', {
        online: humanCount,
        maxClients: state.maxClients,
      });
      this.emit('clientsChanged', { online: humanCount });
    } catch (err) {
      console.error('[monitor] 采集失败:', (err as Error).message);
    }
  }
}
