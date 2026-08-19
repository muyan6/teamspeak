import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import cors from 'cors';
import { loadConfig, type AppConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { SiteConfigStore } from './db/site-config.js';
import { AuthService } from './services/auth.js';
import { StatsService } from './services/stats.js';
import { ElasticChannelService } from './services/elastic.js';
import { WeeklyChampionService } from './services/champion.js';
import { AchievementService } from './services/achievement.js';
import { MonitorService } from './services/monitor.js';
import { DashboardService } from './services/dashboard.js';
import { Ts3ClientWrapper, getTs3ServerKey, type Ts3ConnectionConfig } from './ts3/client.js';
import { createRouter } from './api/router.js';
import { WsHub } from './ws/hub.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const db = openDatabase(config.dbPath);
  const configStore = new SiteConfigStore(db);
  const auth = new AuthService(config.adminPassword, config.jwtSecret);
  const stats = new StatsService(db);

  const ts3Config = loadTs3Config(config, configStore);
  stats.setServerKey(getTs3ServerKey(ts3Config), Boolean(ts3Config.host));
  const ts3 = new Ts3ClientWrapper(ts3Config);
  const elastic = new ElasticChannelService(db, ts3);
  const champion = new WeeklyChampionService(db, ts3, stats);
  const achievement = new AchievementService(db, ts3);
  const monitor = new MonitorService(ts3, stats, db, config.collectIntervalMs, config.sampleIntervalMs);
  const dashboard = new DashboardService(config, ts3, stats, configStore, elastic);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // 分站实例只接受绑定的域名，避免同一进程被错误域名访问。
  if (config.site.domain) {
    const allowedHosts = config.site.domain
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    app.use((req, res, next) => {
      const host = req.hostname.toLowerCase();
      const localDev = process.env.NODE_ENV !== 'production' && (host === 'localhost' || host === '127.0.0.1');
      if (localDev || allowedHosts.includes(host)) {
        next();
        return;
      }
      res.status(421).json({ error: '当前域名未绑定到此分站' });
    });
  }

  app.use('/api', createRouter({ auth, configStore, stats, elastic, champion, achievement, dashboard, ts3, publicServer: config.publicServer }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ts3Connected: ts3.connected, site: config.site.slug });
  });

  // 生产模式：托管前端构建产物
  const frontendDist = path.resolve(process.cwd(), '../frontend/dist');
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wsHub = new WsHub(server, '/ws');

  // 实时事件推送
  monitor.on('onlineUpdated', (data) => wsHub.broadcast('online-update', data));
  monitor.on('clientsChanged', async (data) => {
    wsHub.broadcast('clients-changed', data);
    wsHub.broadcast('online-clients', stats.getCurrentOnline());
  });
  ts3.on('clientconnect', () => {
    void monitor.collect();
  });
  ts3.on('clientdisconnect', () => {
    void monitor.collect();
  });
  elasticTimer(elastic);
  achievementTimer(achievement);
  clientDirectoryTimer(ts3, stats);

  // 周期任务：周冠军检测（每次执行后按当前配置的间隔重新调度）
  scheduleChampionCheck(champion);

  // 连接 TS3
  ts3.on('connected', () => {
    console.log('[ts3] ServerQuery 已连接');
    monitor.start();
    void monitor.collect();
    void syncClientDirectory(ts3, stats);
  });
  ts3.on('error', (err) => {
    console.error('[ts3] 错误:', err.message);
  });
  ts3.on('disconnected', () => {
    console.log('[ts3] 连接断开，等待重连');
  });

  if (ts3Config.host) {
    await ts3.start();
  } else {
    console.log('[ts3] 未配置 TS3 服务器，请通过后台「服务器配置」填写连接参数');
  }

  server.once('error', (err: NodeJS.ErrnoException) => {
    const message = err.code === 'EADDRINUSE'
      ? `端口 ${config.port} 已被占用。请关闭占用进程或设置 PORT 后重试。`
      : err.message;
    console.error(`启动失败: ${message}`);
    process.exit(1);
  });

  server.listen(config.port, () => {
    console.log(`TS3 站点后端已启动: http://localhost:${config.port}`);
  });
}

async function syncClientDirectory(ts3: Ts3ClientWrapper, stats: StatsService): Promise<void> {
  const clients = await ts3.getClientDbList();
  if (clients.length === 0) return;
  const updated = stats.syncClientIdentities(clients);
  console.log(`[ts3] 成员数据库同步完成: ${clients.length} 人，更新 ${updated} 条本地身份记录`);
}

function clientDirectoryTimer(ts3: Ts3ClientWrapper, stats: StatsService): void {
  const run = (): void => {
    if (ts3.connected) void syncClientDirectory(ts3, stats);
  };
  const timer = setInterval(run, 6 * 3600 * 1000);
  timer.unref();
}

function loadTs3Config(config: AppConfig, configStore: SiteConfigStore): Ts3ConnectionConfig {
  const saved = configStore.getJson<Partial<Ts3ConnectionConfig>>('ts3Connection', {});
  return {
    host: saved.host || config.ts3.host,
    queryPort: saved.queryPort ?? config.ts3.queryPort,
    serverPort: saved.serverPort ?? config.ts3.serverPort,
    username: saved.username || config.ts3.username,
    password: saved.password ?? config.ts3.password,
  };
}

function elasticTimer(elastic: ElasticChannelService): void {
  const run = async (): Promise<void> => {
    try {
      const actions = await elastic.tick();
      for (const a of actions) {
        console.log(`[elastic] ${a.type === 'create' ? '创建' : '删除'}频道 ${a.channelName} (${a.group})`);
      }
    } catch (err) {
      console.error('[elastic] 检测失败:', (err as Error).message);
    }
  };
  void run();
  const timer = setInterval(run, 60000);
  timer.unref();
}

function scheduleChampionCheck(champion: WeeklyChampionService): void {
  const run = async (): Promise<void> => {
    try {
      const r = await champion.check();
      if (r) console.log(`[champion] 周冠军检测: ${r.nickname} granted=${r.granted}`);
    } catch (err) {
      console.error('[champion] 检测失败:', (err as Error).message);
    }
    const hours = champion.getConfig().checkIntervalHours;
    const interval = (hours > 0 ? hours : 24) * 3600 * 1000;
    const timer = setTimeout(() => {
      void run();
    }, interval);
    timer.unref();
  };
  void run();
}

function achievementTimer(achievement: AchievementService): void {
  const run = async (): Promise<void> => {
    try {
      const results = await achievement.check();
      const granted = results.filter((result) => result.granted).length;
      if (granted > 0) console.log(`[achievement] 本轮授予 ${granted} 项成就`);
    } catch (err) {
      console.error('[achievement] 检测失败:', (err as Error).message);
    }
  };
  void run();
  const timer = setInterval(run, 6 * 3600 * 1000);
  timer.unref();
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
