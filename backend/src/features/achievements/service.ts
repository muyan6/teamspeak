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

export interface UserBadge {
  id: string;
  name: string;
  category: 'milestone' | 'behavior';
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
    return this.db.prepare('DELETE FROM achievement_levels WHERE id = ?').run(id).changes > 0;
  }

  /** 检测所有用户是否达成成就并授予服务器组 */
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
    if (levels.length === 0) return results;

    const users = this.db
      .prepare(
        `SELECT client_database_id as clientDatabaseId, nickname, total_seconds as totalSeconds
         FROM user_online_duration
         WHERE server_key = ?`
      )
      .all(serverKey) as Array<{ clientDatabaseId: number; nickname: string; totalSeconds: number }>;

    for (const user of users) {
      for (const level of levels) {
        const requiredSeconds = level.hours * 3600;
        if (user.totalSeconds < requiredSeconds) continue;

        const alreadyGranted = this.db
          .prepare(
            'SELECT 1 FROM achievement_grants WHERE server_key = ? AND client_database_id = ? AND level_id = ?'
          )
          .get(serverKey, user.clientDatabaseId, level.id);

        if (alreadyGranted) {
          continue;
        }

        // 尝试授予 TS3 服务器组（如果设置了服务器组奖励且 TS3 处于连接状态）
        if (level.serverGroupId > 0) {
          try {
            await this.ts3.addClientToServerGroup(level.serverGroupId, user.clientDatabaseId);
          } catch (err) {
            console.warn(`[achievement] 授予 TS3 服务器组异常: level=${level.title}, dbid=${user.clientDatabaseId}`, err);
          }
        }

        // 记录成就解锁
        this.db
          .prepare(
            `INSERT OR IGNORE INTO achievement_grants
              (server_key, client_database_id, level_id, granted_at)
             VALUES (?, ?, ?, ?)`
          )
          .run(serverKey, user.clientDatabaseId, level.id, Date.now());

        results.push({ nickname: user.nickname, title: level.title, granted: true });
      }
    }
    return results;
  }

  /** 已解锁成就的用户（用于荣誉殿堂时长成就榜） */
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

  /** 主页荣誉殿堂需要的公开汇总数据。 */
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

  /** 用户个人成就查询 */
  getUserAchievements(clientDatabaseId: number): Array<{ title: string; hours: number }> {
    return this.db
      .prepare(
        `SELECT l.title as title, l.hours as hours
         FROM achievement_grants g
         JOIN achievement_levels l ON l.id = g.level_id
         WHERE g.server_key = ? AND g.client_database_id = ?
         ORDER BY l.hours ASC`
      )
      .all(this.stats.getServerKey(), clientDatabaseId) as Array<{ title: string; hours: number }>;
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
      const isGranted = grantMap.has(level.id) || totalHours >= level.hours;
      const grantedAt = grantMap.get(level.id);

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

    // 2. 趣味行为徽章 (Behavioral Badges)
    // A. 🦉 夜猫子
    const isNightOwl = this.stats.hasNightOwlSessions(clientDatabaseId);
    badges.push({
      id: 'behavior_night_owl',
      name: '夜猫子',
      category: 'behavior',
      icon: 'ph-moon-stars',
      color: '#818cf8',
      description: '在凌晨 02:00 ~ 05:00 期间深度在线',
      unlocked: isNightOwl,
    });

    // B. 🤝 社交达人
    const bondFriendsCount = this.stats.getBondFriendsCount(clientDatabaseId);
    badges.push({
      id: 'behavior_social',
      name: '社交达人',
      category: 'behavior',
      icon: 'ph-users-three',
      color: '#f472b6',
      description: '拥有 3 位以上深度羁绊好友',
      unlocked: bondFriendsCount >= 3,
      progress: {
        current: Math.min(3, bondFriendsCount),
        total: 3,
        unit: '位好友',
      },
    });

    // C. 🔥 连击达人 (7天打卡)
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
    badges.push({
      id: 'behavior_streak_7',
      name: '连击达人',
      category: 'behavior',
      icon: 'ph-flame',
      color: '#fb923c',
      description: '连续在线打卡达到 7 天',
      unlocked: maxRun >= 7,
      progress: {
        current: Math.min(7, maxRun),
        total: 7,
        unit: '天',
      },
    });

    // D. 👑 荣誉周魁首
    const isChampion = this.stats.isWeeklyChampionWinner(clientDatabaseId);
    badges.push({
      id: 'behavior_champion',
      name: '荣誉周魁首',
      category: 'behavior',
      icon: 'ph-medal',
      color: '#eab308',
      description: '曾荣获语音服务器活跃周冠军',
      unlocked: isChampion,
    });

    // E. 🎙️ 常驻房管
    const topChannelSec = this.stats.getUserTopChannelDuration(clientDatabaseId);
    const topChannelHours = Math.floor(topChannelSec / 3600);
    badges.push({
      id: 'behavior_room_master',
      name: '常驻房管',
      category: 'behavior',
      icon: 'ph-broadcast',
      color: '#38bdf8',
      description: '在任一主力频道累计在线停留超 50 小时',
      unlocked: topChannelHours >= 50,
      progress: {
        current: Math.min(50, topChannelHours),
        total: 50,
        unit: '小时',
      },
    });

    // F. ⚡️ 全勤铁人
    const activeDays = this.stats.getUserActiveDays(clientDatabaseId);
    badges.push({
      id: 'behavior_iron',
      name: '全勤铁人',
      category: 'behavior',
      icon: 'ph-lightning',
      color: '#10b981',
      description: '累计活跃天数达到 30 天',
      unlocked: activeDays >= 30,
      progress: {
        current: Math.min(30, activeDays),
        total: 30,
        unit: '天',
      },
    });

    return badges;
  }

  /** 批量获取已解锁徽章（针对榜单快速查询） */
  getUnlockedBadges(clientDatabaseId: number): UserBadge[] {
    return this.getUserBadges(clientDatabaseId).filter((b) => b.unlocked);
  }
}
