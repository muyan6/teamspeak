import type { AppConfig } from '../config.js';
import { buildSiteData, buildTutorial, type DownloadConfig, type SiteData, type SiteInfoConfig, type TutorialConfig, type TutorialData } from '../site.js';
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
  ) {}

  private readonly cacheTtlMs = 10_000;
  private readonly groupCacheTtlMs = 5 * 60 * 1000;
  private cachedData: { value: DashboardData; expiresAt: number } | null = null;
  private cachedGroupNames: { value: Map<number, string>; expiresAt: number } | null = null;
  private dataInFlight: Promise<DashboardData> | null = null;
  /**
   * 最近一次「已连接」时构建成功的数据。
   * TS3 瞬时抖动（getServerState 返回 null）时用它兜底，避免首页所有榜单
   * 在同一秒内被清空——那比短暂展示历史数据体验更差。
   */
  private lastConnectedData: DashboardData | null = null;

  private async getGroupNames(): Promise<Map<number, string>> {
    const now = Date.now();
    if (this.cachedGroupNames && this.cachedGroupNames.expiresAt > now) {
      return this.cachedGroupNames.value;
    }
    try {
      const groups = await this.ts3.getServerGroups();
      const map = new Map<number, string>();
      for (const g of groups) map.set(g.sgid, g.name);
      this.cachedGroupNames = { value: map, expiresAt: now + this.groupCacheTtlMs };
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
    const now = Date.now();
    if (this.cachedData && this.cachedData.expiresAt > now) return this.cachedData.value;
    if (this.dataInFlight) return this.dataInFlight;

    this.dataInFlight = this.loadData()
      .then((value) => {
        this.cachedData = { value, expiresAt: Date.now() + this.cacheTtlMs };
        if (value.connected) this.lastConnectedData = value;
        return value;
      })
      .finally(() => {
        this.dataInFlight = null;
      });
    return this.dataInFlight;
  }

  private async loadData(): Promise<DashboardData> {
    const state = await this.ts3.getServerState();
    let clients: OnlineClientData[] = [];
    let channels: ChannelData[] = [];
    try {
      clients = await this.ts3.getClients();
      channels = await this.ts3.getChannels();
    } catch {
      clients = [];
      channels = [];
    }

    const serverName = state?.name ?? this.config.site.serverName;
    const connected = state !== null;
    // 与 MonitorService / WebSocket 推送保持一致：剔除机器人后再统计。
    const humans = clients.filter((c) => !this.stats.isBot(c.uniqueIdentifier, c.nickname));
    const onlineCount = humans.length;
    const maxClients = state?.maxClients ?? 0;

    // TS3 瞬时抖动时不返回空榜单，改为回退最近一次成功构建的数据（仅替换连接态字段）。
    if (!connected && this.lastConnectedData) {
      return {
        ...this.lastConnectedData,
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

    // 实时列表同样剔除机器人，否则页面会出现「在线 0 人」却列出 MusicBot 的矛盾现象。
    const realtimeList: RealtimeEntry[] = humans.map((c) => ({
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

    // 后台可配置的站点信息、下载链接与教程内容。
    const clientDownload = this.configStore.getJson<ClientDownloadConfig>('clientDownload', {});
    const download: DownloadConfig = {
      clientDownload: clientDownload.officialUrl,
      mirrorDownload: clientDownload.mirrorUrl,
      translationDownload: clientDownload.translationUrl,
      version: clientDownload.version,
    };
    const tutorial = this.configStore.getJson<TutorialConfig>('tutorial', {});
    const tutorialUpdatedAt = this.configStore.getUpdatedAt('tutorial');
    const legacyGuide = this.configStore.get('guide') ?? undefined;
    const legacyGuideUpdatedAt = this.configStore.getUpdatedAt('guide');
    const siteInfo = this.configStore.getJson<SiteInfoConfig>('siteInfo', {});
    const musicBotUrl = this.configStore.get('musicBotUrl') ?? '';
    const webClientUrl = this.configStore.get('webClientUrl') ?? '';
    const steamBoxUrl = this.configStore.get('steamBoxUrl') ?? '';

    return {
      status: 'success',
      connected,
      site: buildSiteData(this.config, serverName, download, siteInfo, musicBotUrl, webClientUrl, steamBoxUrl),
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
      tutorial: buildTutorial(this.config, tutorial, tutorialUpdatedAt ?? legacyGuideUpdatedAt ?? undefined, legacyGuide),
      cache_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
  }
}
