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

  getSiteSlug(): string {
    return this.config.site.slug;
  }

  getSiteDomain(): string {
    return this.config.site.domain;
  }

  private secondsToMinutes(v: number): string {
    return String(Math.max(0, Math.round(v / 60)));
  }

  private toRankEntries(rows: Array<{ clientDatabaseId: number; nickname: string; seconds: number }>): RankEntry[] {
    return rows.map((u) => ({
      name: u.nickname,
      value: this.secondsToMinutes(u.seconds),
      badges: this.achievement.getUnlockedBadges(u.clientDatabaseId),
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
    return { groups: result, overallChannels: channels.length };
  }

  async getData(): Promise<DashboardData> {
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
    const onlineCount = clients.length;
    const maxClients = state?.maxClients ?? 0;

    // 服务器组名映射
    const groupNames = new Map<number, string>();
    try {
      const groups = await this.ts3.getServerGroups();
      for (const g of groups) groupNames.set(g.sgid, g.name);
    } catch {
      /* ignore */
    }

    const realtimeList: RealtimeEntry[] = clients.map((c) => ({
      nickname: c.nickname,
      channel: c.channelName,
      groups: c.serverGroupIds.map((id) => groupNames.get(id) ?? `SG${id}`),
    }));

    // 活跃榜：按在线时长（本周/本月）
    const ranksWeek = connected ? this.toRankEntries(this.stats.getTopUsers('week', TOP_LIMIT)) : [];
    const ranksMonth = connected ? this.toRankEntries(this.stats.getTopUsers('month', TOP_LIMIT)) : [];

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
    };
    const tutorial = this.configStore.getJson<TutorialConfig>('tutorial', {});
    const tutorialUpdatedAt = this.configStore.getUpdatedAt('tutorial');
    const legacyGuide = this.configStore.get('guide') ?? undefined;
    const legacyGuideUpdatedAt = this.configStore.getUpdatedAt('guide');
    const siteInfo = this.configStore.getJson<SiteInfoConfig>('siteInfo', {});
    const musicBotUrl = this.configStore.get('musicBotUrl') ?? '';

    return {
      status: 'success',
      connected,
      site: buildSiteData(this.config, serverName, download, siteInfo, musicBotUrl),
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
