import type { Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { asyncRoute } from '../../api/route-utils.js';
import type { ClientDatabaseData } from '../../ts3/client.js';

function parseRange(value: unknown, allowed: readonly string[], fallback: string): string {
  const range = String(value ?? '').toLowerCase();
  return allowed.includes(range) ? range : fallback;
}

function parseLimit(value: unknown, fallback = 10, max = 50): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function formatTs3Date(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return '';
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function findClient(clients: ClientDatabaseData[], nickname: string, uid: string): ClientDatabaseData | null {
  if (uid) return clients.find((client) => client.uniqueIdentifier === uid) ?? null;
  const exact = clients.filter((client) => client.nickname === nickname);
  return exact.length === 1 ? exact[0] : null;
}

const SEARCH_WINDOW_MS = 60 * 1000;
const SEARCH_MAX_REQUESTS = 60;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimits = new Map<string, RateLimitEntry>();

function isRateLimited(req: { ip?: string; socket: { remoteAddress?: string } }): boolean {
  const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimits.get(clientKey);
  if (!entry || now >= entry.resetAt) {
    rateLimits.set(clientKey, { count: 1, resetAt: now + SEARCH_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > SEARCH_MAX_REQUESTS;
}

export function registerProfileRoutes(router: Router, deps: ApiDeps): void {
  router.get('/stats/top-users', (req, res) => {
    const range = parseRange(req.query.range, ['week', 'month', 'all'], 'week') as 'week' | 'month' | 'all';
    const limit = parseLimit(req.query.limit);
    res.json({ range, users: deps.ts3.connected ? deps.stats.getTopUsers(range, limit) : [] });
  });

  router.get('/stats/top-channels', (req, res) => {
    const range = parseRange(req.query.range, ['week', 'month', 'all'], 'week') as 'week' | 'month' | 'all';
    const limit = parseLimit(req.query.limit);
    res.json({ range, channels: deps.ts3.connected ? deps.stats.getTopChannels(range, limit) : [] });
  });

  router.get('/stats/trends', (req, res) => {
    const range = parseRange(req.query.range, ['week', 'month'], 'week') as 'week' | 'month';
    res.json(deps.ts3.connected ? deps.stats.getDailyTrends(range === 'month' ? 30 : 7) : { labels: [], data: [] });
  });

  router.get('/stats/user', asyncRoute(async (req, res) => {
    if (isRateLimited(req)) {
      res.status(429).json({ error: '查询请求过于频繁，请稍后再试' });
      return;
    }

    const nickname = String(req.query.nickname || '').trim();
    const uid = String(req.query.uid || '').trim();
    if (!nickname && !uid) {
      res.status(400).json({ error: '请提供昵称或 UID' });
      return;
    }

    // 1. 优先从本地数据库检索用户（避免直接穿透 TS3 ServerQuery 导致 Flood Ban 与 DoS）
    let identity: { clientDatabaseId: number; uniqueIdentifier: string; nickname: string } | null = null;
    if (uid) {
      identity = deps.stats.getLocalIdentityByUid ? deps.stats.getLocalIdentityByUid(uid) : null;
    } else {
      const localMatches = deps.stats.findLocalIdentities ? deps.stats.findLocalIdentities(nickname) : [];
      if (localMatches.length > 1) {
        // 同名用户，返回候选 UID 供前端选择
        const candidates = localMatches.map((m) => ({ nickname: m.nickname, uid: m.uniqueIdentifier }));
        res.status(409).json({ error: '存在同名用户，请从 UID 列表中选择', candidates });
        return;
      }
      if (localMatches.length === 1) {
        identity = localMatches[0];
      }
    }

    // 2. 本地数据库未命中时，才向 TS3 远端 ServerQuery 回退查找（仅在已连接时）
    if (!identity && deps.ts3.connected) {
      try {
        const remoteClients = await deps.ts3.getClientDbList();
        const found = findClient(remoteClients, nickname, uid);
        if (found) {
          identity = {
            clientDatabaseId: found.clientDatabaseId,
            uniqueIdentifier: found.uniqueIdentifier,
            nickname: found.nickname,
          };
          // 将远端同步至本地数据库
          deps.stats.syncClientIdentities?.([found]);
        } else if (nickname) {
          const candidates = remoteClients
            .filter((entry) => entry.nickname === nickname)
            .map((entry) => ({ nickname: entry.nickname, uid: entry.uniqueIdentifier }));
          if (candidates.length > 1) {
            res.status(409).json({ error: '存在同名用户，请从 UID 列表中选择', candidates });
            return;
          }
        }
      } catch {
        /* 远端查询失败时继续走本地兜底 */
      }
    }

    if (!identity) {
      const localFallback = deps.stats.getUserStats ? deps.stats.getUserStats(nickname, uid) : null;
      if (!localFallback) {
        res.status(404).json({ error: '未在成员数据库中找到该用户' });
        return;
      }
      const { dbid, ...profile } = localFallback;
      const badges = deps.achievement.getUserBadges(dbid);
      res.json({
        ...profile,
        server_groups: [],
        badges,
      });
      return;
    }

    // 3. 构建用户画像数据与徽章进度
    const stats = deps.stats.getUserStatsByIdentity(identity);
    const badges = deps.achievement.getUserBadges(identity.clientDatabaseId);

    // 4. 服务器组与建号时间补充（优先从实时在线状态读取，减少 ServerQuery 阻塞）
    let serverGroups: string[] = [];
    const currentOnline = deps.stats.getCurrentOnline ? deps.stats.getCurrentOnline() : [];
    const onlineClient = currentOnline.find((c) => c.clientDatabaseId === identity!.clientDatabaseId);

    if (onlineClient && onlineClient.serverGroupIds) {
      try {
        const groups = await deps.ts3.getServerGroups();
        const groupMap = new Map(groups.map((g) => [g.sgid, g.name]));
        const groupIds = onlineClient.serverGroupIds.split(',').map((id) => Number(id.trim())).filter(Boolean);
        serverGroups = groupIds.map((id) => groupMap.get(id) || `SG${id}`);
      } catch {
        serverGroups = [];
      }
    } else if (deps.ts3.connected) {
      try {
        serverGroups = (await deps.ts3.getServerGroupsByClientDbId(identity.clientDatabaseId)).map((group) => group.name);
      } catch {
        serverGroups = [];
      }
    }

    let createdAt = '';
    if (deps.ts3.connected) {
      try {
        const dbInfo = await deps.ts3.getClientDbInfo(identity.clientDatabaseId);
        createdAt = dbInfo && dbInfo.created > 0 ? formatTs3Date(dbInfo.created) : '';
      } catch {
        createdAt = '';
      }
    }

    const { dbid: _dbid, ...profile } = stats;

    res.json({
      ...profile,
      server_groups: serverGroups,
      badges,
      total_time: { ...profile.total_time, first_seen: createdAt || profile.total_time.first_seen },
    });
  }));

  router.get('/stats/suggest', (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) {
      res.json({ suggestions: [] });
      return;
    }
    const suggestions = deps.stats.suggestNicknames(query, 8);
    res.json({ suggestions });
  });
}
