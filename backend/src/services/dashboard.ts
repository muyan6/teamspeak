import type { AppConfig } from '../config.js';
import { buildSiteData, buildTutorial, type SiteData, type SiteInfoConfig, type TutorialConfig, type TutorialData } from '../site.js';
import type { StatsService } from './stats.js';
import type { Ts3ClientWrapper, OnlineClientData, ChannelData } from '../ts3/client.js';
import type { ElasticChannelService } from '../features/elastic-channels/service.js';
import type { SiteConfigStore } from '../db/site-config.js';
import type { AchievementService, HallOfFameData, UserBadge } from '../features/achievements/service.js';

export interface RankEntry {
  name: string;
  value: string;
  badges?: UserBadge[];
}

export interface RealtimeEntry {
  nickname: string;
  channel: string;
  groups: string[];
}

export interface TrendData {
  labels: string[];
  data: number[];
}

export interface ElasticGroupInfo {
  id: number;
  name: string;
  namePrefix: string;
  createThreshold: number;
  deleteThreshold: number;
  maxChannels: number;
  enabled: number;
}

export interface ElasticChannelData {
  groups: Array<{
    group: ElasticGroupInfo;
    channels: Array<{ cid: number; name: string; online: number }>;
    totalChannels: number;
    totalOnline: number;
  }>;
  overallChannels: number;
}

export interface DashboardData {
  status: string;
  connected: boolean;
  site: SiteData;
  server_name: string;
  online_count: number;
  max_clients: number;
  realtime_list: RealtimeEntry[];
  ranks: { week: RankEntry[]; month: RankEntry[] };
  channels: { week: RankEntry[]; month: RankEntry[] };
  trends: { week: TrendData; month: TrendData };
  elastic_channels: ElasticChannelData;
  achievements: HallOfFameData;
  tutorial: TutorialData;
  cache_time: string;
}

const TOP_LIMIT = 20;

interface ClientDownloadConfig {
  version?: string;
  officialUrl?: string;
  mirrorUrl?: string;
  translationUrl?: string;
}

export class DashboardService {
  constructor(
    private config: AppConfig,
    private ts3: Ts3ClientWrapper,
    private stats: StatsService,
    private configStore: SiteConfigStore,
    private elastic: ElasticChannelService,
    private achievement: AchievementService
  ) {
    this.ts3.on?.('disconnected', () => this.invalidateCache());
    this.ts3.on?.('connected', () => this.invalidateCache());
  }

  private readonly cacheTtlMs = 10_000;
  private readonly groupCacheTtlMs = 5 * 60 * 1000;
  private cachedData: { value: DashboardData; expiresAt: number } | null = null;
  private cachedGroupNames: { value: Map<number, string>; expiresAt: number } | null = null;
  private dataInFlight: Promise<DashboardData> | null = null;
  private revision = 0;
  private cacheServerKey = '';
  /**
   * 最近一次「已连接」时构建成功的数据。
   * TS3 瞬时抖动（getServerState 返回 null）时用它兜底，避免首页所有榜单
   * 在同一秒内被清空——那比短暂展示历史数据体验更差。
   */
  private lastConnectedData: DashboardData | null = null;

  invalidateCache(clearHistory = false): void {
    this.revision += 1;
    this.cachedData = null;
    this.cachedGroupNames = null;
    this.dataInFlight = null;
    if (clearHistory) this.lastConnectedData = null;
  }

  getPublicServer(): { host: string; port: number } {
    const current = this.ts3.getConfig?.() ?? this.config.ts3 ?? { host: this.config.publicServer.host, serverPort: this.config.publicServer.port };
    const fixedHost = this.config.publicServer.hostConfigured
      ?? Boolean(this.config.publicServer.host && this.config.publicServer.host !== this.config.ts3?.host);
    const fixedPort = this.config.publicServer.portConfigured ?? this.config.publicServer.port !== 9987;
    return {
      host: fixedHost ? this.config.publicServer.host : current.host,
      port: fixedPort ? this.config.publicServer.port : current.serverPort,
    };
  }

