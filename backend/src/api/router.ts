import { Router, type Request, type Response, type NextFunction } from 'express';
import type { AuthService } from '../services/auth.js';
import type { SiteConfigStore } from '../db/site-config.js';
import type { StatsService } from '../services/stats.js';
import type { ElasticChannelService } from '../services/elastic.js';
import type { WeeklyChampionService } from '../services/champion.js';
import type { DashboardService } from '../services/dashboard.js';
import { getTs3ServerKey, type ClientDatabaseData, type Ts3ClientWrapper } from '../ts3/client.js';
import { adminAuth } from './middleware.js';
import { syncTs3ConfigToEnv } from '../env-file.js';

export interface ApiDeps {
  auth: AuthService;
  configStore: SiteConfigStore;
  stats: StatsService;
  elastic: ElasticChannelService;
  champion: WeeklyChampionService;
  dashboard: DashboardService;
  ts3: Ts3ClientWrapper;
  publicServer: { host: string; port: number };
}

interface SiteConfigPayload {
  guide?: string;
  clientDownload?: {
    version?: string;
    officialUrl?: string;
    mirrorUrl?: string;
    translationUrl?: string;
  };
}

function formatTs3Date(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return '';
  const d = new Date(timestamp * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const admin = adminAuth(deps.auth);

  const parseRange = (value: unknown, allowed: readonly string[], fallback: string): string => {
    const range = String(value ?? '').toLowerCase();
    return allowed.includes(range) ? range : fallback;
  };

  const parseLimit = (value: unknown, fallback = 10, max = 50): number => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, 1), max);
  };

  type AsyncHandler = (req: Request, res: Response) => Promise<void>;
  const asyncRoute = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

  const loadSiteConfig = (): SiteConfigPayload => {
    return {
      guide: deps.configStore.get('guide') ?? '',
      clientDownload: deps.configStore.getJson('clientDownload', {}),
    };
  };

  const findClient = async (nickname: string, uid: string): Promise<ClientDatabaseData | null> => {
    const clients = await deps.ts3.getClientDbList();
    if (uid) return clients.find((client) => client.uniqueIdentifier === uid) ?? null;
    const exact = clients.filter((client) => client.nickname === nickname);
    if (exact.length === 1) return exact[0];
    return null;
  };

  router.get('/site', (_req, res) => {
    res.json({ slug: deps.dashboard.getSiteSlug(), domain: deps.dashboard.getSiteDomain() });
  });

  // 聚合数据（主页）
  router.get('/data', asyncRoute(async (_req, res) => {
    try {
      const data = await deps.dashboard.getData();
      res.json(data);
    } catch (err) {
      res.status(503).json({
        status: 'error',
        message: (err as Error).message || '无法获取服务器数据',
      });
    }
  }));

  // 服务器连接信息
  router.get('/server-info', (_req, res) => {
    res.json({
      host: deps.publicServer.host,
      port: deps.publicServer.port,
      quickConnectUrl: `ts3server://${deps.publicServer.host}?port=${deps.publicServer.port}`,
    });
  });

  // 站点配置（guide / client download）
  router.get('/site-config', (_req, res) => {
    res.json(loadSiteConfig());
  });

  // 活跃榜（按在线时长）
  router.get('/stats/top-users', (req, res) => {
    const range = parseRange(req.query.range, ['week', 'month', 'all'], 'week') as 'week' | 'month' | 'all';
    const limit = parseLimit(req.query.limit);
    if (!deps.ts3.connected) {
      res.json({ range, users: [] });
      return;
    }
    res.json({ range, users: deps.stats.getTopUsers(range, limit) });
  });

  // 热门频道（按成员累计时长）
  router.get('/stats/top-channels', (req, res) => {
    const range = parseRange(req.query.range, ['week', 'month', 'all'], 'week') as 'week' | 'month' | 'all';
    const limit = parseLimit(req.query.limit);
    if (!deps.ts3.connected) {
      res.json({ range, channels: [] });
      return;
    }
    res.json({ range, channels: deps.stats.getTopChannels(range, limit) });
  });

  // 在线趋势
  router.get('/stats/trends', (req, res) => {
    const range = parseRange(req.query.range, ['week', 'month'], 'week') as 'week' | 'month';
    if (!deps.ts3.connected) {
      res.json({ labels: [], data: [] });
      return;
    }
    res.json(deps.stats.getDailyTrends(range === 'month' ? 30 : 7));
  });

  // 个人数据查询（按昵称）
  router.get('/stats/user', asyncRoute(async (req, res) => {
    const nickname = String(req.query.nickname || '').trim();
    const uid = String(req.query.uid || '').trim();
    if (!nickname && !uid) {
      res.status(400).json({ error: '请提供昵称或 UID' });
      return;
    }
    const client = await findClient(nickname, uid);
    if (!client) {
      const candidates = nickname ? (await deps.ts3.getClientDbList())
        .filter((entry) => entry.nickname === nickname)
        .map((entry) => ({ nickname: entry.nickname, uid: entry.uniqueIdentifier })) : [];
      if (candidates.length > 1) {
        res.status(409).json({ error: '存在同名用户，请从 UID 列表中选择', candidates });
        return;
      }
      res.status(404).json({ error: '未在 TeamSpeak 成员数据库中找到该用户' });
      return;
    }
    const stats = deps.stats.getUserStatsByIdentity(client);

    // 调用 TS3 后台真实数据：服务器组 + 账号创建时间
    let serverGroups: string[] = [];
    try {
      const groups = await deps.ts3.getServerGroupsByClientDbId(client.clientDatabaseId);
      serverGroups = groups.map((g) => g.name);
    } catch {
      serverGroups = [];
    }

    let createdAt = '';
    try {
      const dbInfo = await deps.ts3.getClientDbInfo(client.clientDatabaseId);
      if (dbInfo && dbInfo.created > 0) {
        const d = new Date(dbInfo.created * 1000);
        createdAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate()
        ).padStart(2, '0')}`;
      }
    } catch {
      createdAt = '';
    }

    const { dbid: _dbid, ...profile } = stats;
    res.json({
      ...profile,
      server_groups: serverGroups,
      total_time: { ...profile.total_time, first_seen: createdAt || profile.total_time.first_seen },
      streak: { ...profile.streak, last_online: formatTs3Date(client.lastConnected) || profile.streak.last_online },
    });
  }));

  // 昵称搜索建议
  router.get('/stats/suggest', asyncRoute(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.json({ suggestions: [] });
      return;
    }
    const normalized = q.toLocaleLowerCase();
    const suggestions = (await deps.ts3.getClientDbList())
      .filter((client) => client.nickname.toLocaleLowerCase().includes(normalized))
      .slice(0, 8)
      .map((client) => ({ nickname: client.nickname, uid: client.uniqueIdentifier }));
    res.json({ suggestions });
  }));

  // 弹性频道
  router.get('/elastic/groups', admin, (_req, res) => {
    res.json(deps.elastic.listGroups());
  });

  router.get('/elastic/load', admin, asyncRoute(async (_req, res) => {
    const groups = deps.elastic.listGroups();
    let channels: Array<{ cid: number; name: string; totalClients: number }> = [];
    try {
      channels = await deps.ts3.getChannels();
    } catch {
      channels = [];
    }
    const result = groups.map((g) => {
      const prefix = g.namePrefix;
      const members = channels.filter((c) => c.name.startsWith(prefix));
      return {
        group: g,
        channels: members.map((c) => ({ cid: c.cid, name: c.name, online: c.totalClients })),
        totalChannels: members.length,
        totalOnline: members.reduce((s, c) => s + c.totalClients, 0),
      };
    });
    res.json({
      groups: result,
      overallChannels: channels.length,
    });
  }));

  router.post('/elastic/groups', admin, (req, res) => {
    const { name, namePrefix, createThreshold, deleteThreshold, password, channelGroupId, baseChannelId, maxChannels } =
      req.body ?? {};
    if (!name || !namePrefix) {
      res.status(400).json({ error: '名称与前缀必填' });
      return;
    }
    const group = deps.elastic.addGroup({
      name,
      namePrefix,
      createThreshold: parseInt(createThreshold, 10) || 2,
      deleteThreshold: parseInt(deleteThreshold, 10) || 0,
      password: password || undefined,
      channelGroupId: channelGroupId ? parseInt(channelGroupId, 10) : null,
      baseChannelId: baseChannelId ? parseInt(baseChannelId, 10) : null,
      maxChannels: parseInt(maxChannels, 10) || 8,
    });
    res.status(201).json(group);
  });

  router.delete('/elastic/groups/:id', admin, (req, res) => {
    const ok = deps.elastic.removeGroup(parseInt(req.params.id, 10));
    if (!ok) {
      res.status(404).json({ error: '频道组不存在' });
      return;
    }
    res.json({ success: true });
  });

  // 周冠军
  router.get('/champion/config', (_req, res) => {
    res.json(deps.champion.getConfig());
  });

  router.post('/champion/config', admin, (req, res) => {
    const { enabled, serverGroupId, checkIntervalHours } = req.body ?? {};
    const cfg = deps.champion.saveConfig({
      enabled: enabled ? 1 : 0,
      serverGroupId: serverGroupId ? parseInt(serverGroupId, 10) : null,
      checkIntervalHours: parseInt(checkIntervalHours, 10) || 24,
    });
    res.json(cfg);
  });

  router.post('/champion/check', admin, asyncRoute(async (_req, res) => {
    const result = await deps.champion.check();
    res.json({ result });
  }));

  // 服务器组列表（用于配置选择）
  router.get('/server-groups', admin, asyncRoute(async (_req, res) => {
    try {
      const groups = await deps.ts3.getServerGroups();
      res.json(groups);
    } catch {
      res.status(503).json({ error: '无法获取服务器组，请确认 TS3 连接正常' });
    }
  }));

  // ===== TS3 服务器管理 =====

  // 当前 TS3 连接配置（密码脱敏）
  router.get('/admin/ts3-config', admin, (_req, res) => {
    const cfg = deps.ts3.getConfig();
    res.json({
      host: cfg.host,
      queryPort: cfg.queryPort,
      serverPort: cfg.serverPort,
      username: cfg.username,
      hasPassword: !!cfg.password,
      connected: deps.ts3.connected,
    });
  });

  // 保存 TS3 连接配置并触发重连
  router.post('/admin/ts3-config', admin, (req, res) => {
    const { host, queryPort, serverPort, username, password } = req.body ?? {};
    const current = deps.ts3.getConfig();
    const qp = parseInt(String(queryPort ?? ''), 10);
    const sp = parseInt(String(serverPort ?? ''), 10);
    const newCfg = {
      host: host ? String(host).trim() : current.host,
      queryPort: Number.isFinite(qp) ? qp : current.queryPort,
      serverPort: Number.isFinite(sp) ? sp : current.serverPort,
      username: username ? String(username).trim() : current.username,
      password: password !== undefined && password !== '' ? String(password) : current.password,
    };
    if (!newCfg.host) {
      res.status(400).json({ error: '服务器地址必填' });
      return;
    }
    deps.configStore.setJson('ts3Connection', newCfg);
    deps.stats.setServerKey(getTs3ServerKey(newCfg), true);
    deps.ts3.updateConfig(newCfg);
    syncTs3ConfigToEnv(newCfg);
    res.json({
      success: true,
      config: {
        host: newCfg.host,
        queryPort: newCfg.queryPort,
        serverPort: newCfg.serverPort,
        username: newCfg.username,
        hasPassword: !!newCfg.password,
      },
    });
  });

  // 频道列表
  router.get('/admin/channels', admin, asyncRoute(async (_req, res) => {
    try {
      const channels = await deps.ts3.getChannels();
      res.json(channels);
    } catch {
      res.status(503).json({ error: '无法获取频道列表' });
    }
  }));

  // 创建频道
  router.post('/admin/channels', admin, asyncRoute(async (req, res) => {
    const { name, cpid, password } = req.body ?? {};
    if (!name) {
      res.status(400).json({ error: '频道名必填' });
      return;
    }
    const cid = await deps.ts3.createChannel({
      name,
      cpid: cpid ? parseInt(String(cpid), 10) : undefined,
      password: password || undefined,
    });
    if (!cid) {
      res.status(500).json({ error: '创建频道失败' });
      return;
    }
    res.status(201).json({ cid });
  }));

  // 编辑频道（改名 / 移动 / 密码 / 上限）
  router.patch('/admin/channels/:cid', admin, asyncRoute(async (req, res) => {
    const cid = parseInt(req.params.cid, 10);
    const { name, cpid, password, maxclients } = req.body ?? {};
    const ok = await deps.ts3.editChannel(cid, {
      name: name || undefined,
      cpid: cpid !== undefined && cpid !== null ? parseInt(String(cpid), 10) : undefined,
      password: password !== undefined ? password : undefined,
      maxclients: maxclients !== undefined && maxclients !== null ? parseInt(String(maxclients), 10) : undefined,
    });
    if (!ok) {
      res.status(500).json({ error: '编辑频道失败' });
      return;
    }
    res.json({ success: true });
  }));

  // 删除频道
  router.delete('/admin/channels/:cid', admin, asyncRoute(async (req, res) => {
    const ok = await deps.ts3.deleteChannel(parseInt(req.params.cid, 10));
    if (!ok) {
      res.status(500).json({ error: '删除频道失败' });
      return;
    }
    res.json({ success: true });
  }));

  // 在线客户端列表
  router.get('/admin/clients', admin, asyncRoute(async (_req, res) => {
    try {
      const clients = await deps.ts3.getClients();
      res.json(clients);
    } catch {
      res.status(503).json({ error: '无法获取在线用户' });
    }
  }));

  // 踢出用户（服务器）
  router.post('/admin/clients/:clid/kick', admin, asyncRoute(async (req, res) => {
    const { reason } = req.body ?? {};
    const ok = await deps.ts3.kickClient(parseInt(req.params.clid, 10), reason ? String(reason) : undefined);
    if (!ok) {
      res.status(500).json({ error: '踢出失败' });
      return;
    }
    res.json({ success: true });
  }));

  // 移动用户到频道
  router.post('/admin/clients/:clid/move', admin, asyncRoute(async (req, res) => {
    const { cid, password } = req.body ?? {};
    if (!cid) {
      res.status(400).json({ error: '目标频道必填' });
      return;
    }
    const ok = await deps.ts3.moveClient(parseInt(req.params.clid, 10), parseInt(String(cid), 10), password ? String(password) : undefined);
    if (!ok) {
      res.status(500).json({ error: '移动失败' });
      return;
    }
    res.json({ success: true });
  }));

  // 封禁用户（按 UID）
  router.post('/admin/clients/:clid/ban', admin, asyncRoute(async (req, res) => {
    const { uid, reason, time } = req.body ?? {};
    if (!uid) {
      res.status(400).json({ error: '缺少用户 UID' });
      return;
    }
    const ok = await deps.ts3.banClientByUid(String(uid), reason ? String(reason) : undefined, time ? parseInt(String(time), 10) : undefined);
    if (!ok) {
      res.status(500).json({ error: '封禁失败' });
      return;
    }
    res.json({ success: true });
  }));

  // 给用户分配服务器组
  router.post('/admin/server-groups/assign', admin, asyncRoute(async (req, res) => {
    const { sgid, clientDatabaseId } = req.body ?? {};
    if (!sgid || !clientDatabaseId) {
      res.status(400).json({ error: '服务器组与用户必填' });
      return;
    }
    const ok = await deps.ts3.addClientToServerGroup(parseInt(String(sgid), 10), parseInt(String(clientDatabaseId), 10));
    if (!ok) {
      res.status(500).json({ error: '分配失败' });
      return;
    }
    res.json({ success: true });
  }));

  // 移除用户的服务器组
  router.post('/admin/server-groups/remove', admin, asyncRoute(async (req, res) => {
    const { sgid, clientDatabaseId } = req.body ?? {};
    if (!sgid || !clientDatabaseId) {
      res.status(400).json({ error: '服务器组与用户必填' });
      return;
    }
    const ok = await deps.ts3.removeClientFromServerGroup(parseInt(String(sgid), 10), parseInt(String(clientDatabaseId), 10));
    if (!ok) {
      res.status(500).json({ error: '移除失败' });
      return;
    }
    res.json({ success: true });
  }));

  // 频道组列表（用于给用户分配频道权限）
  router.get('/admin/channel-groups', admin, asyncRoute(async (_req, res) => {
    try {
      const groups = await deps.ts3.getChannelGroups();
      res.json(groups);
    } catch {
      res.status(503).json({ error: '无法获取频道组' });
    }
  }));

  // 给用户在指定频道分配频道组
  router.post('/admin/channel-groups/assign', admin, asyncRoute(async (req, res) => {
    const { cgid, cid, clientDatabaseId } = req.body ?? {};
    if (!cgid || !cid || !clientDatabaseId) {
      res.status(400).json({ error: '频道组、频道与用户必填' });
      return;
    }
    const ok = await deps.ts3.setClientChannelGroup(
      parseInt(String(cgid), 10),
      parseInt(String(cid), 10),
      parseInt(String(clientDatabaseId), 10)
    );
    if (!ok) {
      res.status(500).json({ error: '分配频道组失败' });
      return;
    }
    res.json({ success: true });
  }));

  // 移除用户在指定频道的频道组
  router.post('/admin/channel-groups/remove', admin, asyncRoute(async (req, res) => {
    const { cid, clientDatabaseId } = req.body ?? {};
    if (!cid || !clientDatabaseId) {
      res.status(400).json({ error: '频道与用户必填' });
      return;
    }
    const ok = await deps.ts3.setClientChannelGroup(0, parseInt(String(cid), 10), parseInt(String(clientDatabaseId), 10));
    if (!ok) {
      res.status(500).json({ error: '移除频道组失败' });
      return;
    }
    res.json({ success: true });
  }));

  // 站点配置保存
  router.post('/site-config', admin, (req, res) => {
    const body = (req.body ?? {}) as SiteConfigPayload;
    if (body.guide !== undefined) deps.configStore.set('guide', String(body.guide));
    if (body.clientDownload !== undefined) deps.configStore.setJson('clientDownload', body.clientDownload);
    res.json(loadSiteConfig());
  });

  // 管理认证
  router.post('/auth/login', (req, res) => {
    const { password } = req.body ?? {};
    if (!password || !deps.auth.verifyAdminPassword(String(password))) {
      res.status(401).json({ error: '管理密码错误' });
      return;
    }
    const token = deps.auth.signToken();
    res.json({ token });
  });

  router.get('/auth/check', admin, (_req, res) => {
    res.json({ admin: true });
  });

  // 统一异步错误处理（防止 async 路由抛错导致请求挂起）
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(503).json({
      status: 'error',
      message: (err as Error).message || '服务器内部错误',
    });
  });

  return router;
}
