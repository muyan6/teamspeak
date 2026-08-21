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
  server_key TEXT NOT NULL DEFAULT 'legacy',
  group_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (server_key, group_id, channel_id),
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

CREATE TABLE IF NOT EXISTS badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  badge_key TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'behavior',
  icon TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#fbbf24',
  description TEXT NOT NULL DEFAULT '',
  condition_type TEXT NOT NULL,
  condition_params TEXT NOT NULL DEFAULT '{}',
  server_group_id INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS badge_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_key TEXT NOT NULL DEFAULT 'legacy',
  client_database_id INTEGER NOT NULL,
  badge_id INTEGER NOT NULL,
  granted_at INTEGER NOT NULL,
  UNIQUE(server_key, client_database_id, badge_id)
);

CREATE TABLE IF NOT EXISTS champion_config (
  server_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  server_group_id INTEGER,
  check_interval_hours INTEGER NOT NULL DEFAULT 24,
  last_check_time INTEGER,
  last_winner_client_db_id INTEGER,
  last_winner_nickname TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS champion_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_key TEXT NOT NULL DEFAULT 'legacy',
  client_database_id INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  won_at INTEGER NOT NULL,
  week_start TEXT,
  UNIQUE(server_key, client_database_id, week_start)
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
  seedDefaultBadges(db);
  return db;
}

