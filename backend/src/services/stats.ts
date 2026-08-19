import type { AppDatabase } from '../db/database.js';
import type { OnlineClientData, ChannelData } from '../ts3/client.js';

export interface OnlineRecord {
  clientDatabaseId: number;
  uniqueIdentifier: string;
  nickname: string;
  serverGroupIds: number[];
  channelId: number;
  channelName: string;
  connectedTime: number;
}

export interface ProfileData {
  nickname: string;
  dbid: number;
  uid: string;
  total_time: {
    hours: number;
    minutes: number;
    days: number;
    first_seen: string;
    last_seen: string;
  };
  rank: {
    current: number | null;
    last_week: number | null;
    change: number | null;
    week_time: number;
  };
  streak: {
    current_streak: number;
    max_streak: number;
    last_online: string;
  };
  bond_friends: Array<{ name: string; hours: number; last_meet: number }>;
  frequent_channels: Array<{ name: string; minutes: number }>;
}

export interface ClientIdentityData {
  clientDatabaseId: number;
  uniqueIdentifier: string;
  nickname: string;
}

export class StatsService {
  private suspendedOnline = new Map<number, {
    uniqueIdentifier: string;
    nickname: string;
    channelId: number;
    channelName: string;
    connectedTime: number;
    lastSeen: number;
  }>();

  constructor(private db: AppDatabase, private serverKey = 'legacy') {}

  getServerKey(): string {
    return this.serverKey;
  }

  setServerKey(serverKey: string, migrateLegacy = false): void {
    if (!serverKey || serverKey === this.serverKey) return;
    if (migrateLegacy) {
      const tables = [
        'online_clients',
        'user_online_duration',
        'sessions',
        'online_samples',
        'channel_activity',
        'channel_daily_activity',
        'user_daily_activity',
        'user_channel_activity',
        'achievement_grants',
      ];
      const tx = this.db.transaction(() => {
        for (const table of tables) {
          this.db.prepare(`UPDATE ${table} SET server_key = ? WHERE server_key = 'legacy'`).run(serverKey);
        }
      });
      tx();
    }
    this.serverKey = serverKey;
    this.suspendedOnline.clear();
  }

  isBot(nickname: string): boolean {
    return nickname.trim().toLowerCase() === 'musicbot';
  }

