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

export class AchievementService {
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
    const results: Array<{ nickname: string; title: string; granted: boolean }> = [];
    const levels = this.listLevels().filter((l) => l.enabled === 1);
    if (levels.length === 0) return results;
    const serverKey = this.stats.getServerKey();

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
          results.push({ nickname: user.nickname, title: level.title, granted: false });
          continue;
        }

        const ok = await this.ts3.addClientToServerGroup(level.serverGroupId, user.clientDatabaseId);
        if (ok) {
          this.db
            .prepare(
              `INSERT OR IGNORE INTO achievement_grants
                (server_key, client_database_id, level_id, granted_at)
               VALUES (?, ?, ?, ?)`
            )
            .run(serverKey, user.clientDatabaseId, level.id, Date.now());
        }
        results.push({ nickname: user.nickname, title: level.title, granted: ok });
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
}
