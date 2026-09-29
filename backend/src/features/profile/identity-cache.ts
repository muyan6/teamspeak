import type { AppDatabase } from '../../db/database.js';
import type { ClientIdentityData } from '../../services/stats.js';

/** 成员目录不等于时长统计，避免缓存远端成员时伪造零秒在线记录。 */
export class IdentityCache {
  constructor(private db: AppDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS client_identities (
      server_key TEXT NOT NULL, client_database_id INTEGER NOT NULL,
      unique_identifier TEXT NOT NULL, nickname TEXT NOT NULL,
      created INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_key, client_database_id)
    ); CREATE INDEX IF NOT EXISTS idx_identity_uid ON client_identities(server_key, unique_identifier);`);
  }

  save(serverKey: string, identity: ClientIdentityData & { created?: number }): void {
    this.db.prepare(`INSERT INTO client_identities(server_key,client_database_id,unique_identifier,nickname,created,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(server_key,client_database_id) DO UPDATE SET
      unique_identifier=excluded.unique_identifier,nickname=excluded.nickname,
      created=CASE WHEN excluded.created>0 THEN excluded.created ELSE client_identities.created END,updated_at=excluded.updated_at`)
      .run(serverKey, identity.clientDatabaseId, identity.uniqueIdentifier, identity.nickname, identity.created ?? 0, Date.now());
  }

  getCreated(serverKey: string, dbid: number): number {
    return this.db.prepare('SELECT created FROM client_identities WHERE server_key=? AND client_database_id=?')
      .get<{ created: number }>(serverKey, dbid)?.created ?? 0;
  }
}
