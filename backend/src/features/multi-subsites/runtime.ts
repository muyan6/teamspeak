import { existsSync, rmSync } from 'node:fs';
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
import { normalizeHost } from '../../net/host.js';
import type { WsHub } from '../../ws/hub.js';
import type { ManagedSubsite, MultiSubsiteRegistry, UpdateManagedSubsiteInput } from './service.js';

/**
 * 分站对外访问地址。
 *
 * 不能硬编码 `http://`：生产部署（install.md）使用 HTTPS，后台里展示 http 链接
 * 会被浏览器拦截或降级。这里按请求时站点使用的协议推导，并允许通过
 * SITE_PROTOCOL 环境变量显式覆盖。
 */
export function subsiteUrl(domain: string, protocol = process.env.SITE_PROTOCOL): string {
  const scheme = protocol === 'http' || protocol === 'https'
    ? protocol
    : (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  return `${scheme}://${domain}`;
}

class ManagedSubsiteRuntime {
  readonly db: AppDatabase;
  readonly ts3: Ts3ClientWrapper;
  readonly router: ReturnType<typeof createRouter>;
  private readonly stats: StatsService;
  private readonly dbPath: string;
  private readonly monitor: MonitorService;
  private readonly elastic: ElasticChannelService;
  private readonly champion: WeeklyChampionService;
  private readonly achievement: AchievementService;
  /** 只存放 setInterval 句柄；setTimeout（周冠军/初始归档）单独用 championTimer / initialArchiveTimer 管理。 */
  private readonly intervalTimers: NodeJS.Timeout[] = [];
  private championTimer?: NodeJS.Timeout;
  private initialArchiveTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    readonly subsite: ManagedSubsite,
    rootConfig: AppConfig,
    registry: MultiSubsiteRegistry,
    wsHub: WsHub,
    credentialCipher: CredentialCipher
  ) {
    this.dbPath = path.resolve(path.dirname(rootConfig.dbPath), 'subsites', `${subsite.slug}.db`);
    this.db = openDatabase(this.dbPath);
    const config: AppConfig = {
      ...rootConfig,
      ts3: { host: subsite.ts3Host, queryPort: subsite.queryPort, serverPort: subsite.serverPort, serverId: subsite.serverId, username: subsite.username, password: subsite.password },
      publicServer: { host: subsite.publicHost, port: subsite.publicPort },
      site: { ...rootConfig.site, title: subsite.displayName, serverName: subsite.displayName, slug: subsite.slug, domain: subsite.domain },
    };
    const store = new SiteConfigStore(this.db);
    this.stats = new StatsService(this.db);
    this.stats.setServerKey(getTs3ServerKey(config.ts3), true);
    this.ts3 = new Ts3ClientWrapper(config.ts3);
    const auth = new AuthService(subsite.adminPassword, createHmac('sha256', rootConfig.jwtSecret).update(`subsite:${subsite.id}`).digest('hex'));
    this.elastic = new ElasticChannelService(this.db, this.ts3, credentialCipher, () => this.stats.getServerKey());
    this.champion = new WeeklyChampionService(this.db, this.ts3, this.stats);
    this.achievement = new AchievementService(this.db, this.ts3, this.stats);
    this.monitor = new MonitorService(this.ts3, this.stats, this.db, rootConfig.collectIntervalMs, rootConfig.sampleIntervalMs);
    const dashboard = new DashboardService(config, this.ts3, this.stats, store, this.elastic, this.achievement);
    const deps: ApiDeps = {
      auth, configStore: store, stats: this.stats, elastic: this.elastic, champion: this.champion, achievement: this.achievement, dashboard, ts3: this.ts3, publicServer: config.publicServer, credentialCipher,
      persistTs3Config: (next) => registry.updateTs3Config(subsite.id, next),
      persistAdminPasswordHash: (passwordHash) => registry.updateAdminPasswordHash(subsite.id, passwordHash),
    };
    this.router = createRouter(deps);
    this.router.use(createHomeModulesRouter({ configStore: store, requireAdmin: adminAuth(auth) }));
    this.monitor.on('onlineUpdated', (data) => wsHub.broadcastToHost(subsite.domain, 'online-update', data));
    this.monitor.on('clientsChanged', (data) => wsHub.broadcastToHost(subsite.domain, 'clients-changed', data));
  }

  start(): void {
    this.ts3.on('connected', () => {
      this.monitor.start();
      const syncTimer = setTimeout(() => {
        if (this.ts3.connected) void this.syncClientDirectory();
      }, 1000);
      syncTimer.unref();
    });
    if (this.ts3.getConfig().host) void this.ts3.start();
    const elasticTimer = setInterval(() => void this.safeRun(() => this.runElastic()), 60_000);
    const achievementTimer = setInterval(() => void this.safeRun(() => this.runAchievement()), 6 * 3600 * 1000);
    const directoryTimer = setInterval(() => {
      if (this.ts3.connected) void this.syncClientDirectory();
    }, 6 * 3600 * 1000);
    const archiveDbPath = path.resolve(path.dirname(this.dbPath), `${this.subsite.slug}_archive.db`);
    const archiveTimer = setInterval(() => {
      void this.safeRun(() => this.runArchive(archiveDbPath));
    }, 24 * 3600 * 1000);
    elasticTimer.unref();
    achievementTimer.unref();
    directoryTimer.unref();
    archiveTimer.unref();
    this.intervalTimers.push(elasticTimer, achievementTimer, directoryTimer, archiveTimer);
    // 首次归档与总站保持一致（启动 10 秒后跑一次），而不是等满 24 小时。
    this.initialArchiveTimer = setTimeout(() => {
      void this.safeRun(() => this.runArchive(archiveDbPath));
    }, 10_000);
    this.initialArchiveTimer.unref();
    void this.runChampionAndSchedule();
  }

  stop(): void {
    this.stopped = true;
    this.monitor.stop();
    this.ts3.stop();
    for (const timer of this.intervalTimers.splice(0)) clearInterval(timer);
    if (this.championTimer) {
      clearTimeout(this.championTimer);
      this.championTimer = undefined;
    }
    if (this.initialArchiveTimer) {
      clearTimeout(this.initialArchiveTimer);
      this.initialArchiveTimer = undefined;
    }
    this.db.close();
  }

  private async syncClientDirectory(): Promise<void> {
    try {
      const clients = await this.ts3.getClientDbList();
      if (clients.length > 0) {
        const updated = this.stats.syncClientIdentities(clients);
        console.log(`[ts3:${this.subsite.slug}] 成员数据库同步完成: ${clients.length} 人，更新 ${updated} 条本地身份记录`);
      }
    } catch {
      /* 忽略临时网络异常 */
    }
  }

  private async runElastic(): Promise<void> {
    if (this.ts3.connected) await this.elastic.tick();
  }

  private async runAchievement(): Promise<void> {
    if (this.ts3.connected) await this.achievement.check();
  }

  private async runArchive(archiveDbPath: string): Promise<void> {
    const res = this.stats.archiveOldData(archiveDbPath, 180, 365);
    if (res.archivedSamples > 0 || res.archivedSessions > 0 || res.archivedChannelDays > 0 || res.archivedUserDays > 0) {
      console.log(`[archive:${this.subsite.slug}] 历史数据已归档: samples=${res.archivedSamples}, sessions=${res.archivedSessions}`);
    }
  }

  private async runChampionAndSchedule(): Promise<void> {
    if (this.stopped) return;
    await this.safeRun(async () => {
      if (this.ts3.connected) await this.champion.check();
    });
    if (this.stopped) return;
    const hours = this.champion.getConfig().checkIntervalHours;
    // 与 WeeklyChampionService 的合法区间保持一致（1..168 小时），避免脏数据产生超长定时器。
    const intervalHours = Number.isInteger(hours) && hours >= 1 && hours <= 168 ? hours : 24;
    this.championTimer = setTimeout(() => void this.runChampionAndSchedule(), intervalHours * 3600 * 1000);
    this.championTimer.unref();
  }

  private async safeRun(action: () => Promise<void>): Promise<void> {
    if (this.stopped) return;
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

  update(id: number, input: UpdateManagedSubsiteInput): ManagedSubsite {
    const subsite = this.registry.update(id, input);
    if (subsite.enabled) {
      this.start(subsite);
    }
    return subsite;
  }

  resetAdminPassword(id: number, newPassword: unknown): void {
    this.registry.resetAdminPassword(id, newPassword);
    const subsite = this.registry.get(id);
    if (subsite && subsite.enabled) {
      this.start(subsite);
    }
  }

  delete(id: number, purgeDatabase = false): ManagedSubsite {
    this.stop(id);
    const subsite = this.registry.delete(id);
    if (purgeDatabase) {
      try {
        const subsiteDir = path.resolve(path.dirname(this.config.dbPath), 'subsites');
        const dbFile = path.join(subsiteDir, `${subsite.slug}.db`);
        const archiveFile = path.join(subsiteDir, `${subsite.slug}_archive.db`);
        const walFile = path.join(subsiteDir, `${subsite.slug}.db-wal`);
        const shmFile = path.join(subsiteDir, `${subsite.slug}.db-shm`);
        // 非 WAL 模式（或降级）时 SQLite 会生成 -journal，一并清理避免残留。
        const journalFile = path.join(subsiteDir, `${subsite.slug}.db-journal`);
        const archiveJournalFile = path.join(subsiteDir, `${subsite.slug}_archive.db-journal`);
        for (const f of [dbFile, archiveFile, walFile, shmFile, journalFile, archiveJournalFile]) {
          if (existsSync(f)) rmSync(f, { force: true });
        }
      } catch (err) {
        console.error(`[subsite] 清理分站数据库文件失败: ${subsite.slug}`, err);
      }
    }
    return subsite;
  }

  setEnabled(id: number, enabled: boolean): ManagedSubsite {
    const subsite = this.registry.setEnabled(id, enabled);
    if (enabled) this.start(subsite);
    else this.stop(id);
    return subsite;
  }

  list(): Array<ManagedSubsite & { connected: boolean; lastError: string; url: string }> {
    return this.registry.list().map((subsite) => {
      const runtime = this.runtimes.get(subsite.id);
      return {
        ...subsite,
        connected: runtime?.ts3.connected ?? false,
        lastError: runtime?.ts3.lastError ?? '',
        url: subsiteUrl(subsite.domain),
      };
    });
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

  getHealthForHost(host: string): { ok: boolean; ts3Connected: boolean; site: string; platform: boolean } | null {
    const subsite = this.registry.getByHost(host);
    if (!subsite) return null;
    const runtime = this.runtimes.get(subsite.id);
    return {
      ok: true,
      ts3Connected: runtime?.ts3.connected ?? false,
      site: subsite.slug,
      platform: false,
    };
  }

  isManagedSubsiteHost(host: string): boolean {
    return this.registry.hasHost(normalizeHost(host));
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
