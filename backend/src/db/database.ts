import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS online_clients (
  server_key TEXT NOT NULL DEFAULT 'legacy',
  client_database_id INTEGER NOT NULL,
  unique_identifier TEXT NOT NULL,
  nickname TEXT NOT NULL,
  servergroup_ids TEXT,
  channel_id INTEGER,
  channel_name TEXT,
  connected_time INTEGER,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (server_key, client_database_id)
);

CREATE TABLE IF NOT EXISTS user_online_duration (
  server_key TEXT NOT NULL DEFAULT 'legacy',
  client_database_id INTEGER NOT NULL,
  unique_identifier TEXT NOT NULL,
  nickname TEXT NOT NULL,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  week_seconds INTEGER NOT NULL DEFAULT 0,
  longest_session_seconds INTEGER NOT NULL DEFAULT 0,
  last_updated INTEGER NOT NULL,
  PRIMARY KEY (server_key, client_database_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_key TEXT NOT NULL DEFAULT 'legacy',
  client_database_id INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration_seconds INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_cdbid ON sessions(client_database_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_time);

CREATE TABLE IF NOT EXISTS online_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_key TEXT NOT NULL DEFAULT 'legacy',
  sample_time INTEGER NOT NULL,
  online_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_time ON online_samples(sample_time);

CREATE TABLE IF NOT EXISTS channel_activity (
  server_key TEXT NOT NULL DEFAULT 'legacy',
  channel_id INTEGER NOT NULL,
  channel_name TEXT NOT NULL,
  parent_id INTEGER,
  -- 注意：字段名虽为 minutes，实际存储的是「秒」（历史遗留命名，勿改）
  total_member_minutes INTEGER NOT NULL DEFAULT 0,
  last_updated INTEGER NOT NULL,
  PRIMARY KEY (server_key, channel_id)
);

CREATE TABLE IF NOT EXISTS channel_daily_activity (
  server_key TEXT NOT NULL DEFAULT 'legacy',
  channel_id INTEGER NOT NULL,
  channel_name TEXT NOT NULL,
  day TEXT NOT NULL,
  member_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_key, channel_id, day)
);

CREATE TABLE IF NOT EXISTS user_daily_activity (
  server_key TEXT NOT NULL DEFAULT 'legacy',
  client_database_id INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  day TEXT NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_key, client_database_id, day)
);

CREATE TABLE IF NOT EXISTS user_channel_activity (
  server_key TEXT NOT NULL DEFAULT 'legacy',
  client_database_id INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  channel_id INTEGER NOT NULL,
  channel_name TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_key, client_database_id, channel_id)
);

CREATE TABLE IF NOT EXISTS elastic_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_prefix TEXT NOT NULL,
  create_threshold INTEGER NOT NULL DEFAULT 2,
  delete_threshold INTEGER NOT NULL DEFAULT 0,
  password TEXT,
  channel_group_id INTEGER,
  base_channel_id INTEGER,
  max_channels INTEGER NOT NULL DEFAULT 8,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS elastic_managed_channels (
  group_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, channel_id),
  FOREIGN KEY (group_id) REFERENCES elastic_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS achievement_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hours INTEGER NOT NULL,
  server_group_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS achievement_grants (
  server_key TEXT NOT NULL DEFAULT 'legacy',
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_database_id INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  granted_at INTEGER NOT NULL,
  UNIQUE(server_key, client_database_id, level_id)
);

CREATE TABLE IF NOT EXISTS champion_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  server_group_id INTEGER,
  check_interval_hours INTEGER NOT NULL DEFAULT 24,
  last_check_time INTEGER,
  last_winner_client_db_id INTEGER,
  last_winner_nickname TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS guestbook_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS donation_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  contact TEXT,
  expires_at INTEGER,
  channel_id INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export type SqlValue = string | number | bigint | null | Uint8Array;

class CompatStatement {
  private stmt: ReturnType<DatabaseSync['prepare']>;

  constructor(stmt: ReturnType<DatabaseSync['prepare']>) {
    this.stmt = stmt;
    this.stmt.setAllowBareNamedParameters(true);
  }

  run(...params: Array<Record<string, unknown> | SqlValue>): { changes: number; lastInsertRowid: number } {
    const r = this.stmt.run(...(params as never[]));
    return {
      changes: Number(r.changes),
      lastInsertRowid: Number(r.lastInsertRowid),
    };
  }

  get<T = Record<string, unknown>>(...params: Array<Record<string, unknown> | SqlValue>): T | undefined {
    return this.stmt.get(...(params as never[])) as T | undefined;
  }

  all<T = Record<string, unknown>>(...params: Array<Record<string, unknown> | SqlValue>): T[] {
    return this.stmt.all(...(params as never[])) as T[];
  }
}

