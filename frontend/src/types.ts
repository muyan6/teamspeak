export interface SiteInfo {
  title: string;
  footerDescription: string;
  logo: string;
  serverName: string;
  serverAddress: string;
  connectUrl: string;
  clientDownload: string;
  mirrorDownload: string;
  translationDownload: string;
  adminName: string;
  adminQq?: string;
  adminSteam?: string;
  globalServer: string;
  musicBotUrl?: string;
}

export type BadgeConditionType =
  | 'total_hours'
  | 'active_days'
  | 'streak_days'
  | 'night_owl'
  | 'bond_friends'
  | 'channel_stay'
  | 'weekly_champion';

export interface BadgeDefinition {
  id: number;
  badgeKey: string;
  name: string;
  category: 'milestone' | 'behavior' | 'custom';
  icon: string;
  color: string;
  description: string;
  conditionType: BadgeConditionType;
  conditionParams: Record<string, any>;
  serverGroupId: number;
  enabled: number;
  sortOrder: number;
  createdAt: number;
}

export interface UserBadge {
  id: string;
  name: string;
  category: 'milestone' | 'behavior' | 'custom';
  icon: string;
  color: string;
  description: string;
  unlocked: boolean;
  unlockedAt?: number;
  progress?: { current: number; total: number; unit: string };
}

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

export interface TutorialSection {
  key: string;
  title: string;
  content: string;
}

export interface Tutorial {
  enabled: boolean;
  title: string;
  sections: TutorialSection[];
  updatedAt: string;
}

export interface ElasticGroup {
  id: number;
  name: string;
  namePrefix: string;
  createThreshold: number;
  deleteThreshold: number;
  maxChannels: number;
  enabled: number;
}

export interface ElasticGroupStatus {
  group: ElasticGroup;
  channels: Array<{ cid: number; name: string; online: number }>;
  totalChannels: number;
  totalOnline: number;
}

export interface ElasticChannelData {
  groups: ElasticGroupStatus[];
  overallChannels: number;
}

export interface ChampionConfig {
  id: number;
  enabled: number;
  serverGroupId: number | null;
  checkIntervalHours: number;
  lastCheckTime: number | null;
  lastWinnerClientDbId: number | null;
  lastWinnerNickname: string | null;
}

export interface AchievementLevel {
  id: number;
  hours: number;
  serverGroupId: number;
  title: string;
  enabled: number;
}

export interface UnlockedAchievement {
  nickname: string;
  title: string;
  hours: number;
}

export interface HallOfFameData {
  featured: { nickname: string; title: string; hours: number } | null;
  rankings: Array<{ nickname: string; days: number }>;
  levels: Array<{ id: number; title: string; hours: number; unlockedCount: number }>;
  unlockedCount: number;
}

export interface ServerGroup {
  sgid: number;
  name: string;
}

export interface ChannelGroup {
  cgid: number;
  name: string;
}

export interface ProfileData {
  nickname: string;
  uid: string;
  server_groups?: string[];
  total_time: {
    hours: number;
    minutes: number;
    days: number;
    first_seen: string;
    last_seen: string;
  };
  rank: {
    current: number | null;
    last_week: number | null;
    change: number | null;
    week_time: number;
  };
  streak: {
    current_streak: number;
    max_streak: number;
    last_online: string;
  };
  bond_friends: Array<{ dbid: number; name: string; hours: number; last_meet: number }>;
  frequent_channels: Array<{ name: string; minutes: number }>;
  badges: UserBadge[];
  activity_heatmap: Array<{ date: string; seconds: number }>;
}

export interface UserSuggestion {
  nickname: string;
  uid: string;
}

export interface AdminChannel {
  cid: number;
  parentId: number;
  name: string;
  totalClients: number;
  totalClientsFamily: number;
  order: number;
}

export interface AdminClient {
  clid: number;
  clientDatabaseId: number;
  uniqueIdentifier: string;
  nickname: string;
  serverGroupIds: number[];
  channelId: number;
  channelName: string;
  channelGroupId: number;
  connectedTime: number;
  clientType: number;
}

export interface ClientDownloadConfig {
  version?: string;
  officialUrl?: string;
  mirrorUrl?: string;
  translationUrl?: string;
}

export interface SiteConfig {
  title?: string;
  footerDescription?: string;
  serverName?: string;
  serverAddress?: string;
  adminName?: string;
  adminQq?: string;
  adminSteam?: string;
}

export interface TutorialConfig {
  tutorial?: {
    download?: string;
    basic?: string;
    advanced?: string;
    music?: string;
  };
  clientDownload?: ClientDownloadConfig;
  musicBotUrl?: string;
}

export interface Ts3ConnectionInfo {
  host: string;
  queryPort: number;
  serverPort: number;
  serverId: number;
  username: string;
  hasPassword: boolean;
  connected: boolean;
  lastError: string | null;
}

export interface DashboardData {
  status: string;
  connected: boolean;
  site: SiteInfo;
  server_name: string;
  online_count: number;
  max_clients: number;
  realtime_list: RealtimeEntry[];
  ranks: { week: RankEntry[]; month: RankEntry[] };
  channels: { week: RankEntry[]; month: RankEntry[] };
  trends: { week: TrendData; month: TrendData };
  elastic_channels: ElasticChannelData;
  achievements: HallOfFameData;
  tutorial: Tutorial;
  cache_time: string;
}