  private weekStart(): number {
    const d = new Date();
    const day = d.getDay() === 0 ? 7 : d.getDay();
    const start = new Date(d);
    start.setDate(d.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    return Math.floor(start.getTime() / 1000);
  }

  private dayKey(now = Date.now()): string {
    const d = new Date(now);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  private monthStartKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }

  private weekStartKey(): string {
    const d = new Date();
    const day = d.getDay() === 0 ? 7 : d.getDay();
    const start = new Date(d);
    start.setDate(d.getDate() - day + 1);
    const mm = String(start.getMonth() + 1).padStart(2, '0');
    const dd = String(start.getDate()).padStart(2, '0');
    return `${start.getFullYear()}-${mm}-${dd}`;
  }

  recordSnapshot(clients: OnlineClientData[], channels: ChannelData[], now = Date.now()): void {
    const tx = this.db.transaction(() => {
      const prevRows = this.db
        .prepare('SELECT client_database_id, unique_identifier, nickname, channel_id, channel_name, connected_time, last_seen FROM online_clients WHERE server_key = ?')
        .all(this.serverKey) as Array<{
        client_database_id: number;
        unique_identifier: string;
        nickname: string;
        channel_id: number;
        channel_name: string;
        connected_time: number;
        last_seen: number;
      }>;
      const prevMap = new Map<number, { lastSeen: number; connectedTime: number }>();
      for (const r of prevRows) prevMap.set(r.client_database_id, {
        lastSeen: r.last_seen,
        connectedTime: Number(r.connected_time || 0),
      });

      const upsertStmt = this.db.prepare(`
        INSERT INTO online_clients (
          server_key, client_database_id, unique_identifier, nickname, servergroup_ids,
          channel_id, channel_name, connected_time, last_seen
        ) VALUES (@serverKey, @clientDatabaseId, @uniqueIdentifier, @nickname, @servergroupIds,
          @channelId, @channelName, @connectedTime, @now)
        ON CONFLICT(server_key, client_database_id) DO UPDATE SET
          nickname = excluded.nickname,
          servergroup_ids = excluded.servergroup_ids,
          channel_id = excluded.channel_id,
          channel_name = excluded.channel_name,
          connected_time = excluded.connected_time,
          last_seen = excluded.last_seen
      `);

      const durationUpsert = this.db.prepare(`
        INSERT INTO user_online_duration (
          server_key, client_database_id, unique_identifier, nickname, total_seconds,
          week_seconds, longest_session_seconds, last_updated
        ) VALUES (@serverKey, @clientDatabaseId, @uniqueIdentifier, @nickname, 0, 0, 0, @lastUpdated)
        ON CONFLICT(server_key, client_database_id) DO UPDATE SET
          nickname = excluded.nickname,
          unique_identifier = excluded.unique_identifier,
          last_updated = excluded.last_updated
      `);

      const addDurationStmt = this.db.prepare(`
        UPDATE user_online_duration
        SET total_seconds = total_seconds + ?, week_seconds = week_seconds + ?,
            longest_session_seconds = MAX(longest_session_seconds, ?),
            nickname = ?, unique_identifier = ?, last_updated = ?
        WHERE server_key = ? AND client_database_id = ?
      `);

      const openSessionStmt = this.db.prepare(`
        INSERT OR IGNORE INTO sessions (server_key, client_database_id, nickname, start_time, end_time)
        VALUES (?, ?, ?, ?, NULL)
      `);

      const closeSessionStmt = this.db.prepare(`
        UPDATE sessions SET end_time = ?, duration_seconds = ? - start_time
        WHERE server_key = ? AND client_database_id = ? AND end_time IS NULL
      `);

      const channelStmt = this.db.prepare(`
        INSERT INTO channel_activity (server_key, channel_id, channel_name, parent_id, total_member_minutes, last_updated)
        VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT(server_key, channel_id) DO UPDATE SET
          channel_name = excluded.channel_name,
          parent_id = excluded.parent_id,
          last_updated = excluded.last_updated
      `);
      const channelAddStmt = this.db.prepare(
        'UPDATE channel_activity SET total_member_minutes = total_member_minutes + ?, last_updated = ? WHERE server_key = ? AND channel_id = ?'
      );
      const channelDailyStmt = this.db.prepare(`
        INSERT INTO channel_daily_activity (server_key, channel_id, channel_name, day, member_seconds)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(server_key, channel_id, day) DO UPDATE SET
          channel_name = excluded.channel_name,
          member_seconds = member_seconds + excluded.member_seconds
      `);
      const userDailyStmt = this.db.prepare(`
        INSERT INTO user_daily_activity (server_key, client_database_id, nickname, day, active_seconds)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(server_key, client_database_id, day) DO UPDATE SET
          nickname = excluded.nickname,
          active_seconds = active_seconds + excluded.active_seconds
      `);
      const userChannelStmt = this.db.prepare(`
        INSERT INTO user_channel_activity (server_key, client_database_id, nickname, channel_id, channel_name, seconds)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(server_key, client_database_id, channel_id) DO UPDATE SET
          nickname = excluded.nickname,
          channel_name = excluded.channel_name,
          seconds = seconds + excluded.seconds
      `);

      const splitByDay = (startSec: number, endSec: number, add: (day: string, seconds: number) => void): void => {
        let cursor = Math.max(0, startSec);
        while (cursor < endSec) {
          const current = new Date(cursor * 1000);
          const nextDay = new Date(current);
          nextDay.setHours(24, 0, 0, 0);
          const boundary = Math.max(cursor + 1, Math.floor(nextDay.getTime() / 1000));
          const segmentEnd = Math.min(endSec, boundary);
          add(this.dayKey(cursor * 1000), segmentEnd - cursor);
          cursor = segmentEnd;
        }
      };
      const addUserDaily = (dbId: number, nickname: string, startSec: number, endSec: number): void => {
        splitByDay(startSec, endSec, (day, seconds) => userDailyStmt.run(this.serverKey, dbId, nickname, day, seconds));
      };
      const addChannelDaily = (cid: number, channelName: string, startSec: number, endSec: number): void => {
        splitByDay(startSec, endSec, (day, seconds) => channelDailyStmt.run(this.serverKey, cid, channelName, day, seconds));
      };

      const currentIds = new Set<number>();
      const nowSec = Math.floor(now / 1000);

      for (const c of clients) {
        const dbId = c.clientDatabaseId;
        currentIds.add(dbId);
        const prev = prevMap.get(dbId);
        const suspended = this.suspendedOnline.get(dbId);

        upsertStmt.run({
          serverKey: this.serverKey,
          clientDatabaseId: dbId,
          uniqueIdentifier: c.uniqueIdentifier,
          nickname: c.nickname,
          servergroupIds: c.serverGroupIds.join(','),
          channelId: c.channelId,
          channelName: c.channelName,
          connectedTime: c.connectedTime,
          now,
        });

        // 机器人（Musicbot）只保留实时在线，不累计任何时长/频道/会话统计
        if (this.isBot(c.nickname)) {
          this.suspendedOnline.delete(dbId);
          continue;
        }

        const connectedTimeSec = Math.floor(c.connectedTime);

        if (prev === undefined && suspended === undefined) {
          // 新上线：开启会话
          const sessionStart = connectedTimeSec > 0 ? connectedTimeSec : Math.floor(now / 1000);
          openSessionStmt.run(this.serverKey, dbId, c.nickname, sessionStart);
          durationUpsert.run({
            serverKey: this.serverKey,
            clientDatabaseId: dbId,
            uniqueIdentifier: c.uniqueIdentifier,
            nickname: c.nickname,
            lastUpdated: now,
          });
          // 首次采集：计入从连接时刻到现在的时长，避免新用户首段在线时间丢失
          if (connectedTimeSec > 0) {
            const initialDelta = Math.max(0, Math.floor(now / 1000) - connectedTimeSec);
            if (initialDelta > 0) {
              addDurationStmt.run(
                initialDelta,
                initialDelta,
                initialDelta,
                c.nickname,
                c.uniqueIdentifier,
                now,
                this.serverKey,
                dbId
              );
              addUserDaily(dbId, c.nickname, connectedTimeSec, nowSec);
            }
          }
        } else if (prev !== undefined) {
          // 持续在线：累计增量
          const connectedTimeSec = Math.floor(c.connectedTime);
          const sessionChanged = connectedTimeSec > 0 && prev.connectedTime > 0 && connectedTimeSec > prev.connectedTime;
          const deltaStartSec = sessionChanged ? connectedTimeSec : Math.floor(prev.lastSeen / 1000);
          const deltaSec = Math.max(0, nowSec - deltaStartSec);
          if (deltaSec > 0) {
            addDurationStmt.run(
              deltaSec,
              deltaSec,
              deltaSec,
              c.nickname,
              c.uniqueIdentifier,
              now,
              this.serverKey,
              dbId
            );
            addUserDaily(dbId, c.nickname, deltaStartSec, nowSec);
          }
          if (sessionChanged) {
            closeSessionStmt.run(Math.floor(prev.lastSeen / 1000), Math.floor(prev.lastSeen / 1000), this.serverKey, dbId);
            openSessionStmt.run(this.serverKey, dbId, c.nickname, connectedTimeSec);
          }
        } else {
          // 查询连接中断后恢复：只补算断线期间，避免重复累计已结算的历史时长。
          const connectedTimeSec = Math.floor(c.connectedTime);
          const sameConnection = connectedTimeSec <= 0 || suspended!.connectedTime <= 0 || connectedTimeSec === suspended!.connectedTime;
          const deltaStartSec = sameConnection ? Math.floor(suspended!.lastSeen / 1000) : connectedTimeSec;
          const deltaSec = Math.max(0, nowSec - deltaStartSec);
          openSessionStmt.run(this.serverKey, dbId, c.nickname, deltaStartSec);
          durationUpsert.run({
            serverKey: this.serverKey,
            clientDatabaseId: dbId,
            uniqueIdentifier: c.uniqueIdentifier,
            nickname: c.nickname,
            lastUpdated: now,
          });
          if (deltaSec > 0) {
            addDurationStmt.run(
              deltaSec,
              deltaSec,
              deltaSec,
              c.nickname,
              c.uniqueIdentifier,
              now,
              this.serverKey,
              dbId
            );
            addUserDaily(dbId, c.nickname, deltaStartSec, nowSec);
          }
          this.suspendedOnline.delete(dbId);
        }

        // 频道活跃累计（人·秒）+ 用户频道停留
        if (c.channelId > 0) {
          channelStmt.run(this.serverKey, c.channelId, c.channelName, null, now);
          const deltaSec = prev === undefined
            ? (suspended !== undefined
              ? Math.max(0, nowSec - (connectedTimeSec > 0 && suspended.connectedTime > 0 && connectedTimeSec !== suspended.connectedTime
                ? connectedTimeSec
                : Math.floor(suspended.lastSeen / 1000)))
              : (connectedTimeSec > 0 ? Math.max(0, nowSec - connectedTimeSec) : 0))
            : Math.max(0, nowSec - (connectedTimeSec > 0 && prev.connectedTime > 0 && connectedTimeSec > prev.connectedTime
              ? connectedTimeSec
              : Math.floor(prev.lastSeen / 1000)));
          if (deltaSec > 0) {
            channelAddStmt.run(deltaSec, now, this.serverKey, c.channelId);
            const startSec = prev === undefined
              ? (suspended !== undefined
                ? (connectedTimeSec > 0 && suspended.connectedTime > 0 && connectedTimeSec !== suspended.connectedTime
                  ? connectedTimeSec
                  : Math.floor(suspended.lastSeen / 1000))
                : connectedTimeSec)
              : (connectedTimeSec > 0 && prev.connectedTime > 0 && connectedTimeSec > prev.connectedTime
                ? connectedTimeSec
                : Math.floor(prev.lastSeen / 1000));
            addChannelDaily(c.channelId, c.channelName, startSec, nowSec);
            userChannelStmt.run(this.serverKey, dbId, c.nickname, c.channelId, c.channelName, deltaSec);
          }
        }
      }

      // 处理离线的旧用户：结算剩余时长并关闭会话
      const removeStmt = this.db.prepare('DELETE FROM online_clients WHERE server_key = ? AND client_database_id = ?');
      for (const r of prevRows) {
        if (!currentIds.has(r.client_database_id)) {
          if (!this.isBot(r.nickname)) {
            const deltaSec = Math.max(0, Math.floor((now - r.last_seen) / 1000));
            if (deltaSec > 0) {
              addDurationStmt.run(deltaSec, deltaSec, deltaSec, r.nickname, r.unique_identifier, now, this.serverKey, r.client_database_id);
              addUserDaily(r.client_database_id, r.nickname, Math.floor(r.last_seen / 1000), nowSec);
              closeSessionStmt.run(nowSec, nowSec, this.serverKey, r.client_database_id);
            }
          }
          removeStmt.run(this.serverKey, r.client_database_id);
        }
      }

      // 更新频道表以保留历史频道名
      for (const ch of channels) {
        channelStmt.run(this.serverKey, ch.cid, ch.name, ch.parentId, now);
      }

      for (const dbId of this.suspendedOnline.keys()) {
        if (!currentIds.has(dbId)) this.suspendedOnline.delete(dbId);
      }
    });
    tx();
  }

  /** 清理连接中断时的实时状态，并保留快照供恢复后补算断线期间。 */
  clearOnlineState(): void {
    const tx = this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT client_database_id, unique_identifier, nickname, channel_id, channel_name, connected_time, last_seen FROM online_clients WHERE server_key = ?')
        .all(this.serverKey) as Array<{
          client_database_id: number;
          unique_identifier: string;
          nickname: string;
          channel_id: number;
          channel_name: string;
          connected_time: number;
          last_seen: number;
        }>;
      const closeSessionStmt = this.db.prepare(`
        UPDATE sessions SET end_time = ?, duration_seconds = ? - start_time
        WHERE server_key = ? AND client_database_id = ? AND end_time IS NULL
      `);
      const removeStmt = this.db.prepare('DELETE FROM online_clients WHERE server_key = ? AND client_database_id = ?');
      for (const row of rows) {
        const endSec = Math.floor(row.last_seen / 1000);
        closeSessionStmt.run(endSec, endSec, this.serverKey, row.client_database_id);
        this.suspendedOnline.set(row.client_database_id, {
          uniqueIdentifier: row.unique_identifier,
          nickname: row.nickname,
          channelId: Number(row.channel_id || 0),
          channelName: row.channel_name || '',
          connectedTime: Number(row.connected_time || 0),
          lastSeen: row.last_seen,
        });
        removeStmt.run(this.serverKey, row.client_database_id);
      }
    });
    tx();
  }

  sampleOnline(count: number, now = Date.now()): void {
    this.db
      .prepare('INSERT INTO online_samples (server_key, sample_time, online_count) VALUES (?, ?, ?)')
      .run(this.serverKey, Math.floor(now / 1000), count);
  }

  getOnlineHistory(hours = 24): Array<{ time: number; count: number }> {
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    return this.db
      .prepare(
        'SELECT sample_time as time, online_count as count FROM online_samples WHERE server_key = ? AND sample_time >= ? ORDER BY sample_time ASC'
      )
      .all(this.serverKey, since) as Array<{ time: number; count: number }>;
  }

  getTopUsers(range: 'week' | 'month' | 'all', limit = 10): Array<{ nickname: string; seconds: number }> {
    if (range === 'week' || range === 'month') {
      const startKey = range === 'week' ? this.weekStartKey() : this.monthStartKey();
      return this.db
        .prepare(
          `SELECT nickname, SUM(active_seconds) as seconds
           FROM user_daily_activity
           WHERE server_key = ? AND day >= ? AND lower(nickname) != 'musicbot'
           GROUP BY nickname ORDER BY seconds DESC LIMIT ?`
        )
        .all(this.serverKey, startKey, limit) as Array<{ nickname: string; seconds: number }>;
    }
    return this.db
      .prepare(
        `SELECT nickname, SUM(total_seconds) as seconds
         FROM user_online_duration
         WHERE server_key = ? AND lower(nickname) != 'musicbot'
         GROUP BY nickname ORDER BY seconds DESC LIMIT ?`
      )
      .all(this.serverKey, limit) as Array<{ nickname: string; seconds: number }>;
  }

  getLongestSessions(limit = 5): Array<{ nickname: string; seconds: number }> {
    return this.db
      .prepare(
        'SELECT nickname, longest_session_seconds as seconds FROM user_online_duration WHERE server_key = ? ORDER BY longest_session_seconds DESC LIMIT ?'
      )
      .all(this.serverKey, limit) as Array<{ nickname: string; seconds: number }>;
  }

  getUserStats(nickname: string, uid?: string): ProfileData | null {
    const identity = this.db
      .prepare(
        uid
          ? 'SELECT client_database_id as dbid, nickname, unique_identifier as uid FROM user_online_duration WHERE server_key = ? AND unique_identifier = ? ORDER BY total_seconds DESC LIMIT 1'
          : 'SELECT client_database_id as dbid, nickname, unique_identifier as uid FROM user_online_duration WHERE server_key = ? AND nickname = ? ORDER BY total_seconds DESC LIMIT 1'
      )
      .get(this.serverKey, uid || nickname) as { dbid: number; nickname: string; uid: string } | undefined;
    if (!identity) return null;
    return this.getUserStatsByIdentity({
      clientDatabaseId: identity.dbid,
      uniqueIdentifier: identity.uid,
      nickname: identity.nickname,
    });
  }

  getUserStatsByIdentity(identity: ClientIdentityData): ProfileData {
    const dbid = identity.clientDatabaseId;
    const nickname = identity.nickname;
    const uid = identity.uniqueIdentifier;

    const totalRow = this.db
      .prepare(
        'SELECT COALESCE(total_seconds,0) as total FROM user_online_duration WHERE server_key = ? AND client_database_id = ?'
      )
      .get(this.serverKey, dbid) as { total: number } | undefined;

    const daysRows = this.db
      .prepare('SELECT day FROM user_daily_activity WHERE server_key = ? AND client_database_id = ?')
      .all(this.serverKey, dbid) as Array<{ day: string }>;
    const daySet = daysRows.map((r) => r.day);
    const sortedDays = [...new Set(daySet)].sort();

    const totalSeconds = totalRow?.total ?? 0;
    const totalHours = totalSeconds / 3600;

    const firstSeen = sortedDays.length ? sortedDays[0] : '';
    const lastSeen = sortedDays.length ? sortedDays[sortedDays.length - 1] : '';

    // 排名（本周 vs 上周）
    const weekTop = this.getTopUsers('week', 500);
    const lastWeekTop = this.getTopUsersByRange(this.prevWeekStartKey(), this.weekStartKey(), 500);
    const weekIdx = weekTop.findIndex((u) => u.nickname === nickname);
    const lastWeekIdx = lastWeekTop.findIndex((u) => u.nickname === nickname);
    const weekTimeRow = this.db
      .prepare('SELECT COALESCE(SUM(active_seconds),0) as s FROM user_daily_activity WHERE server_key = ? AND client_database_id = ? AND day >= ?')
      .get(this.serverKey, dbid, this.weekStartKey()) as { s: number };

    const current = weekIdx >= 0 ? weekIdx + 1 : null;
    const lastWeek = lastWeekIdx >= 0 ? lastWeekIdx + 1 : null;
    const streak = this.computeStreak(daySet);

    return {
      nickname,
      dbid,
      uid,
      total_time: {
        hours: Math.floor(totalHours),
        minutes: Math.round(totalSeconds / 60),
        days: new Set(daySet).size,
        first_seen: firstSeen,
        last_seen: lastSeen,
      },
      rank: {
        current,
        last_week: lastWeek,
        change: current !== null && lastWeek !== null ? lastWeek - current : null,
        week_time: weekTimeRow.s,
      },
      streak: {
        current_streak: streak.current,
        max_streak: streak.max,
        last_online: lastSeen,
      },
      bond_friends: this.getBondFriends(dbid),
      frequent_channels: this.getFrequentChannels(dbid),
    };
  }

  syncClientIdentities(clients: ClientIdentityData[]): number {
    const tx = this.db.transaction(() => {
      let updated = 0;
      const statements = [
        this.db.prepare(
          'UPDATE user_online_duration SET nickname = ?, unique_identifier = ? WHERE server_key = ? AND client_database_id = ?'
        ),
        this.db.prepare(
          'UPDATE online_clients SET nickname = ?, unique_identifier = ? WHERE server_key = ? AND client_database_id = ?'
        ),
        this.db.prepare(
          'UPDATE user_daily_activity SET nickname = ? WHERE server_key = ? AND client_database_id = ?'
        ),
        this.db.prepare(
          'UPDATE user_channel_activity SET nickname = ? WHERE server_key = ? AND client_database_id = ?'
        ),
        this.db.prepare(
          'UPDATE sessions SET nickname = ? WHERE server_key = ? AND client_database_id = ?'
        ),
      ];

      for (const client of clients) {
        if (!client.clientDatabaseId || !client.uniqueIdentifier) continue;
        updated += statements[0].run(client.nickname, client.uniqueIdentifier, this.serverKey, client.clientDatabaseId).changes;
        updated += statements[1].run(client.nickname, client.uniqueIdentifier, this.serverKey, client.clientDatabaseId).changes;
        updated += statements[2].run(client.nickname, this.serverKey, client.clientDatabaseId).changes;
        updated += statements[3].run(client.nickname, this.serverKey, client.clientDatabaseId).changes;
        updated += statements[4].run(client.nickname, this.serverKey, client.clientDatabaseId).changes;
      }
      return updated;
    });
    return tx();
  }

  private prevWeekStartKey(): string {
    const d = new Date();
    const day = d.getDay() === 0 ? 7 : d.getDay();
    const thisMonday = new Date(d);
    thisMonday.setDate(d.getDate() - day + 1);
    thisMonday.setHours(0, 0, 0, 0);
    thisMonday.setDate(thisMonday.getDate() - 7);
    const mm = String(thisMonday.getMonth() + 1).padStart(2, '0');
    const dd = String(thisMonday.getDate()).padStart(2, '0');
    return `${thisMonday.getFullYear()}-${mm}-${dd}`;
  }

  private getTopUsersByRange(
    startKey: string,
    endKey: string,
    limit = 500
  ): Array<{ nickname: string; seconds: number }> {
    return this.db
      .prepare(
        `SELECT nickname, SUM(active_seconds) as seconds
         FROM user_daily_activity
         WHERE server_key = ? AND day >= ? AND day < ? AND lower(nickname) != 'musicbot'
         GROUP BY nickname ORDER BY seconds DESC LIMIT ?`
      )
      .all(this.serverKey, startKey, endKey, limit) as Array<{ nickname: string; seconds: number }>;
  }

  private computeStreak(daySet: string[]): { current: number; max: number } {
    if (daySet.length === 0) return { current: 0, max: 0 };
    const set = new Set(daySet);
    const today = this.dayKey();

    let current = 0;
    const cursor = new Date();
    if (!set.has(today)) cursor.setDate(cursor.getDate() - 1);
    while (set.has(this.dayKey(cursor.getTime()))) {
      current++;
      cursor.setDate(cursor.getDate() - 1);
    }

    const sorted = [...set].sort();
    let max = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(`${sorted[i - 1]}T00:00:00`).getTime();
      const cur = new Date(`${sorted[i]}T00:00:00`).getTime();
      if (Math.round((cur - prev) / 86400000) === 1) {
        run++;
        max = Math.max(max, run);
      } else {
        run = 1;
      }
    }
    return { current, max };
  }

  suggestNicknames(q: string, limit = 8): Array<{ nickname: string; uid: string }> {
    return (
      this.db
        .prepare(
          `SELECT nickname, unique_identifier as uid FROM user_online_duration
           WHERE server_key = ? AND nickname LIKE ? AND lower(nickname) != 'musicbot' AND nickname != ''
           ORDER BY nickname, total_seconds DESC LIMIT ?`
        )
        .all(this.serverKey, `%${q}%`, limit) as Array<{ nickname: string; uid: string }>
    );
  }

  private getFrequentChannels(clientDatabaseId: number): Array<{ name: string; minutes: number }> {
    const rows = this.db
      .prepare(
        'SELECT channel_name as name, SUM(seconds) as seconds FROM user_channel_activity WHERE server_key = ? AND client_database_id = ? GROUP BY channel_id, channel_name ORDER BY seconds DESC LIMIT 10'
      )
      .all(this.serverKey, clientDatabaseId) as Array<{ name: string; seconds: number }>;
    return rows.map((r) => ({ name: r.name, minutes: Math.round(r.seconds / 60) }));
  }

  private getBondFriends(clientDatabaseId: number): Array<{ name: string; hours: number; last_meet: number }> {
    const selfDbids = [clientDatabaseId];

    const now = Math.floor(Date.now() / 1000);
    const placeholders = selfDbids.map(() => '?').join(',');

    const selfIntervals = (
      this.db
        .prepare(`SELECT start_time, end_time FROM sessions WHERE server_key = ? AND client_database_id IN (${placeholders})`)
        .all(this.serverKey, ...selfDbids) as Array<{ start_time: number; end_time: number | null }>
    ).map((r) => ({ s: r.start_time, e: r.end_time ?? now }));

    const otherRows = this.db
      .prepare(
        `SELECT nickname, start_time, end_time FROM sessions
         WHERE server_key = ? AND client_database_id NOT IN (${placeholders}) AND lower(nickname) != 'musicbot'`
      )
      .all(this.serverKey, ...selfDbids) as Array<{ nickname: string; start_time: number; end_time: number | null }>;

    const map = new Map<string, { seconds: number; lastMeet: number }>();
    for (const o of otherRows) {
      const oe = o.end_time ?? now;
      let overlap = 0;
      let lastMeet = 0;
      for (const si of selfIntervals) {
        const start = Math.max(si.s, o.start_time);
        const end = Math.min(si.e, oe);
        if (end > start) {
          overlap += end - start;
          lastMeet = Math.max(lastMeet, end);
        }
      }
      if (overlap <= 0) continue;
      const cur = map.get(o.nickname) ?? { seconds: 0, lastMeet: 0 };
      cur.seconds += overlap;
      cur.lastMeet = Math.max(cur.lastMeet, lastMeet);
      map.set(o.nickname, cur);
    }

    return [...map.entries()]
      .map(([name, v]) => ({ name, hours: Math.round(v.seconds / 3600), last_meet: v.lastMeet }))
      .filter((x) => x.hours > 0)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10);
  }

  getTopChannels(range: 'week' | 'month' | 'all', limit = 10): Array<{ channelName: string; memberSeconds: number }> {
    if (range === 'all') {
      return this.db
        .prepare(
          'SELECT channel_name as channelName, total_member_minutes as memberSeconds FROM channel_activity WHERE server_key = ? AND total_member_minutes > 0 ORDER BY total_member_minutes DESC LIMIT ?'
        )
        .all(this.serverKey, limit) as Array<{ channelName: string; memberSeconds: number }>;
    }
    const startKey = range === 'week' ? this.weekStartKey() : this.monthStartKey();
    return this.db
      .prepare(
        `SELECT channel_name as channelName, SUM(member_seconds) as memberSeconds
         FROM channel_daily_activity WHERE server_key = ? AND day >= ?
         GROUP BY channel_id HAVING memberSeconds > 0
         ORDER BY memberSeconds DESC LIMIT ?`
      )
      .all(this.serverKey, startKey, limit) as Array<{ channelName: string; memberSeconds: number }>;
  }

  getCurrentOnline(): Array<{
    clientDatabaseId: number;
    uniqueIdentifier: string;
    nickname: string;
    serverGroupIds: string;
    channelName: string;
    connectedTime: number;
  }> {
    return this.db
      .prepare(
        'SELECT client_database_id as clientDatabaseId, unique_identifier as uniqueIdentifier, nickname, servergroup_ids as serverGroupIds, channel_name as channelName, connected_time as connectedTime FROM online_clients WHERE server_key = ?'
      )
      .all(this.serverKey) as Array<{
      clientDatabaseId: number;
      uniqueIdentifier: string;
      nickname: string;
      serverGroupIds: string;
      channelName: string;
      connectedTime: number;
    }>;
  }

  getTotalUserCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as cnt FROM user_online_duration WHERE server_key = ?')
      .get(this.serverKey) as { cnt: number };
    return row.cnt;
  }

  getDailyTrends(days: number): { labels: string[]; data: number[] } {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const startSec = Math.floor(start.getTime() / 1000);

    const rows = this.db
      .prepare(
        'SELECT sample_time as time, online_count as count FROM online_samples WHERE server_key = ? AND sample_time >= ? ORDER BY sample_time ASC'
      )
      .all(this.serverKey, startSec) as Array<{ time: number; count: number }>;

    const byDay = new Map<string, number>();
    for (const r of rows) {
      const d = new Date(r.time * 1000);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      byDay.set(key, Math.max(byDay.get(key) ?? 0, r.count));
    }

    const labels: string[] = [];
    const data: number[] = [];
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      data.push(byDay.get(key) ?? 0);
      labels.push(days <= 7 ? weekdays[d.getDay()] : `${d.getDate()}日`);
    }
    return { labels, data };
  }

  getPeakAndAvg(hours = 24): { peak: number; avg: number } {
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    const row = this.db
      .prepare(
        'SELECT COALESCE(MAX(online_count),0) as peak, COALESCE(AVG(online_count),0) as avg FROM online_samples WHERE server_key = ? AND sample_time >= ?'
      )
      .get(this.serverKey, since) as { peak: number; avg: number };
    return { peak: row.peak, avg: Math.round(row.avg) };
  }
}
