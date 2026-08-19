import type { AppDatabase } from '../../db/database.js';

export interface ManagedSubsite {
  id: number;
  slug: string;
  displayName: string;
  domain: string;
  ts3Host: string;
  queryPort: number;
  serverPort: number;
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

function fromRow(row: Record<string, unknown>): ManagedSubsite {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    displayName: String(row.display_name),
    domain: String(row.domain),
    ts3Host: String(row.ts3_host),
    queryPort: Number(row.query_port),
    serverPort: Number(row.server_port),
    username: String(row.query_username),
    password: String(row.query_password),
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

  constructor(private readonly db: AppDatabase, fallbackBaseDomain: string) {
    db.exec(`CREATE TABLE IF NOT EXISTS managed_subsites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      domain TEXT NOT NULL UNIQUE,
      ts3_host TEXT NOT NULL,
      query_port INTEGER NOT NULL,
      server_port INTEGER NOT NULL,
      query_username TEXT NOT NULL,
      query_password TEXT NOT NULL,
      public_host TEXT NOT NULL,
      public_port INTEGER NOT NULL,
      admin_password TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS multi_subsite_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
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
    this.db.prepare(`INSERT INTO multi_subsite_settings (key, value, updated_at)
      VALUES ('base_domain', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(baseDomain, Date.now());
    this.currentBaseDomain = baseDomain;
    return this.getSettings();
  }

  list(): ManagedSubsite[] {
    return this.db.prepare('SELECT * FROM managed_subsites ORDER BY created_at DESC').all<Record<string, unknown>>().map(fromRow);
  }

  get(id: number): ManagedSubsite | null {
    const row = this.db.prepare('SELECT * FROM managed_subsites WHERE id = ?').get<Record<string, unknown>>(id);
    return row ? fromRow(row) : null;
  }

  getByHost(host: string): ManagedSubsite | null {
    const row = this.db.prepare('SELECT * FROM managed_subsites WHERE domain = ? AND enabled = 1').get<Record<string, unknown>>(normalizeHost(host));
    return row ? fromRow(row) : null;
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
    const ts3Host = asText(input.ts3Host);
    const username = asText(input.username) || 'serveradmin';
    const password = String(input.password ?? '');
    const adminPassword = String(input.adminPassword ?? '');
    if (!ts3Host) throw new Error('TS3 服务器地址不能为空');
    if (!adminPassword || adminPassword.length < 8) throw new Error('分站后台密码至少需要 8 个字符');
    const queryPort = asPort(input.queryPort, 10011);
    const serverPort = asPort(input.serverPort, 9987);
    const publicHost = asText(input.publicHost) || ts3Host;
    const publicPort = asPort(input.publicPort, serverPort);
    const now = Date.now();
    try {
      const result = this.db.prepare(`INSERT INTO managed_subsites
        (slug, display_name, domain, ts3_host, query_port, server_port, query_username, query_password, public_host, public_port, admin_password, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(slug, displayName, domain, ts3Host, queryPort, serverPort, username, password, publicHost, publicPort, adminPassword, now, now);
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

  updateTs3Config(id: number, config: { host: string; queryPort: number; serverPort: number; username: string; password: string }): void {
    const result = this.db.prepare(`UPDATE managed_subsites SET ts3_host = ?, query_port = ?, server_port = ?, query_username = ?, query_password = ?, updated_at = ? WHERE id = ?`)
      .run(config.host, config.queryPort, config.serverPort, config.username, config.password, Date.now(), id);
    if (!result.changes) throw new Error('分站不存在');
  }
}