export class AppDatabase {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  prepare(sql: string): CompatStatement {
    return new CompatStatement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): () => T {
    return (): T => {
      this.db.exec('BEGIN');
      try {
        const result = fn();
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    };
  }
}

export function openDatabase(dbPath: string): AppDatabase {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new AppDatabase(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrateStatsSchema(db);
  return db;
}

function tableExists(db: AppDatabase, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function recoverInterruptedStatsRebuilds(
  db: AppDatabase,
  rebuilds: Array<{ table: string }>
): void {
  for (const { table } of rebuilds) {
    const oldTable = `${table}__old`;
    const newTable = `${table}__new`;
    const hasOldTable = tableExists(db, oldTable);
    const hasNewTable = tableExists(db, newTable);
    if (!hasOldTable && !hasNewTable) continue;

    // __old 始终是完整的迁移前数据；只有它不存在时才使用已复制完成的 __new。
    const source = hasOldTable ? oldTable : newTable;
    const stale = hasOldTable ? newTable : oldTable;
    db.transaction(() => {
      if (tableExists(db, table)) db.exec(`DROP TABLE ${table}`);
      db.exec(`ALTER TABLE ${source} RENAME TO ${table}`);
      if (tableExists(db, stale)) db.exec(`DROP TABLE ${stale}`);
    })();
  }
}

export function migrateStatsSchema(db: AppDatabase): void {
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
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'server_key')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN server_key TEXT NOT NULL DEFAULT 'legacy'`);
    }
  }

  const rebuilds: Array<{ table: string; columns: string; create: string; primaryKey: string[] }> = [
    {
      table: 'online_clients',
      columns: 'server_key, client_database_id, unique_identifier, nickname, servergroup_ids, channel_id, channel_name, connected_time, last_seen',
      primaryKey: ['server_key', 'client_database_id'],
      create: `CREATE TABLE online_clients__new (
        server_key TEXT NOT NULL DEFAULT 'legacy',
        client_database_id INTEGER NOT NULL,
        unique_identifier TEXT NOT NULL,
        nickname TEXT NOT NULL,
        servergroup_ids TEXT,
        channel_id INTEGER,
        channel_name TEXT,
        connected_time INTEGER,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (server_key, client_database_id)
      )`,
    },
    {
      table: 'user_online_duration',
      columns: 'server_key, client_database_id, unique_identifier, nickname, total_seconds, week_seconds, longest_session_seconds, last_updated',
      primaryKey: ['server_key', 'client_database_id'],
      create: `CREATE TABLE user_online_duration__new (
        server_key TEXT NOT NULL DEFAULT 'legacy',
        client_database_id INTEGER NOT NULL,
        unique_identifier TEXT NOT NULL,
        nickname TEXT NOT NULL,
        total_seconds INTEGER NOT NULL DEFAULT 0,
        week_seconds INTEGER NOT NULL DEFAULT 0,
        longest_session_seconds INTEGER NOT NULL DEFAULT 0,
        last_updated INTEGER NOT NULL,
        PRIMARY KEY (server_key, client_database_id)
      )`,
    },
    {
      table: 'channel_activity',
      columns: 'server_key, channel_id, channel_name, parent_id, total_member_minutes, last_updated',
      primaryKey: ['server_key', 'channel_id'],
      create: `CREATE TABLE channel_activity__new (
        server_key TEXT NOT NULL DEFAULT 'legacy',
        channel_id INTEGER NOT NULL,
        channel_name TEXT NOT NULL,
        parent_id INTEGER,
        total_member_minutes INTEGER NOT NULL DEFAULT 0,
        last_updated INTEGER NOT NULL,
        PRIMARY KEY (server_key, channel_id)
      )`,
    },
    {
      table: 'channel_daily_activity',
      columns: 'server_key, channel_id, channel_name, day, member_seconds',
      primaryKey: ['server_key', 'channel_id', 'day'],
      create: `CREATE TABLE channel_daily_activity__new (
        server_key TEXT NOT NULL DEFAULT 'legacy',
        channel_id INTEGER NOT NULL,
        channel_name TEXT NOT NULL,
        day TEXT NOT NULL,
        member_seconds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (server_key, channel_id, day)
      )`,
    },
    {
      table: 'user_daily_activity',
      columns: 'server_key, client_database_id, nickname, day, active_seconds',
      primaryKey: ['server_key', 'client_database_id', 'day'],
      create: `CREATE TABLE user_daily_activity__new (
        server_key TEXT NOT NULL DEFAULT 'legacy',
        client_database_id INTEGER NOT NULL,
        nickname TEXT NOT NULL,
        day TEXT NOT NULL,
        active_seconds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (server_key, client_database_id, day)
      )`,
    },
    {
      table: 'user_channel_activity',
      columns: 'server_key, client_database_id, nickname, channel_id, channel_name, seconds',
      primaryKey: ['server_key', 'client_database_id', 'channel_id'],
      create: `CREATE TABLE user_channel_activity__new (
        server_key TEXT NOT NULL DEFAULT 'legacy',
        client_database_id INTEGER NOT NULL,
        nickname TEXT NOT NULL,
        channel_id INTEGER NOT NULL,
        channel_name TEXT NOT NULL,
        seconds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (server_key, client_database_id, channel_id)
      )`,
    },
  ];

  recoverInterruptedStatsRebuilds(db, rebuilds);
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'server_key')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN server_key TEXT NOT NULL DEFAULT 'legacy'`);
    }
  }

  for (const migration of rebuilds) {
    const pkColumns = (db.prepare(`PRAGMA table_info(${migration.table})`).all() as Array<{ name: string; pk: number }>)
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);
    if (migration.primaryKey.every((column, index) => pkColumns[index] === column)) continue;
    db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS ${migration.table}__new`);
      db.exec(`ALTER TABLE ${migration.table} RENAME TO ${migration.table}__old`);
      db.exec(migration.create);
      db.exec(`INSERT INTO ${migration.table}__new (${migration.columns}) SELECT ${migration.columns} FROM ${migration.table}__old`);
      db.exec(`DROP TABLE ${migration.table}__old`);
      db.exec(`ALTER TABLE ${migration.table}__new RENAME TO ${migration.table}`);
    })();
  }
}
