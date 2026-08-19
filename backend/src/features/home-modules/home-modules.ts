/**
 * 主页可见模块的持久化配置。
 *
 * 配置存放在既有的通用键值表内，不引入额外的迁移或部署步骤。
 */
export const HOME_MODULES_CONFIG_KEY = 'homeModules';

export const HOME_MODULE_KEYS = [
  'connection',
  'trend',
  'userRanks',
  'channelRanks',
  'elasticChannels',
  'downloads',
  'realtime',
] as const;

export type HomeModuleKey = (typeof HOME_MODULE_KEYS)[number];
export type HomeModules = Record<HomeModuleKey, boolean>;

export const DEFAULT_HOME_MODULES: Readonly<HomeModules> = Object.freeze({
  connection: true,
  trend: true,
  userRanks: true,
  channelRanks: true,
  elasticChannels: true,
  downloads: true,
  realtime: true,
});

type HomeModuleStore = {
  getJson?<T>(key: string, fallback: T): T;
  setJson(key: string, value: unknown): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 将外部输入收敛为完整、可预测且安全的布尔开关集合。 */
export function normalizeHomeModules(value?: unknown): HomeModules {
  const input = isRecord(value) ? value : {};
  return HOME_MODULE_KEYS.reduce<HomeModules>((modules, key) => {
    modules[key] = typeof input[key] === 'boolean' ? input[key] : DEFAULT_HOME_MODULES[key];
    return modules;
  }, {} as HomeModules);
}

export function loadHomeModules(store: HomeModuleStore): HomeModules {
  return normalizeHomeModules(store.getJson?.(HOME_MODULES_CONFIG_KEY, {}) ?? {});
}

export function saveHomeModules(store: Pick<HomeModuleStore, 'setJson'>, value: unknown): HomeModules {
  const modules = normalizeHomeModules(value);
  store.setJson(HOME_MODULES_CONFIG_KEY, modules);
  return modules;
}
