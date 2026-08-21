import type { AppDatabase } from '../../db/database.js';
import { CredentialCipher, hashAdminPassword, isAdminPasswordHash } from '../../services/auth.js';

export interface ManagedSubsite {
  id: number;
  slug: string;
  displayName: string;
  domain: string;
  ts3Host: string;
  queryPort: number;
  serverPort: number;
  serverId: number;
  username: string;
  password: string;
  publicHost: string;
  publicPort: number;
  adminPassword: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ManagedSubsiteSummary extends Omit<ManagedSubsite, 'password' | 'adminPassword'> {
  connected: boolean;
  url: string;
}

export interface CreateManagedSubsiteInput {
  displayName?: unknown;
  slug?: unknown;
  domain?: unknown;
  ts3Host?: unknown;
  queryPort?: unknown;
  serverPort?: unknown;
  serverId?: unknown;
  username?: unknown;
  password?: unknown;
  publicHost?: unknown;
  publicPort?: unknown;
  adminPassword?: unknown;
}

export interface MultiSubsiteSettings {
  baseDomain: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function asPort(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error('端口必须是 1 到 65535 的整数');
  return parsed;
}

function asServerId(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('虚拟服务器 ID 必须是非负整数');
  return parsed;
}

function normalizeHost(value: unknown): string {
  return asText(value).toLowerCase().replace(/\.$/, '');
}

export function validateDomain(domain: string): string {
  if (!domain || domain.length > 253 || domain.includes('://') || domain.includes('/') || domain.includes(' ')) {
    throw new Error('分站域名格式无效');
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(domain)) return domain;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error('分站域名格式无效');
  }
  return domain;
}

function validateBaseDomain(value: unknown): string {
  const domain = validateDomain(normalizeHost(value));
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(domain)) throw new Error('根域名不能使用 IP 地址');
  return domain;
}

