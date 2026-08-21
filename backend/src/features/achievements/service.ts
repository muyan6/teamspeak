import type { AppDatabase } from '../../db/database.js';
import type { StatsService } from '../../services/stats.js';
import { Ts3ClientWrapper } from '../../ts3/client.js';

export interface AchievementLevel {
  id: number;
  hours: number;
  serverGroupId: number;
  title: string;
  enabled: number;
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

export interface HallOfFameData {
  featured: { nickname: string; title: string; hours: number } | null;
  rankings: Array<{ nickname: string; days: number }>;
  levels: Array<{ id: number; title: string; hours: number; unlockedCount: number }>;
  unlockedCount: number;
}

export class AchievementService {
  private checksInFlight = new Map<string, Promise<Array<{ nickname: string; title: string; granted: boolean }>>>();

  constructor(
    private db: AppDatabase,
    private ts3: Ts3ClientWrapper,
    private stats: StatsService
  ) {}

  listLevels(): AchievementLevel[] {
    return this.db
      .prepare(
        'SELECT id, hours, server_group_id as serverGroupId, title, enabled FROM achievement_levels ORDER BY hours ASC'
      )
      .all() as AchievementLevel[];
  }

  addLevel(data: { hours: number; serverGroupId: number; title: string }): AchievementLevel {
    const info = this.db
      .prepare(
        'INSERT INTO achievement_levels (hours, server_group_id, title, enabled) VALUES (?, ?, ?, 1)'
      )
      .run(data.hours, data.serverGroupId, data.title);
    return this.listLevels().find((l) => l.id === Number(info.lastInsertRowid))!;
  }

  updateLevel(
    id: number,
    data: { hours: number; serverGroupId: number; title: string; enabled: number }
  ): boolean {
    return (
      this.db
        .prepare(
          'UPDATE achievement_levels SET hours = ?, server_group_id = ?, title = ?, enabled = ? WHERE id = ?'
        )
        .run(data.hours, data.serverGroupId, data.title, data.enabled, id).changes > 0
    );
  }

  removeLevel(id: number): boolean {
    this.db.prepare('DELETE FROM achievement_grants WHERE level_id = ?').run(id);
    return this.db.prepare('DELETE FROM achievement_levels WHERE id = ?').run(id).changes > 0;
  }

  /* ========== 动态勋章管理 (Badges) ========== */

  listBadges(): BadgeDefinition[] {
    const rows = this.db
      .prepare(
        `SELECT id, badge_key as badgeKey, name, category, icon, color, description,
                condition_type as conditionType, condition_params as conditionParamsText,
                server_group_id as serverGroupId, enabled, sort_order as sortOrder, created_at as createdAt
         FROM badges
         ORDER BY sort_order ASC, id ASC`
      )
      .all() as Array<{
        id: number;
        badgeKey: string;
        name: string;
        category: 'milestone' | 'behavior' | 'custom';
        icon: string;
        color: string;
        description: string;
        conditionType: BadgeConditionType;
        conditionParamsText: string;
        serverGroupId: number;
        enabled: number;
        sortOrder: number;
        createdAt: number;
      }>;

    return rows.map((r) => {
      let conditionParams: Record<string, any> = {};
      try {
        conditionParams = JSON.parse(r.conditionParamsText || '{}');
      } catch {
        conditionParams = {};
      }
      return {
        id: r.id,
        badgeKey: r.badgeKey,
        name: r.name,
        category: r.category,
        icon: r.icon,
        color: r.color,
        description: r.description,
        conditionType: r.conditionType,
        conditionParams,
        serverGroupId: r.serverGroupId,
        enabled: r.enabled,
        sortOrder: r.sortOrder,
        createdAt: r.createdAt,
      };
    });
  }

