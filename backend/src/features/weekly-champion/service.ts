import type { AppDatabase } from '../../db/database.js';
import { Ts3ClientWrapper } from '../../ts3/client.js';
import { StatsService } from '../../services/stats.js';

const MIN_CHECK_INTERVAL_HOURS = 1;
const MAX_CHECK_INTERVAL_HOURS = 168;
const DEFAULT_CHECK_INTERVAL_HOURS = 24;

export interface ChampionConfig {
  id: number;
  enabled: number;
  serverGroupId: number | null;
  checkIntervalHours: number;
  lastCheckTime: number | null;
  lastWinnerClientDbId: number | null;
  lastWinnerNickname: string | null;
}

export class WeeklyChampionService {
  private checkInFlight: Promise<{ nickname: string; seconds: number; granted: boolean } | null> | null = null;

  constructor(
    private db: AppDatabase,
    private ts3: Ts3ClientWrapper,
    private stats: StatsService
  ) {}

  private defaults(): ChampionConfig {
    return {
      id: 1,
      enabled: 0,
      serverGroupId: null,
      checkIntervalHours: DEFAULT_CHECK_INTERVAL_HOURS,
      lastCheckTime: null,
      lastWinnerClientDbId: null,
      lastWinnerNickname: null,
    };
  }

  private claimLegacyConfig(serverKey: string): void {
    if (serverKey === 'legacy') return;
    const existing = this.db.prepare('SELECT 1 FROM champion_config WHERE server_key = ?').get(serverKey);
    if (existing) return;
    const legacy = this.db.prepare('SELECT 1 FROM champion_config WHERE server_key = ?').get('legacy');
    if (!legacy) return;
    this.db.prepare('UPDATE champion_config SET server_key = ? WHERE server_key = ?').run(serverKey, 'legacy');
  }

  private getConfigForServer(serverKey: string): ChampionConfig {
    this.claimLegacyConfig(serverKey);
    const row = this.db.prepare(
      `SELECT
         enabled,
         server_group_id AS serverGroupId,
         check_interval_hours AS checkIntervalHours,
         last_check_time AS lastCheckTime,
         last_winner_client_db_id AS lastWinnerClientDbId,
         last_winner_nickname AS lastWinnerNickname
       FROM champion_config
       WHERE server_key = ?`
    ).get(serverKey) as
      | ChampionConfig
      | undefined;
    if (!row) return this.defaults();
    return {
      id: 1,
      enabled: row.enabled,
      serverGroupId: row.serverGroupId,
      checkIntervalHours: this.isValidCheckIntervalHours(row.checkIntervalHours)
        ? row.checkIntervalHours
        : DEFAULT_CHECK_INTERVAL_HOURS,
      lastCheckTime: row.lastCheckTime,
      lastWinnerClientDbId: row.lastWinnerClientDbId,
      lastWinnerNickname: row.lastWinnerNickname,
    };
  }

  getConfig(): ChampionConfig {
    return this.getConfigForServer(this.stats.getServerKey());
  }

  saveConfig(data: {
    enabled: number;
    serverGroupId: number | null;
    checkIntervalHours: number;
  }): ChampionConfig {
    if (!this.isValidCheckIntervalHours(data.checkIntervalHours)) {
      throw new Error(`周冠军检查周期需为 ${MIN_CHECK_INTERVAL_HOURS} 到 ${MAX_CHECK_INTERVAL_HOURS} 小时的整数`);
    }
    const serverKey = this.stats.getServerKey();
    const cfg = this.getConfigForServer(serverKey);
    this.db
      .prepare(
        `INSERT INTO champion_config (server_key, enabled, server_group_id, check_interval_hours, last_check_time, last_winner_client_db_id, last_winner_nickname, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_key) DO UPDATE SET
           enabled = excluded.enabled,
           server_group_id = excluded.server_group_id,
           check_interval_hours = excluded.check_interval_hours,
           updated_at = excluded.updated_at`
      )
      .run(
        serverKey,
        data.enabled,
        data.serverGroupId,
        data.checkIntervalHours,
        cfg.lastCheckTime,
        cfg.lastWinnerClientDbId,
        cfg.lastWinnerNickname,
        Date.now()
      );
    return this.getConfigForServer(serverKey);
  }

  private isValidCheckIntervalHours(value: number): boolean {
    return Number.isInteger(value)
      && value >= MIN_CHECK_INTERVAL_HOURS
      && value <= MAX_CHECK_INTERVAL_HOURS;
  }

  /** 检测本周活跃榜第一名并授予奖励 */
  async check(): Promise<{ nickname: string; seconds: number; granted: boolean } | null> {
    if (!this.checkInFlight) {
      this.checkInFlight = this.checkInternal().finally(() => {
        this.checkInFlight = null;
      });
    }
    return this.checkInFlight;
  }

  private async checkInternal(): Promise<{ nickname: string; seconds: number; granted: boolean } | null> {
    const serverKey = this.stats.getServerKey();
    const cfg = this.getConfigForServer(serverKey);
    if (!cfg.enabled || !cfg.serverGroupId) return null;

    const top = this.stats.getTopUsers('week', 1)[0];
    if (!top) return null;

    const clientDbId = top.clientDatabaseId;

    let granted = false;
    const alreadyWinner = cfg.lastWinnerClientDbId === clientDbId;
    if (!alreadyWinner) {
      granted = await this.ts3.addClientToServerGroup(cfg.serverGroupId, clientDbId);
      if (!granted) {
        this.db.prepare('UPDATE champion_config SET last_check_time = ? WHERE server_key = ?').run(Date.now(), serverKey);
        return { nickname: top.nickname, seconds: top.seconds, granted: false };
      }

      // 先确认新冠军已获得权限，再移除旧冠军；移除失败时保留旧状态，以便下一轮重试。
      if (cfg.lastWinnerClientDbId) {
        const removed = await this.ts3.removeClientFromServerGroup(cfg.serverGroupId, cfg.lastWinnerClientDbId);
        if (!removed) {
          console.warn(`[champion] 移除旧周冠军权限未成功，将在下一轮重试: dbid=${cfg.lastWinnerClientDbId}`);
          this.db.prepare('UPDATE champion_config SET last_check_time = ? WHERE server_key = ?').run(Date.now(), serverKey);
          return { nickname: top.nickname, seconds: top.seconds, granted: true };
        }
      }
    }

    this.db
      .prepare(
        `UPDATE champion_config
         SET last_check_time = ?, last_winner_client_db_id = ?, last_winner_nickname = ?
         WHERE server_key = ?`
      )
      .run(Date.now(), clientDbId, top.nickname, serverKey);

    if (typeof this.stats.recordChampionWinner === 'function') {
      const weekStart = typeof this.stats.weekStartKey === 'function' ? this.stats.weekStartKey() : undefined;
      this.stats.recordChampionWinner(clientDbId, top.nickname, weekStart);
    }

    return { nickname: top.nickname, seconds: top.seconds, granted };
  }

  /** 周冠军荣誉展示 */
  getCurrentChampion(): { nickname: string; seconds: number } | null {
    const top = this.stats.getTopUsers('week', 1)[0];
    return top ? { nickname: top.nickname, seconds: top.seconds } : null;
  }
}
