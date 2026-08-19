import type {
  AdminChannel,
  AdminClient,
  AchievementLevel,
  ChampionConfig,
  ChannelGroup,
  DashboardData,
  ElasticChannelData,
  ElasticGroup,
  ProfileData,
  ServerGroup,
  SiteConfig,
  SubsiteConfig,
  Ts3ConnectionInfo,
  UnlockedAchievement,
  UserSuggestion,
} from './types';

const BASE = '/api';

let authToken = localStorage.getItem('admin_token') || '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    if (res.status === 401) {
      authToken = '';
      localStorage.removeItem('admin_token');
    }
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string; message?: string }).error || (body as { message?: string }).message || `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getData: () => request<DashboardData>('/data'),

  getElasticLoad: () => request<ElasticChannelData>('/elastic/load'),

  listElasticGroups: () => request<ElasticGroup[]>('/elastic/groups'),
  addElasticGroup: (data: Record<string, unknown>) => request<ElasticGroup>('/elastic/groups', { method: 'POST', body: JSON.stringify(data) }),
  deleteElasticGroup: (id: number) => request<{ success: boolean }>(`/elastic/groups/${id}`, { method: 'DELETE' }),

  getChampionConfig: () => request<ChampionConfig>('/champion/config'),
  saveChampionConfig: (data: Record<string, unknown>) => request<ChampionConfig>('/champion/config', { method: 'POST', body: JSON.stringify(data) }),
  checkChampion: () => request<{ result: { nickname: string; seconds: number; granted: boolean } | null }>('/champion/check', { method: 'POST' }),

  listAchievementLevels: () => request<AchievementLevel[]>('/achievements/levels'),
  listUnlockedAchievements: () => request<UnlockedAchievement[]>('/achievements/unlocked'),
  addAchievementLevel: (data: Record<string, unknown>) => request<AchievementLevel>('/achievements/levels', { method: 'POST', body: JSON.stringify(data) }),
  updateAchievementLevel: (id: number, data: Record<string, unknown>) => request<{ success: boolean }>(`/achievements/levels/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAchievementLevel: (id: number) => request<{ success: boolean }>(`/achievements/levels/${id}`, { method: 'DELETE' }),
  checkAchievements: () => request<{ results: Array<{ nickname: string; title: string; granted: boolean }> }>('/achievements/check', { method: 'POST' }),

  getServerGroups: () => request<ServerGroup[]>('/server-groups'),

  getUserStats: (nickname: string, uid?: string) => request<ProfileData>(`/stats/user?nickname=${encodeURIComponent(nickname)}${uid ? `&uid=${encodeURIComponent(uid)}` : ''}`),
  suggestNicknames: (q: string) => request<{ suggestions: UserSuggestion[] }>(`/stats/suggest?q=${encodeURIComponent(q)}`),

  listChannels: () => request<AdminChannel[]>('/admin/channels'),
  createChannel: (data: Record<string, unknown>) => request<{ cid: number }>('/admin/channels', { method: 'POST', body: JSON.stringify(data) }),
  editChannel: (cid: number, data: Record<string, unknown>) => request<{ success: boolean }>(`/admin/channels/${cid}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteChannel: (cid: number) => request<{ success: boolean }>(`/admin/channels/${cid}`, { method: 'DELETE' }),

  listClients: () => request<AdminClient[]>('/admin/clients'),
  kickClient: (clid: number, reason?: string) => request<{ success: boolean }>(`/admin/clients/${clid}/kick`, { method: 'POST', body: JSON.stringify({ reason }) }),
  moveClient: (clid: number, cid: number, password?: string) => request<{ success: boolean }>(`/admin/clients/${clid}/move`, { method: 'POST', body: JSON.stringify({ cid, password }) }),
  banClient: (clid: number, uid: string, reason?: string, time?: number) => request<{ success: boolean }>(`/admin/clients/${clid}/ban`, { method: 'POST', body: JSON.stringify({ uid, reason, time }) }),
  assignServerGroup: (sgid: number, clientDatabaseId: number) => request<{ success: boolean }>('/admin/server-groups/assign', { method: 'POST', body: JSON.stringify({ sgid, clientDatabaseId }) }),
  removeServerGroup: (sgid: number, clientDatabaseId: number) => request<{ success: boolean }>('/admin/server-groups/remove', { method: 'POST', body: JSON.stringify({ sgid, clientDatabaseId }) }),

  listChannelGroups: () => request<ChannelGroup[]>('/admin/channel-groups'),
  assignChannelGroup: (cgid: number, cid: number, clientDatabaseId: number) => request<{ success: boolean }>('/admin/channel-groups/assign', { method: 'POST', body: JSON.stringify({ cgid, cid, clientDatabaseId }) }),
  removeChannelGroup: (cid: number, clientDatabaseId: number) => request<{ success: boolean }>('/admin/channel-groups/remove', { method: 'POST', body: JSON.stringify({ cid, clientDatabaseId }) }),

  getSiteConfig: () => request<SiteConfig>('/site-config'),
  saveSiteConfig: (data: SiteConfig) => request<SiteConfig>('/site-config', { method: 'POST', body: JSON.stringify(data) }),

  getTs3Config: () => request<Ts3ConnectionInfo>('/admin/ts3-config'),
  saveTs3Config: (data: Record<string, unknown>) => request<{ success: boolean; config: Ts3ConnectionInfo }>('/admin/ts3-config', { method: 'POST', body: JSON.stringify(data) }),
  getSubsiteConfig: () => request<SubsiteConfig>('/admin/subsite'),
  saveSubsiteConfig: (data: SubsiteConfig) => request<SubsiteConfig>('/admin/subsite', { method: 'POST', body: JSON.stringify(data) }),

  login: async (password: string): Promise<void> => {
    const res = await request<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
    authToken = res.token;
    localStorage.setItem('admin_token', authToken);
  },
  logout: (): void => {
    authToken = '';
    localStorage.removeItem('admin_token');
  },
  isAuthed: () => !!authToken,
};