  addBadge(data: {
    badgeKey?: string;
    name: string;
    category?: 'milestone' | 'behavior' | 'custom';
    icon: string;
    color?: string;
    description?: string;
    conditionType: BadgeConditionType;
    conditionParams?: Record<string, any>;
    serverGroupId?: number;
    enabled?: number;
    sortOrder?: number;
  }): BadgeDefinition {
    const key = data.badgeKey || `badge_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const category = data.category || 'behavior';
    const color = data.color || '#fbbf24';
    const description = data.description || '';
    const paramsText = JSON.stringify(data.conditionParams || {});
    const serverGroupId = data.serverGroupId || 0;
    const enabled = data.enabled ?? 1;
    const sortOrder = data.sortOrder ?? 100;
    const now = Date.now();

    const info = this.db
      .prepare(
        `INSERT INTO badges
          (badge_key, name, category, icon, color, description, condition_type, condition_params, server_group_id, enabled, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(key, data.name, category, data.icon, color, description, data.conditionType, paramsText, serverGroupId, enabled, sortOrder, now);

    return this.listBadges().find((b) => b.id === Number(info.lastInsertRowid))!;
  }

  updateBadge(
    id: number,
    data: {
      badgeKey?: string;
      name: string;
      category?: 'milestone' | 'behavior' | 'custom';
      icon: string;
      color?: string;
      description?: string;
      conditionType: BadgeConditionType;
      conditionParams?: Record<string, any>;
      serverGroupId?: number;
      enabled: number;
      sortOrder?: number;
    }
  ): boolean {
    const paramsText = JSON.stringify(data.conditionParams || {});
    return (
      this.db
        .prepare(
          `UPDATE badges
           SET name = ?, icon = ?, color = ?, description = ?, condition_type = ?, condition_params = ?,
               server_group_id = ?, enabled = ?, sort_order = COALESCE(?, sort_order)
           WHERE id = ?`
        )
        .run(
          data.name,
          data.icon,
          data.color || '#fbbf24',
          data.description || '',
          data.conditionType,
          paramsText,
          data.serverGroupId || 0,
          data.enabled,
          data.sortOrder ?? null,
          id
        ).changes > 0
    );
  }

  removeBadge(id: number): boolean {
    this.db.prepare('DELETE FROM badge_grants WHERE badge_id = ?').run(id);
    return this.db.prepare('DELETE FROM badges WHERE id = ?').run(id).changes > 0;
  }

  /** 单项勋章判定逻辑 */
  evaluateBadgeForUser(
    badge: BadgeDefinition,
    clientDatabaseId: number
  ): { unlocked: boolean; progress?: { current: number; total: number; unit: string } } {
    const serverKey = this.stats.getServerKey();
    const params = badge.conditionParams || {};

    switch (badge.conditionType) {
      case 'total_hours': {
        const threshold = Number(params.threshold || 1);
        const row = this.db
          .prepare('SELECT total_seconds as totalSeconds FROM user_online_duration WHERE server_key = ? AND client_database_id = ?')
          .get(serverKey, clientDatabaseId) as { totalSeconds: number } | undefined;
        const totalHours = (row?.totalSeconds || 0) / 3600;
        return {
          unlocked: totalHours >= threshold,
          progress: { current: Math.min(threshold, Math.floor(totalHours)), total: threshold, unit: '小时' },
        };
      }

      case 'active_days': {
        const threshold = Number(params.threshold || 30);
        const activeDays = this.stats.getUserActiveDays(clientDatabaseId);
        return {
          unlocked: activeDays >= threshold,
          progress: { current: Math.min(threshold, activeDays), total: threshold, unit: '天' },
        };
      }

      case 'streak_days': {
        const threshold = Number(params.threshold || 7);
        const dayRows = this.db
          .prepare('SELECT day FROM user_daily_activity WHERE server_key = ? AND client_database_id = ?')
          .all(serverKey, clientDatabaseId) as Array<{ day: string }>;
        const daySet = new Set(dayRows.map((r) => r.day));
        const sortedDays = [...daySet].sort();
        let maxRun = 0;
        let curRun = 0;
        for (let i = 0; i < sortedDays.length; i++) {
          if (i === 0) {
            curRun = 1;
          } else {
            const prev = new Date(`${sortedDays[i - 1]}T00:00:00`).getTime();
            const cur = new Date(`${sortedDays[i]}T00:00:00`).getTime();
            if (Math.round((cur - prev) / 86400000) === 1) {
              curRun++;
            } else {
              curRun = 1;
            }
          }
          maxRun = Math.max(maxRun, curRun);
        }
        return {
          unlocked: maxRun >= threshold,
          progress: { current: Math.min(threshold, maxRun), total: threshold, unit: '天' },
        };
      }

      case 'night_owl': {
        const isNightOwl = this.stats.hasNightOwlSessions(clientDatabaseId);
        return {
          unlocked: isNightOwl,
        };
      }

      case 'bond_friends': {
        const threshold = Number(params.threshold || 3);
        const count = this.stats.getBondFriendsCount(clientDatabaseId);
        return {
          unlocked: count >= threshold,
          progress: { current: Math.min(threshold, count), total: threshold, unit: '位好友' },
        };
      }

      case 'channel_stay': {
        const threshold = Number(params.threshold || 50);
        const topChannelSec = this.stats.getUserTopChannelDuration(clientDatabaseId);
        const topChannelHours = Math.floor(topChannelSec / 3600);
        return {
          unlocked: topChannelHours >= threshold,
          progress: { current: Math.min(threshold, topChannelHours), total: threshold, unit: '小时' },
        };
      }

      case 'weekly_champion': {
        const isChampion = this.stats.isWeeklyChampionWinner(clientDatabaseId);
        return {
          unlocked: isChampion,
        };
      }

      default:
        return { unlocked: false };
    }
  }

  /** 检测所有用户是否达成成就与勋章并授予/回收服务器组 */
  async check(): Promise<Array<{ nickname: string; title: string; granted: boolean }>> {
    const serverKey = this.stats.getServerKey();
    const existingCheck = this.checksInFlight.get(serverKey);
    if (existingCheck) return existingCheck;

    const check = this.checkInternal(serverKey).finally(() => {
      this.checksInFlight.delete(serverKey);
    });
    this.checksInFlight.set(serverKey, check);
    return check;
  }

  private async checkInternal(serverKey: string): Promise<Array<{ nickname: string; title: string; granted: boolean }>> {
    const results: Array<{ nickname: string; title: string; granted: boolean }> = [];
    const levels = this.listLevels().filter((l) => l.enabled === 1);
    const badges = this.listBadges().filter((b) => b.enabled === 1);

    // 清理已停用或已删除的勋章与成就 grants
    const enabledLevelIds = levels.map((l) => l.id);
    if (enabledLevelIds.length > 0) {
      const placeholders = enabledLevelIds.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM achievement_grants WHERE server_key = ? AND level_id NOT IN (${placeholders})`).run(serverKey, ...enabledLevelIds);
    } else {
      this.db.prepare('DELETE FROM achievement_grants WHERE server_key = ?').run(serverKey);
    }

    const enabledBadgeIds = badges.map((b) => b.id);
    if (enabledBadgeIds.length > 0) {
      const placeholders = enabledBadgeIds.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM badge_grants WHERE server_key = ? AND badge_id NOT IN (${placeholders})`).run(serverKey, ...enabledBadgeIds);
    } else {
      this.db.prepare('DELETE FROM badge_grants WHERE server_key = ?').run(serverKey);
    }

    const users = this.db
      .prepare(
        `SELECT client_database_id as clientDatabaseId, nickname, total_seconds as totalSeconds
         FROM user_online_duration
         WHERE server_key = ?`
      )
      .all(serverKey) as Array<{ clientDatabaseId: number; nickname: string; totalSeconds: number }>;

    for (const user of users) {
      // 1. 检测并授予/回收时长里程碑成就 (Milestone Levels)
      for (const level of levels) {
        const requiredSeconds = level.hours * 3600;
        const qualifies = user.totalSeconds >= requiredSeconds;

        const alreadyGranted = Boolean(
          this.db
            .prepare(
              'SELECT 1 FROM achievement_grants WHERE server_key = ? AND client_database_id = ? AND level_id = ?'
            )
            .get(serverKey, user.clientDatabaseId, level.id)
        );

        if (qualifies && !alreadyGranted) {
          let groupGranted = true;
          if (level.serverGroupId > 0) {
            try {
              groupGranted = await this.ts3.addClientToServerGroup(level.serverGroupId, user.clientDatabaseId);
            } catch (err) {
              groupGranted = false;
              console.warn(`[achievement] 授予 TS3 服务器组异常: level=${level.title}, dbid=${user.clientDatabaseId}`, err);
            }
          }
          if (!groupGranted) continue;

          this.db
            .prepare(
              `INSERT OR IGNORE INTO achievement_grants
                (server_key, client_database_id, level_id, granted_at)
               VALUES (?, ?, ?, ?)`
            )
            .run(serverKey, user.clientDatabaseId, level.id, Date.now());

          results.push({ nickname: user.nickname, title: level.title, granted: true });
        } else if (!qualifies && alreadyGranted) {
          // 条件提高或不再满足，回收成就
          let groupRemoved = true;
          if (level.serverGroupId > 0) {
            try {
              groupRemoved = await this.ts3.removeClientFromServerGroup(level.serverGroupId, user.clientDatabaseId);
            } catch (err) {
              groupRemoved = false;
              console.warn(`[achievement] 移除 TS3 服务器组异常: level=${level.title}, dbid=${user.clientDatabaseId}`, err);
            }
          }
          if (!groupRemoved) continue;

          this.db
            .prepare(
              'DELETE FROM achievement_grants WHERE server_key = ? AND client_database_id = ? AND level_id = ?'
            )
            .run(serverKey, user.clientDatabaseId, level.id);
        }
      }

      // 2. 检测并授予/回收动态勋章 (Badges)
      for (const badge of badges) {
        const evalRes = this.evaluateBadgeForUser(badge, user.clientDatabaseId);
        const qualifies = evalRes.unlocked;

        const alreadyGranted = Boolean(
          this.db
            .prepare(
              'SELECT 1 FROM badge_grants WHERE server_key = ? AND client_database_id = ? AND badge_id = ?'
            )
            .get(serverKey, user.clientDatabaseId, badge.id)
        );

        if (qualifies && !alreadyGranted) {
          let groupGranted = true;
          if (badge.serverGroupId > 0) {
            try {
              groupGranted = await this.ts3.addClientToServerGroup(badge.serverGroupId, user.clientDatabaseId);
            } catch (err) {
              groupGranted = false;
              console.warn(`[achievement] 授予 TS3 勋章服务器组异常: badge=${badge.name}, dbid=${user.clientDatabaseId}`, err);
            }
          }
          if (!groupGranted) continue;

          this.db
            .prepare(
              `INSERT OR IGNORE INTO badge_grants
                (server_key, client_database_id, badge_id, granted_at)
               VALUES (?, ?, ?, ?)`
            )
            .run(serverKey, user.clientDatabaseId, badge.id, Date.now());

          results.push({ nickname: user.nickname, title: badge.name, granted: true });
        } else if (!qualifies && alreadyGranted) {
          // 条件提高或不再满足，回收勋章与服务器组
          let groupRemoved = true;
          if (badge.serverGroupId > 0) {
            try {
              groupRemoved = await this.ts3.removeClientFromServerGroup(badge.serverGroupId, user.clientDatabaseId);
            } catch (err) {
              groupRemoved = false;
              console.warn(`[achievement] 移除 TS3 勋章服务器组异常: badge=${badge.name}, dbid=${user.clientDatabaseId}`, err);
            }
          }
          if (!groupRemoved) continue;

          this.db
            .prepare(
              'DELETE FROM badge_grants WHERE server_key = ? AND client_database_id = ? AND badge_id = ?'
            )
            .run(serverKey, user.clientDatabaseId, badge.id);
        }
      }
    }
    return results;
  }

