import type { WeeklyChampionService } from './service.js';
import type { Ts3ClientWrapper } from '../../ts3/client.js';

/** 配置变化重新排期；连接成功后首轮检测，断线不消耗完整检测周期。 */
export class ChampionScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private rerun = false;
  private readonly wake = (): void => { this.schedule(1000); };
  private readonly changed = (): void => { this.schedule(0); };

  constructor(private champion: WeeklyChampionService, private ts3: Ts3ClientWrapper) {}

  start(): void {
    this.champion.on('configChanged', this.changed);
    this.ts3.on('connected', this.wake);
    if (this.ts3.connected) this.wake();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.champion.off('configChanged', this.changed);
    this.ts3.off('connected', this.wake);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    if (this.running) { this.rerun = true; return; }
    this.timer = setTimeout(() => { void this.run(); }, delay);
    this.timer.unref();
  }

  private async run(): Promise<void> {
    if (this.stopped) return;
    this.running = true;
    try { if (this.ts3.connected) await this.champion.check(); }
    catch (error) { console.error('[champion] 检测失败:', (error as Error).message); }
    finally {
      this.running = false;
      if (!this.stopped) {
        const delay = this.rerun ? 0 : this.champion.getConfig().checkIntervalHours * 3600_000;
        this.rerun = false;
        this.schedule(delay);
      }
    }
  }
}