  private content(serverName: string): Pick<DashboardData, 'site' | 'tutorial'> {
    const config = { ...this.config, publicServer: this.getPublicServer() };
    const download = this.configStore.getJson<ClientDownloadConfig>('clientDownload', {});
    const tutorial = this.configStore.getJson<TutorialConfig>('tutorial', {});
    return {
      site: buildSiteData(config, serverName, { clientDownload: download.officialUrl, mirrorDownload: download.mirrorUrl,
        translationDownload: download.translationUrl, version: download.version },
        this.configStore.getJson<SiteInfoConfig>('siteInfo', {}), this.configStore.get('musicBotUrl') ?? '',
        this.configStore.get('webClientUrl') ?? '', this.configStore.get('steamBoxUrl') ?? ''),
      tutorial: buildTutorial(config, tutorial, this.configStore.getUpdatedAt('tutorial') ?? this.configStore.getUpdatedAt('guide') ?? undefined,
        this.configStore.get('guide') ?? undefined),
    };
  }

  private async getGroupNames(): Promise<Map<number, string>> {
    const revision = this.revision;
    const now = Date.now();
    if (this.cachedGroupNames && this.cachedGroupNames.expiresAt > now) {
      return this.cachedGroupNames.value;
    }
    try {
      const groups = await this.ts3.getServerGroups();
      const map = new Map<number, string>();
      for (const g of groups) map.set(g.sgid, g.name);
      if (revision === this.revision) this.cachedGroupNames = { value: map, expiresAt: now + this.groupCacheTtlMs };
      return map;
    } catch {
      return this.cachedGroupNames?.value ?? new Map();
    }
  }

  getSiteSlug(): string {
    return this.config.site.slug;
  }

  getSiteDomain(): string {
    return this.config.site.domain;
  }

  private secondsToMinutes(v: number): string {
    return String(Math.max(0, Math.round(v / 60)));
  }

  private toRankEntries(
    rows: Array<{ clientDatabaseId: number; nickname: string; seconds: number }>,
    badgeMap?: Map<number, UserBadge[]>
  ): RankEntry[] {
    return rows.map((u) => ({
      name: u.nickname,
      value: this.secondsToMinutes(u.seconds),
      badges: badgeMap?.get(u.clientDatabaseId) ?? this.achievement.getUnlockedBadges(u.clientDatabaseId),
    }));
  }

  private buildElastic(channels: Array<{ cid: number; parentId?: number; name: string; totalClients: number }>): ElasticChannelData {
    const groups = this.elastic.listGroups().filter((g) => g.enabled === 1);
    const result = groups.map((g) => {
      const members = channels.filter((c) =>
        c.name.startsWith(g.namePrefix) && (g.baseChannelId ? c.parentId === g.baseChannelId : true)
      );
      return {
        group: {
          id: g.id,
          name: g.name,
          namePrefix: g.namePrefix,
          createThreshold: g.createThreshold,
          deleteThreshold: g.deleteThreshold,
          maxChannels: g.maxChannels,
          enabled: g.enabled,
        },
        channels: members.map((c) => ({ cid: c.cid, name: c.name, online: c.totalClients })),
        totalChannels: members.length,
        totalOnline: members.reduce((s, c) => s + c.totalClients, 0),
      };
    });
    return { groups: result, overallChannels: result.reduce((sum, group) => sum + group.totalChannels, 0) };
  }

  async getData(): Promise<DashboardData> {
    const serverKey = this.stats.getServerKey?.() ?? '';
    if (serverKey !== this.cacheServerKey) {
      this.cacheServerKey = serverKey;
      this.invalidateCache(true);
    }
    const revision = this.revision;
    const now = Date.now();
    if (this.cachedData && this.cachedData.expiresAt > now) return this.cachedData.value;
    if (this.dataInFlight) return this.dataInFlight;

    const loading = this.loadData()
      .then((value) => {
        if (revision !== this.revision) return this.getData();
        this.cachedData = { value, expiresAt: Date.now() + this.cacheTtlMs };
        if (value.connected) this.lastConnectedData = value;
        return value;
      })
      .finally(() => {
        if (this.dataInFlight === loading) this.dataInFlight = null;
      });
    this.dataInFlight = loading;
    return loading;
  }