  /** 已解锁成就的用户数（用于荣誉殿堂时长成就榜） */
  getUnlockedCount(): number {
    const row = this.db.prepare(
      'SELECT COUNT(DISTINCT client_database_id) as cnt FROM achievement_grants WHERE server_key = ?'
    ).get(this.stats.getServerKey()) as {
      cnt: number;
    };
    return row.cnt;
  }

  getUnlockedUsers(): Array<{ nickname: string; title: string; hours: number }> {
    return this.db
      .prepare(
        `SELECT u.nickname as nickname, l.title as title, l.hours as hours
         FROM achievement_grants g
         JOIN user_online_duration u
           ON u.server_key = g.server_key AND u.client_database_id = g.client_database_id
         JOIN achievement_levels l ON l.id = g.level_id
         WHERE g.server_key = ?
         ORDER BY l.hours DESC, g.granted_at ASC`
      )
      .all(this.stats.getServerKey()) as Array<{ nickname: string; title: string; hours: number }>;
  }

  /** 主页荣誉殿堂公开汇总数据 */
  getHallOfFame(): HallOfFameData {
    const serverKey = this.stats.getServerKey();
    const featured = this.db
      .prepare(
        `SELECT u.nickname as nickname, l.title as title, l.hours as hours
         FROM achievement_grants g
         JOIN user_online_duration u
           ON u.server_key = g.server_key AND u.client_database_id = g.client_database_id
         JOIN achievement_levels l ON l.id = g.level_id
         WHERE g.server_key = ?
         ORDER BY l.hours DESC, g.granted_at ASC
         LIMIT 1`
      )
      .get(serverKey) as HallOfFameData['featured'];
    const rankings = this.stats.getCurrentStreakRankings(3);
    const levels = this.db
      .prepare(
        `SELECT l.id as id, l.title as title, l.hours as hours,
                COUNT(DISTINCT g.client_database_id) as unlockedCount
         FROM achievement_levels l
         LEFT JOIN achievement_grants g ON g.level_id = l.id AND g.server_key = ?
         WHERE l.enabled = 1
         GROUP BY l.id
         ORDER BY l.hours DESC, l.id ASC`
      )
      .all(serverKey) as HallOfFameData['levels'];

    return { featured: featured ?? null, rankings, levels, unlockedCount: this.getUnlockedCount() };
  }

