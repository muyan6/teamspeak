import { computed, ref } from 'vue';

export const HOME_MODULES = [
  { key: 'connection', title: '连接卡片', description: '服务器地址、管理员信息与快速连接入口', icon: '↗' },
  { key: 'trend', title: '流量趋势', description: '展示本周和本月的在线人数变化', icon: '⌁' },
  { key: 'userRanks', title: '活跃榜', description: '按在线时长展示活跃用户排行', icon: '★' },
  { key: 'channelRanks', title: '热门频道', description: '展示最受欢迎的语音频道', icon: '#' },
  { key: 'achievements', title: '荣誉殿堂', description: '展示最高荣誉、资深成员与成就解锁进度', icon: '♛' },
  { key: 'elasticChannels', title: '弹性频道', description: '显示自动扩缩容频道的当前状态', icon: '◇' },
  { key: 'downloads', title: '客户端下载', description: '提供客户端、备用下载和汉化包链接', icon: '↓' },
  { key: 'realtime', title: '实时在线', description: '展示当前在线成员和所在频道', icon: '●' },
] as const;

export type HomeModuleKey = (typeof HOME_MODULES)[number]['key'];
export type HomeModules = Record<HomeModuleKey, boolean>;

export const DEFAULT_HOME_MODULES: HomeModules = {
  connection: true,
  trend: true,
  userRanks: true,
  channelRanks: true,
  achievements: true,
  elasticChannels: true,
  downloads: true,
  realtime: true,
};

function normalizeModules(value: unknown): HomeModules {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return HOME_MODULES.reduce<HomeModules>((modules, { key }) => {
    modules[key] = typeof input[key] === 'boolean' ? input[key] : DEFAULT_HOME_MODULES[key];
    return modules;
  }, {} as HomeModules);
}

async function requestModules(options?: RequestInit): Promise<HomeModules> {
  const token = localStorage.getItem('admin_token');
  const response = await fetch('/api/home-modules', {
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `请求失败 (${response.status})`);
  return normalizeModules(body.modules);
}

/** 主页和后台模块管理面板共用的开关状态。 */
export function useHomeModules() {
  const modules = ref<HomeModules>({ ...DEFAULT_HOME_MODULES });
  const loading = ref(false);
  const saving = ref(false);
  const error = ref('');
  const enabledCount = computed(() => Object.values(modules.value).filter(Boolean).length);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      modules.value = await requestModules();
    } catch (cause) {
      error.value = (cause as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function save(): Promise<void> {
    saving.value = true;
    error.value = '';
    try {
      modules.value = await requestModules({ method: 'PUT', body: JSON.stringify({ modules: modules.value }) });
    } catch (cause) {
      error.value = (cause as Error).message;
      throw cause;
    } finally {
      saving.value = false;
    }
  }

  function reset(): void {
    modules.value = { ...DEFAULT_HOME_MODULES };
  }

  return { modules, loading, saving, error, enabledCount, load, save, reset };
}
