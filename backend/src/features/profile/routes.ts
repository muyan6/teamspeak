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
    const nickname = String(req.query.nickname || '').trim();
    const uid = String(req.query.uid || '').trim();
    if (!nickname && !uid) {
      res.status(400).json({ error: '请提供昵称或 UID' });
      return;
    }
    let client: ClientDatabaseData | null = null;
    try {
      const clients = await deps.ts3.getClientDbList();
      client = findClient(clients, nickname, uid);
      if (!client) {
        const candidates = nickname ? clients
          .filter((entry) => entry.nickname === nickname)
          .map((entry) => ({ nickname: entry.nickname, uid: entry.uniqueIdentifier })) : [];
        if (candidates.length > 1) {
          res.status(409).json({ error: '存在同名用户，请从 UID 列表中选择', candidates });
          return;
        }
      }
    } catch {
      /* ignore */
    }

    if (!client) {
      const localStats = deps.stats.getUserStats(nickname, uid);
      if (!localStats) {
        res.status(404).json({ error: '未在成员数据库中找到该用户' });
        return;
      }
      const { dbid, ...profile } = localStats;
      const badges = deps.achievement.getUserBadges(dbid);
      res.json({
        ...profile,
        server_groups: [],
        badges,
      });
      return;
    }

    const stats = deps.stats.getUserStatsByIdentity(client);
    const badges = deps.achievement.getUserBadges(client.clientDatabaseId);
    let serverGroups: string[] = [];
    try {
      serverGroups = (await deps.ts3.getServerGroupsByClientDbId(client.clientDatabaseId)).map((group) => group.name);
    } catch {
      serverGroups = [];
    }
    let createdAt = '';
    try {
      const dbInfo = await deps.ts3.getClientDbInfo(client.clientDatabaseId);
      createdAt = dbInfo && dbInfo.created > 0 ? formatTs3Date(dbInfo.created) : '';
    } catch {
      createdAt = '';
    }
    const { dbid: _dbid, ...profile } = stats;
    res.json({
      ...profile,
      server_groups: serverGroups,
      badges,
      total_time: { ...profile.total_time, first_seen: createdAt || profile.total_time.first_seen },
      streak: { ...profile.streak, last_online: formatTs3Date(client.lastConnected) || profile.streak.last_online },
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
