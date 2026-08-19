import { createHmac } from 'node:crypto';
import path from 'node:path';
import { createRouter, type ApiDeps } from '../../api/router.js';
import { createHomeModulesRouter } from '../home-modules/home-modules-router.js';
import type { AppConfig } from '../../config.js';
import { openDatabase, type AppDatabase } from '../../db/database.js';
import { SiteConfigStore } from '../../db/site-config.js';
import { AchievementService } from '../achievements/service.js';
import { ElasticChannelService } from '../elastic-channels/service.js';
import { WeeklyChampionService } from '../weekly-champion/service.js';
import { adminAuth } from '../../api/middleware.js';
import { AuthService, type CredentialCipher } from '../../services/auth.js';
import { DashboardService } from '../../services/dashboard.js';
import { MonitorService } from '../../services/monitor.js';
import { StatsService } from '../../services/stats.js';
import { getTs3ServerKey, Ts3ClientWrapper } from '../../ts3/client.js';
import type { WsHub } from '../../ws/hub.js';
import type { ManagedSubsite, MultiSubsiteRegistry } from './service.js';

class ManagedSubsiteRuntime {
  readonly db: AppDatabase;
  readonly ts3: Ts3ClientWrapper;
  readonly router: ReturnType<typeof createRouter>;
  private readonly monitor: MonitorService;
  private readonly elastic: ElasticChannelService;
  private readonly champion: WeeklyChampionService;
  private readonly achievement: AchievementService;
  private readonly timers: NodeJS.Timeout[] = [];
  private championTimer?: NodeJS.Timeout;

  constructor(
    readonly subsite: ManagedSubsite,
    rootConfig: AppConfig,
    registry: MultiSubsiteRegistry,
    wsHub: WsHub,
    credentialCipher: CredentialCipher
  ) {
    this.db = openDatabase(path.resolve(path.dirname(rootConfig.dbPath), 'subsites', `${subsite.slug}.db`));
    const config: AppConfig = {
      ...rootConfig,
      ts3: { host: subsite.ts3Host, queryPort: subsite.queryPort, serverPort: subsite.serverPort, serverId: subsite.serverId, username: subsite.username, password: subsite.password },
      publicServer: { host: subsite.publicHost, port: subsite.publicPort },
      site: { ...rootConfig.site, title: subsite.displayName, serverName: subsite.displayName, slug: subsite.slug, domain: subsite.domain },
    };
    const store = new SiteConfigStore(this.db);
    const stats = new StatsService(this.db);
    stats.setServerKey(getTs3ServerKey(config.ts3), true);
    this.ts3 = new Ts3ClientWrapper(config.ts3);
    const auth = new AuthService(subsite.adminPassword, createHmac('sha256', rootConfig.jwtSecret).update(`subsite:${subsite.id}`).digest('hex'));
    this.elastic = new ElasticChannelService(this.db, this.ts3, credentialCipher, () => stats.getServerKey());
    this.champion = new WeeklyChampionService(this.db, this.ts3, stats);
    this.achievement = new AchievementService(this.db, this.ts3, stats);
    this.monitor = new MonitorService(this.ts3, stats, this.db, rootConfig.collectIntervalMs, rootConfig.sampleIntervalMs);
    const dashboard = new DashboardService(config, this.ts3, stats, store, this.elastic, this.achievement);
    const deps: ApiDeps = {
      auth, configStore: store, stats, elastic: this.elastic, champion: this.champion, achievement: this.achievement, dashboard, ts3: this.ts3, publicServer: config.publicServer, credentialCipher,
      persistTs3Config: (next) => registry.updateTs3Config(subsite.id, next),
      persistAdminPasswordHash: (passwordHash) => registry.updateAdminPasswordHash(subsite.id, passwordHash),
    };
    this.router = createRouter(deps);
    this.router.use(createHomeModulesRouter({ configStore: store, requireAdmin: adminAuth(auth) }));
    this.monitor.on('onlineUpdated', (data) => wsHub.broadcastToHost(subsite.domain, 'online-update', data));
    this.monitor.on('clientsChanged', (data) => wsHub.broadcastToHost(subsite.domain, 'clients-changed', data));
  }

