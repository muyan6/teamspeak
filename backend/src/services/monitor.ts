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
  private lastSampleServerKey = '';
  private generation = 0;
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
    this.lastSampleServerKey = this.stats.getServerKey();
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
    this.generation += 1;
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
    const serverKey = this.stats.getServerKey();
    const generation = this.generation;
    const connectionVersion = this.ts3.getGeneration?.();
    const isCurrent = (): boolean => generation === this.generation
      && serverKey === this.stats.getServerKey()
      && connectionVersion === this.ts3.getGeneration?.();
    try {
      const snapshot = this.ts3.getSnapshot ? await this.ts3.getSnapshot(true) : null;
      const state = snapshot ? snapshot.state : await this.ts3.getServerState();
      if (!isCurrent()) return;
      if (!state) {
        this.serverState = null;
        this.stats.clearOnlineState();
        this.emit('onlineUpdated', { online: 0, maxClients: 0 });
        this.emit('clientsChanged', { online: 0 });
        return;
      }
      const clients = snapshot ? snapshot.clients : await this.ts3.getClients();
      if (!isCurrent()) return;
      const channels = snapshot ? snapshot.channels : await this.ts3.getChannels();
      if (!isCurrent()) return;
      this.serverState = state;
      this.stats.recordSnapshot(clients, channels);

      // 实时在线人数与列表包含所有在线客户端（包括音乐机器人等）；
      // 历史采样、在线峰值与流量趋势图仍严格剔除机器人，仅统计真人活跃数据。
      const excluded = this.stats.getExcludedBotUids();
      const humans = clients.filter((c) => !this.stats.isBot(c.uniqueIdentifier, c.nickname, excluded));
      const humanCount = humans.length;
      const totalOnline = clients.length;

      const now = Date.now();
      if (this.lastSampleServerKey !== serverKey) this.initLastSampleTime();
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
        online: totalOnline,
        maxClients: state.maxClients,
      });
      this.emit('clientsChanged', { online: totalOnline });
    } catch (err) {
      console.error('[monitor] 采集失败:', (err as Error).message);
    }
  }
}