  private async loadData(): Promise<DashboardData> {
    const snapshot = this.ts3.getSnapshot ? await this.ts3.getSnapshot() : null;
    const state = snapshot ? snapshot.state : await this.ts3.getServerState();
    let clients: OnlineClientData[] = [];
    let channels: ChannelData[] = [];
    try {
      clients = snapshot ? snapshot.clients : await this.ts3.getClients();
      channels = snapshot ? snapshot.channels : await this.ts3.getChannels();
    } catch {
      clients = [];
      channels = [];
    }

    const serverName = state?.name ?? this.config.site.serverName;
    const connected = state !== null;
    // 实时在线人数与列表包含所有在线客户端（包含音乐机器人等）；在线峰值与历史趋势仅统计真人
    const onlineCount = clients.length;
    const maxClients = state?.maxClients ?? 0;

    // TS3 瞬时抖动时不返回空榜单，改为回退最近一次成功构建的数据（仅替换连接态字段）。
    if (!connected && this.lastConnectedData) {
      return {
        ...this.lastConnectedData,
        ...this.content(serverName),
        connected: false,
        status: 'success',
        server_name: serverName,
        online_count: 0,
        max_clients: 0,
        realtime_list: [],
        cache_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
    }

    // 服务器组名映射（带 5 分钟缓存）
    const groupNames = await this.getGroupNames();

    // 实时在线列表展示所有在线客户端（包含音乐机器人等）
    const realtimeList: RealtimeEntry[] = clients.map((c) => ({
      nickname: c.nickname,
      channel: c.channelName,
      groups: c.serverGroupIds.map((id) => groupNames.get(id) ?? `SG${id}`),
    }));

    // 活跃榜：按在线时长（本周/本月），批量预取已解锁勋章
    const weekTopUsers = connected ? this.stats.getTopUsers('week', TOP_LIMIT) : [];
    const monthTopUsers = connected ? this.stats.getTopUsers('month', TOP_LIMIT) : [];
    const allTopDbIds = Array.from(new Set([...weekTopUsers, ...monthTopUsers].map((u) => u.clientDatabaseId)));
    const badgeMap = this.achievement.getBatchUnlockedBadges(allTopDbIds);
    const ranksWeek = this.toRankEntries(weekTopUsers, badgeMap);
    const ranksMonth = this.toRankEntries(monthTopUsers, badgeMap);

    // 热门频道：按成员累计时长（本周/本月）
    const channelsWeek = connected ? this.stats.getTopChannels('week', TOP_LIMIT).map((c) => ({
      name: c.channelName,
      value: String(Math.max(0, Math.round(c.memberSeconds / 60))),
    })) : [];
    const channelsMonth = connected ? this.stats.getTopChannels('month', TOP_LIMIT).map((c) => ({
      name: c.channelName,
      value: String(Math.max(0, Math.round(c.memberSeconds / 60))),
    })) : [];
    const weekTrend = this.stats.getDailyTrends(7);
    const monthTrend = this.stats.getDailyTrends(30);


    return {
      status: 'success',
      connected,
      ...this.content(serverName),
      server_name: serverName,
      online_count: onlineCount,
      max_clients: maxClients,
      realtime_list: realtimeList,
      ranks: { week: ranksWeek, month: ranksMonth },
      channels: { week: channelsWeek, month: channelsMonth },
      trends: {
        week: connected ? weekTrend : { ...weekTrend, data: weekTrend.data.map(() => 0) },
        month: connected ? monthTrend : { ...monthTrend, data: monthTrend.data.map(() => 0) },
      },
      elastic_channels: this.buildElastic(channels),
      achievements: this.achievement.getHallOfFame(),
      cache_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
  }
}