  start(): void {
    this.ts3.on('connected', () => this.monitor.start());
    if (this.ts3.getConfig().host) void this.ts3.start();
    const elasticTimer = setInterval(() => void this.safeRun(() => this.runElastic()), 60_000);
    const achievementTimer = setInterval(() => void this.safeRun(() => this.runAchievement()), 6 * 3600 * 1000);
    elasticTimer.unref();
    achievementTimer.unref();
    this.timers.push(elasticTimer, achievementTimer);
    void this.runChampionAndSchedule();
  }

  stop(): void {
    this.monitor.stop();
    this.ts3.stop();
    this.timers.splice(0).forEach(clearInterval);
    if (this.championTimer) clearTimeout(this.championTimer);
    this.db.close();
  }

  private async runElastic(): Promise<void> {
    if (this.ts3.connected) await this.elastic.tick();
  }

  private async runAchievement(): Promise<void> {
    if (this.ts3.connected) await this.achievement.check();
  }

  private async runChampionAndSchedule(): Promise<void> {
    await this.safeRun(async () => {
      if (this.ts3.connected) await this.champion.check();
    });
    const hours = this.champion.getConfig().checkIntervalHours;
    this.championTimer = setTimeout(() => void this.runChampionAndSchedule(), (hours > 0 ? hours : 24) * 3600 * 1000);
    this.championTimer.unref();
  }

  private async safeRun(action: () => Promise<void>): Promise<void> {
    try { await action(); } catch { /* 下一轮继续执行 */ }
  }
}

export class MultiSubsiteRuntimeManager {
  private readonly runtimes = new Map<number, ManagedSubsiteRuntime>();

  constructor(
    private readonly config: AppConfig,
    private readonly registry: MultiSubsiteRegistry,
    private readonly wsHub: WsHub,
    private readonly credentialCipher: CredentialCipher
  ) {}

  startExisting(): void {
    for (const subsite of this.registry.list().filter((item) => item.enabled)) this.start(subsite);
  }

  create(input: Parameters<MultiSubsiteRegistry['create']>[0]): ManagedSubsite {
    const subsite = this.registry.create(input);
    this.start(subsite);
    return subsite;
  }

  setEnabled(id: number, enabled: boolean): ManagedSubsite {
    const subsite = this.registry.setEnabled(id, enabled);
    if (enabled) this.start(subsite);
    else this.stop(id);
    return subsite;
  }

  list(): Array<ManagedSubsite & { connected: boolean; url: string }> {
    return this.registry.list().map((subsite) => ({
      ...subsite,
      connected: this.runtimes.get(subsite.id)?.ts3.connected ?? false,
      url: `http://${subsite.domain}`,
    }));
  }

  getSettings(): { baseDomain: string } {
    return this.registry.getSettings();
  }

  saveBaseDomain(value: unknown): { baseDomain: string } {
    return this.registry.saveBaseDomain(value);
  }

  getRouterForHost(host: string): ReturnType<typeof createRouter> | null {
    const subsite = this.registry.getByHost(host);
    if (!subsite) return null;
    return this.runtimes.get(subsite.id)?.router ?? null;
  }

  isManagedSubsiteHost(host: string): boolean {
    const normalized = host.toLowerCase().replace(/\.$/, '');
    return this.registry.hasHost(normalized);
  }

  private start(subsite: ManagedSubsite): void {
    this.stop(subsite.id);
    const runtime = new ManagedSubsiteRuntime(subsite, this.config, this.registry, this.wsHub, this.credentialCipher);
    this.runtimes.set(subsite.id, runtime);
    runtime.start();
  }

  private stop(id: number): void {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    runtime.stop();
    this.runtimes.delete(id);
  }
}