  /** 获取用户全部统一徽章与成就（已解锁 + 进行中） */
  getUserBadges(clientDatabaseId: number): UserBadge[] {
    const serverKey = this.stats.getServerKey();
    const badges: UserBadge[] = [];

    // 1. 时长里程碑成就 (Milestone Badges)
    const levels = this.listLevels().filter((l) => l.enabled === 1);
    const userDurationRow = this.db
      .prepare('SELECT total_seconds as totalSeconds FROM user_online_duration WHERE server_key = ? AND client_database_id = ?')
      .get(serverKey, clientDatabaseId) as { totalSeconds: number } | undefined;
    const totalHours = (userDurationRow?.totalSeconds || 0) / 3600;

    const grants = this.db
      .prepare('SELECT level_id, granted_at FROM achievement_grants WHERE server_key = ? AND client_database_id = ?')
      .all(serverKey, clientDatabaseId) as Array<{ level_id: number; granted_at: number }>;
    const grantMap = new Map<number, number>();
    for (const g of grants) grantMap.set(g.level_id, g.granted_at);

    for (const level of levels) {
      const isGranted = totalHours >= level.hours;
      const grantedAt = isGranted ? (grantMap.get(level.id) ?? Date.now()) : undefined;

      let color = '#34d399';
      if (level.hours >= 500) color = '#ec4899';
      else if (level.hours >= 200) color = '#a855f7';
      else if (level.hours >= 100) color = '#fbbf24';
      else if (level.hours >= 50) color = '#38bdf8';

      badges.push({
        id: `milestone_${level.id}`,
        name: level.title,
        category: 'milestone',
        icon: level.hours >= 100 ? 'ph-crown' : 'ph-trophy',
        color,
        description: `累计在线时长达 ${level.hours} 小时`,
        unlocked: isGranted,
        unlockedAt: grantedAt,
        progress: {
          current: Math.min(level.hours, Math.floor(totalHours)),
          total: level.hours,
          unit: '小时',
        },
      });
    }

    // 2. 动态行为与自定义勋章 (Dynamic Badges)
    const dynamicBadges = this.listBadges().filter((b) => b.enabled === 1);
    const badgeGrantRows = this.db
      .prepare('SELECT badge_id, granted_at FROM badge_grants WHERE server_key = ? AND client_database_id = ?')
      .all(serverKey, clientDatabaseId) as Array<{ badge_id: number; granted_at: number }>;
    const badgeGrantMap = new Map<number, number>();
    for (const g of badgeGrantRows) badgeGrantMap.set(g.badge_id, g.granted_at);

    for (const b of dynamicBadges) {
      const evalRes = this.evaluateBadgeForUser(b, clientDatabaseId);
      const isGranted = evalRes.unlocked;
      const grantedAt = isGranted ? (badgeGrantMap.get(b.id) ?? Date.now()) : undefined;

      badges.push({
        id: `badge_${b.id}`,
        name: b.name,
        category: b.category,
        icon: b.icon,
        color: b.color,
        description: b.description,
        unlocked: isGranted,
        unlockedAt: grantedAt,
        progress: evalRes.progress,
      });
    }

    return badges;
  }

  /** 批量获取已解锁徽章（针对榜单快速展示） */
  getUnlockedBadges(clientDatabaseId: number): UserBadge[] {
    return this.getUserBadges(clientDatabaseId).filter((b) => b.unlocked);
  }
}
