import 'dotenv/config';
import { randomBytes } from 'node:crypto';

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface AppConfig {
  port: number;
  ts3: {
    host: string;
    queryPort: number;
    serverPort: number;
    serverId: number;
    username: string;
    password: string;
  };
  publicServer: {
    host: string;
    port: number;
  };
  site: {
    title: string;
    logo: string;
    serverName: string;
    slug: string;
    domain: string;
    adminName: string;
    adminQq: string;
    adminSteam: string;
    globalServer: string;
  };
  platform: {
    baseDomain: string;
  };
  adminPassword: string;
  jwtSecret: string;
  dbPath: string;
  collectIntervalMs: number;
  sampleIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const ts3Host = env.TS3_HOST || '';
  const queryPort = intEnv(env, 'TS3_QUERY_PORT', 10011);
  const adminQqVal = env.SITE_ADMIN_QQ || env.SITE_ADMIN_STEAM || '';

  return {
    port: intEnv(env, 'PORT', 3001),
    ts3: {
      host: ts3Host,
      queryPort,
      serverPort: intEnv(env, 'TS3_SERVER_PORT', 9987),
      // 未显式设置时继续按语音端口选择虚拟服务器，避免改变已有部署的连接目标。
      serverId: intEnv(env, 'TS3_SERVER_ID', 0),
      username: env.TS3_QUERY_USERNAME || 'serveradmin',
      password: env.TS3_QUERY_PASSWORD || '',
    },
    publicServer: {
      host: env.TS3_PUBLIC_HOST || ts3Host,
      port: intEnv(env, 'TS3_PUBLIC_PORT', 9987),
    },
    site: {
      title: env.SITE_TITLE || 'Voice',
      logo: env.SITE_LOGO || 'assets/img/logo.png',
      serverName: env.SITE_SERVER_NAME || '',
      slug: env.SITE_SLUG || 'default',
      domain: env.SITE_DOMAIN || '',
      adminName: env.SITE_ADMIN_NAME || '',
      adminQq: adminQqVal,
      adminSteam: adminQqVal,
      globalServer: env.SITE_GLOBAL_SERVER || '',
    },
    platform: {
      baseDomain: (env.SITE_BASE_DOMAIN || '').trim().toLowerCase().replace(/\.$/, ''),
    },
    adminPassword: env.ADMIN_PASSWORD || '',
    // 未配置时使用进程级随机密钥，避免公开默认值被用于伪造管理员令牌。
    jwtSecret: env.JWT_SECRET || randomBytes(32).toString('hex'),
    dbPath: env.DB_PATH || 'data/ts3monitor.db',
    collectIntervalMs: intEnv(env, 'COLLECT_INTERVAL_MS', 30000),
    sampleIntervalMs: intEnv(env, 'SAMPLE_INTERVAL_MS', 300000),
  };
}