function fromRow(row: Record<string, unknown>, credentialCipher: CredentialCipher): ManagedSubsite {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    displayName: String(row.display_name),
    domain: String(row.domain),
    ts3Host: String(row.ts3_host),
    queryPort: Number(row.query_port),
    serverPort: Number(row.server_port),
    serverId: Number(row.server_id ?? 0),
    username: String(row.query_username),
    password: credentialCipher.decrypt(String(row.query_password)),
    publicHost: String(row.public_host),
    publicPort: Number(row.public_port),
    adminPassword: String(row.admin_password),
    enabled: Number(row.enabled) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class MultiSubsiteRegistry {
  private currentBaseDomain: string;

  constructor(
    private readonly db: AppDatabase,
    fallbackBaseDomain: string,
    private readonly credentialCipher = CredentialCipher.forDatabase(':memory:')
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS managed_subsites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      domain TEXT NOT NULL UNIQUE,
      ts3_host TEXT NOT NULL,
      query_port INTEGER NOT NULL,
      server_port INTEGER NOT NULL,
      server_id INTEGER NOT NULL DEFAULT 0,
      query_username TEXT NOT NULL,
      query_password TEXT NOT NULL,
      public_host TEXT NOT NULL,
      public_port INTEGER NOT NULL,
      admin_password TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    const columns = db.prepare('PRAGMA table_info(managed_subsites)').all<{ name: string }>();
    if (!columns.some((column) => column.name === 'server_id')) {
      db.exec('ALTER TABLE managed_subsites ADD COLUMN server_id INTEGER NOT NULL DEFAULT 0');
    }
    db.exec(`CREATE TABLE IF NOT EXISTS multi_subsite_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    this.migrateCredentials();
    const saved = db.prepare("SELECT value FROM multi_subsite_settings WHERE key = 'base_domain'").get<{ value: string }>();
    this.currentBaseDomain = saved ? validateBaseDomain(saved.value) : (fallbackBaseDomain ? validateBaseDomain(fallbackBaseDomain) : '');
  }

  get baseDomain(): string {
    return this.currentBaseDomain;
  }

  getSettings(): MultiSubsiteSettings {
    return { baseDomain: this.currentBaseDomain };
  }

  saveBaseDomain(value: unknown): MultiSubsiteSettings {
    const baseDomain = validateBaseDomain(value);
    if (this.hasHost(baseDomain)) throw new Error('根域名已被分站占用，请先修改或删除该分站');
    this.db.prepare(`INSERT INTO multi_subsite_settings (key, value, updated_at)
      VALUES ('base_domain', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(baseDomain, Date.now());
    this.currentBaseDomain = baseDomain;
    return this.getSettings();
  }

  list(): ManagedSubsite[] {
    return this.db.prepare('SELECT * FROM managed_subsites ORDER BY created_at DESC').all<Record<string, unknown>>()
      .map((row) => fromRow(row, this.credentialCipher));
  }

  get(id: number): ManagedSubsite | null {
    const row = this.db.prepare('SELECT * FROM managed_subsites WHERE id = ?').get<Record<string, unknown>>(id);
    return row ? fromRow(row, this.credentialCipher) : null;
  }

  getByHost(host: string): ManagedSubsite | null {
    const row = this.db.prepare('SELECT * FROM managed_subsites WHERE domain = ? AND enabled = 1').get<Record<string, unknown>>(normalizeHost(host));
    return row ? fromRow(row, this.credentialCipher) : null;
  }

  hasHost(host: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM managed_subsites WHERE domain = ?').get(normalizeHost(host)));
  }

  create(input: CreateManagedSubsiteInput): ManagedSubsite {
    const slug = asText(input.slug).toLowerCase();
    const displayName = asText(input.displayName);
    if (!SLUG_PATTERN.test(slug) || slug.length > 64) throw new Error('子域名只能使用小写字母、数字和连字符');
    if (!displayName || displayName.length > 80) throw new Error('分站昵称不能为空，且不能超过 80 个字符');
    if (!this.baseDomain && !asText(input.domain)) throw new Error('请先在统一分站后台保存根域名，再生成子域名');
    const domain = validateDomain(normalizeHost(input.domain) || `${slug}.${this.baseDomain}`);
    if (domain === this.baseDomain) throw new Error('分站域名不能与平台根域名相同');
    const ts3Host = asText(input.ts3Host);
    const username = asText(input.username) || 'serveradmin';
    const password = String(input.password ?? '');
    const adminPassword = String(input.adminPassword ?? '');
    if (!ts3Host) throw new Error('TS3 服务器地址不能为空');
    if (!adminPassword || adminPassword.length < 8) throw new Error('分站后台密码至少需要 8 个字符');
    const queryPort = asPort(input.queryPort, 10011);
    const serverPort = asPort(input.serverPort, 9987);
    const serverId = asServerId(input.serverId);
    const publicHost = asText(input.publicHost) || ts3Host;
    const publicPort = asPort(input.publicPort, serverPort);
    const now = Date.now();
    try {
      const result = this.db.prepare(`INSERT INTO managed_subsites
        (slug, display_name, domain, ts3_host, query_port, server_port, server_id, query_username, query_password, public_host, public_port, admin_password, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(
          slug,
          displayName,
          domain,
          ts3Host,
          queryPort,
          serverPort,
          serverId,
          username,
          this.credentialCipher.encrypt(password),
          publicHost,
          publicPort,
          hashAdminPassword(adminPassword),
          now,
          now
        );
      return this.get(result.lastInsertRowid) as ManagedSubsite;
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE')) throw new Error('子域名或访问域名已被占用');
      throw error;
    }
  }

  setEnabled(id: number, enabled: boolean): ManagedSubsite {
    const result = this.db.prepare('UPDATE managed_subsites SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, Date.now(), id);
    if (!result.changes) throw new Error('分站不存在');
    return this.get(id) as ManagedSubsite;
  }

  updateTs3Config(id: number, config: { host: string; queryPort: number; serverPort: number; serverId: number; username: string; password: string }): void {
    const result = this.db.prepare(`UPDATE managed_subsites SET ts3_host = ?, query_port = ?, server_port = ?, server_id = ?, query_username = ?, query_password = ?, updated_at = ? WHERE id = ?`)
      .run(
        config.host,
        config.queryPort,
        config.serverPort,
        config.serverId,
        config.username,
        this.credentialCipher.encrypt(config.password),
        Date.now(),
        id
      );
    if (!result.changes) throw new Error('分站不存在');
  }

  updateAdminPasswordHash(id: number, passwordHash: string): void {
    if (!isAdminPasswordHash(passwordHash)) throw new Error('管理员密码哈希格式无效');
    const result = this.db.prepare('UPDATE managed_subsites SET admin_password = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, Date.now(), id);
    if (!result.changes) throw new Error('分站不存在');
  }

  private migrateCredentials(): void {
    const rows = this.db.prepare(
      'SELECT id, query_password, admin_password FROM managed_subsites'
    ).all<{ id: number; query_password: string; admin_password: string }>();
    for (const row of rows) {
      const queryPassword = String(row.query_password ?? '');
      const adminPassword = String(row.admin_password ?? '');
      const nextQueryPassword = this.credentialCipher.isEncrypted(queryPassword)
        ? queryPassword
        : this.credentialCipher.encrypt(queryPassword);
      const nextAdminPassword = isAdminPasswordHash(adminPassword)
        ? adminPassword
        : hashAdminPassword(adminPassword);
      if (nextQueryPassword !== queryPassword || nextAdminPassword !== adminPassword) {
        this.db.prepare(
          'UPDATE managed_subsites SET query_password = ?, admin_password = ?, updated_at = ? WHERE id = ?'
        ).run(nextQueryPassword, nextAdminPassword, Date.now(), row.id);
      }
    }
  }
}