function seedDefaultBadges(db: AppDatabase): void {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM badges').get() as { cnt: number } | undefined;
  if ((countRow?.cnt ?? 0) > 0) return;

  const defaults = [
    {
      badge_key: 'night_owl',
      name: '夜猫子',
      category: 'behavior',
      icon: 'ph-moon-stars',
      color: '#818cf8',
      description: '在凌晨 02:00~05:00 期间深度在线',
      condition_type: 'night_owl',
      condition_params: JSON.stringify({ start_hour: 2, end_hour: 5 }),
      sort_order: 10,
    },
    {
      badge_key: 'social_star',
      name: '社交达人',
      category: 'behavior',
      icon: 'ph-users-three',
      color: '#fb7185',
      description: '拥有 3 位以上深度羁绊好友',
      condition_type: 'bond_friends',
      condition_params: JSON.stringify({ threshold: 3 }),
      sort_order: 20,
    },
    {
      badge_key: 'streak_master',
      name: '连击达人',
      category: 'behavior',
      icon: 'ph-fire',
      color: '#f97316',
      description: '连续在线打卡达到 7 天',
      condition_type: 'streak_days',
      condition_params: JSON.stringify({ threshold: 7 }),
      sort_order: 30,
    },
    {
      badge_key: 'weekly_champion',
      name: '荣誉周魁首',
      category: 'behavior',
      icon: 'ph-crown',
      color: '#eab308',
      description: '曾荣获语音服务器活跃周冠军',
      condition_type: 'weekly_champion',
      condition_params: JSON.stringify({ threshold: 1 }),
      sort_order: 40,
    },
    {
      badge_key: 'room_master',
      name: '常驻房管',
      category: 'behavior',
      icon: 'ph-microphone',
      color: '#06b6d4',
      description: '在任一主力频道累计停留超过 50 小时',
      condition_type: 'channel_stay',
      condition_params: JSON.stringify({ threshold: 50 }),
      sort_order: 50,
    },
    {
      badge_key: 'iron_member',
      name: '全勤铁人',
      category: 'behavior',
      icon: 'ph-lightning',
      color: '#a855f7',
      description: '累计活跃天数达到 30 天',
      condition_type: 'active_days',
      condition_params: JSON.stringify({ threshold: 30 }),
      sort_order: 60,
    },
  ];

  const insert = db.prepare(
    `INSERT INTO badges
      (badge_key, name, category, icon, color, description, condition_type, condition_params, server_group_id, enabled, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
  );

  const now = Date.now();
  for (const b of defaults) {
    insert.run(
      b.badge_key,
      b.name,
      b.category,
      b.icon,
      b.color,
      b.description,
      b.condition_type,
      b.condition_params,
      b.sort_order,
      now
    );
  }
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

function hasUniqueColumns(db: AppDatabase, table: string, expectedColumns: string[]): boolean {
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number }>;
  return indexes.some((index) => {
    if (!index.unique) return false;
    const columns = (db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string; seqno: number }>)
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name);
    return columns.length === expectedColumns.length
      && expectedColumns.every((column, index) => columns[index] === column);
  });
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
    'elastic_managed_channels',
    'achievement_grants',
    'champion_config',
  ];
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'server_key')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN server_key TEXT NOT NULL DEFAULT 'legacy'`);
    }
  }

  const rebuilds: Array<{
    table: string;
    columns: string;
    create: string;
    primaryKey: string[];
    uniqueColumns?: string[];
  }> = [
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
    {
      table: 'elastic_managed_channels',
      columns: 'server_key, group_id, channel_id, created_at',
      primaryKey: ['server_key', 'group_id', 'channel_id'],
      create: `CREATE TABLE elastic_managed_channels__new (
        server_key TEXT NOT NULL DEFAULT 'legacy',
        group_id INTEGER NOT NULL,
        channel_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (server_key, group_id, channel_id),
        FOREIGN KEY (group_id) REFERENCES elastic_groups(id) ON DELETE CASCADE
      )`,
    },
    {
      table: 'achievement_grants',
      columns: 'server_key, id, client_database_id, level_id, granted_at',
      primaryKey: ['id'],
      uniqueColumns: ['server_key', 'client_database_id', 'level_id'],
      create: `CREATE TABLE achievement_grants__new (
        server_key TEXT NOT NULL DEFAULT 'legacy',
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_database_id INTEGER NOT NULL,
        level_id INTEGER NOT NULL,
        granted_at INTEGER NOT NULL,
        UNIQUE(server_key, client_database_id, level_id)
      )`,
    },
    {
      table: 'champion_config',
      columns: 'server_key, enabled, server_group_id, check_interval_hours, last_check_time, last_winner_client_db_id, last_winner_nickname, updated_at',
      primaryKey: ['server_key'],
      create: `CREATE TABLE champion_config__new (
        server_key TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        server_group_id INTEGER,
        check_interval_hours INTEGER NOT NULL DEFAULT 24,
        last_check_time INTEGER,
        last_winner_client_db_id INTEGER,
        last_winner_nickname TEXT,
        updated_at INTEGER
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
    const primaryKeyMatches = pkColumns.length === migration.primaryKey.length
      && migration.primaryKey.every((column, index) => pkColumns[index] === column);
    const uniqueColumnsMatch = !migration.uniqueColumns
      || hasUniqueColumns(db, migration.table, migration.uniqueColumns);
    if (primaryKeyMatches && uniqueColumnsMatch) continue;
    db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS ${migration.table}__new`);
      db.exec(`ALTER TABLE ${migration.table} RENAME TO ${migration.table}__old`);
      db.exec(migration.create);
      db.exec(`INSERT INTO ${migration.table}__new (${migration.columns}) SELECT ${migration.columns} FROM ${migration.table}__old`);
      db.exec(`DROP TABLE ${migration.table}__old`);
      db.exec(`ALTER TABLE ${migration.table}__new RENAME TO ${migration.table}`);
    })();
  }

  db.transaction(() => {
    db.exec(`DELETE FROM online_samples
      WHERE id NOT IN (
        SELECT MIN(id) FROM online_samples GROUP BY server_key, sample_time
      )`);
    db.exec(`DELETE FROM sessions
      WHERE id NOT IN (
        SELECT MIN(id) FROM sessions GROUP BY server_key, client_database_id, start_time
      )`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_online_samples_server_sample_time ON online_samples(server_key, sample_time)');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_server_client_start ON sessions(server_key, client_database_id, start_time)');
  })();
}
