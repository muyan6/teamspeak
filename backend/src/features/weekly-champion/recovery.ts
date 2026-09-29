import type { AppDatabase } from '../../db/database.js';

/** 在远端授组之前落盘，避免回收失败/进程重启后丢失已授予者。 */
export class ChampionRecovery {
  constructor(private db: AppDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS champion_pending_grants (
      server_key TEXT NOT NULL, server_group_id INTEGER NOT NULL, client_database_id INTEGER NOT NULL,
      PRIMARY KEY(server_key, server_group_id, client_database_id)
    )`);
  }

  record(serverKey: string, groupId: number, dbid: number): void {
    this.db.prepare('INSERT OR IGNORE INTO champion_pending_grants VALUES(?,?,?)').run(serverKey, groupId, dbid);
  }
  list(serverKey: string): Array<{ groupId: number; dbid: number }> {
    return this.db.prepare('SELECT server_group_id AS groupId,client_database_id AS dbid FROM champion_pending_grants WHERE server_key=?')
      .all(serverKey);
  }
  forget(serverKey: string, groupId: number, dbid: number): void {
    this.db.prepare('DELETE FROM champion_pending_grants WHERE server_key=? AND server_group_id=? AND client_database_id=?').run(serverKey, groupId, dbid);
  }
}
