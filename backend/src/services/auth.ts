import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { promisify } from 'node:util';

const PASSWORD_HASH_PREFIX = 'scrypt';
const CREDENTIAL_PREFIX = 'enc:v1';
const scryptAsync = promisify(scrypt);

async function deriveScrypt(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  const digest = await scryptAsync(password, salt, keyLength);
  if (!Buffer.isBuffer(digest)) throw new Error('scrypt 返回了无效摘要');
  return digest;
}

export interface AdminTokenPayload {
  role: 'admin';
  passwordVersion: string;
}

export interface AdminPasswordStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function initializeAdminPassword(store: AdminPasswordStore, bootstrapPassword: string): {
  password: string;
  initialized: boolean;
  migrated: boolean;
} {
  const savedPassword = store.get('adminPassword');
  if (savedPassword) {
    if (isAdminPasswordHash(savedPassword)) return { password: savedPassword, initialized: false, migrated: false };
    const password = hashAdminPassword(savedPassword);
    store.set('adminPassword', password);
    return { password, initialized: false, migrated: true };
  }
  if (!bootstrapPassword) return { password: '', initialized: false, migrated: false };
  const password = hashAdminPassword(bootstrapPassword);
  store.set('adminPassword', password);
  return { password, initialized: true, migrated: false };
}

export class AuthService {
  private adminPasswordHash: string;

  constructor(
    adminPassword: string,
    private jwtSecret: string,
    private tokenTtlSeconds = 12 * 3600
  ) {
    this.adminPasswordHash = adminPassword
      ? (isAdminPasswordHash(adminPassword) ? adminPassword : hashAdminPassword(adminPassword))
      : '';
  }

  verifyAdminPassword(password: string): boolean {
    return Boolean(this.adminPasswordHash) && verifyAdminPasswordHash(this.adminPasswordHash, password);
  }

  async verifyAdminPasswordAsync(password: string): Promise<boolean> {
    return Boolean(this.adminPasswordHash) && await verifyAdminPasswordHashAsync(this.adminPasswordHash, password);
  }

  setAdminPasswordHash(passwordHash: string): void {
    if (!isAdminPasswordHash(passwordHash)) throw new Error('管理员密码哈希格式无效');
    this.adminPasswordHash = passwordHash;
  }

  signToken(): string {
    const payload: AdminTokenPayload = { role: 'admin', passwordVersion: this.getPasswordVersion() };
    return jwt.sign(payload, this.jwtSecret, { expiresIn: this.tokenTtlSeconds });
  }

  verifyToken(token: string): AdminTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as Partial<AdminTokenPayload>;
      if (decoded.role !== 'admin' || typeof decoded.passwordVersion !== 'string') return null;
      return this.passwordVersionMatches(decoded.passwordVersion)
        ? { role: 'admin', passwordVersion: decoded.passwordVersion }
        : null;
    } catch {
      return null;
    }
  }

  private getPasswordVersion(): string {
    return createHash('sha256').update(this.adminPasswordHash).digest('base64url');
  }

  private passwordVersionMatches(value: string): boolean {
    const expected = Buffer.from(this.getPasswordVersion());
    const actual = Buffer.from(value);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

export function hashAdminPassword(password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64);
  return [PASSWORD_HASH_PREFIX, salt.toString('base64url'), digest.toString('base64url')].join('$');
}

export async function hashAdminPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = await deriveScrypt(password, salt, 64);
  return [PASSWORD_HASH_PREFIX, salt.toString('base64url'), digest.toString('base64url')].join('$');
}

export function isAdminPasswordHash(value: string): boolean {
  const [prefix, salt, digest, ...rest] = value.split('$');
  return prefix === PASSWORD_HASH_PREFIX && Boolean(salt) && Boolean(digest) && rest.length === 0;
}

function verifyAdminPasswordHash(stored: string, password: string): boolean {
  if (!isAdminPasswordHash(stored)) return false;
  const [, saltValue, digestValue] = stored.split('$');
  try {
    const expected = Buffer.from(digestValue, 'base64url');
    const actual = scryptSync(password, Buffer.from(saltValue, 'base64url'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

async function verifyAdminPasswordHashAsync(stored: string, password: string): Promise<boolean> {
  if (!isAdminPasswordHash(stored)) return false;
  const [, saltValue, digestValue] = stored.split('$');
  try {
    const expected = Buffer.from(digestValue, 'base64url');
    const actual = await deriveScrypt(password, Buffer.from(saltValue, 'base64url'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export class CredentialCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret) throw new Error('凭据加密密钥不能为空');
    this.key = createHash('sha256').update(secret).digest();
  }

  static forDatabase(dbPath: string, configuredSecret = process.env.CREDENTIAL_ENCRYPTION_KEY): CredentialCipher {
    if (configuredSecret?.trim()) return new CredentialCipher(configuredSecret.trim());
    if (dbPath === ':memory:') return new CredentialCipher(randomBytes(32).toString('base64url'));

    const keyPath = path.resolve(path.dirname(dbPath), '.credentials.key');
    if (existsSync(keyPath)) return new CredentialCipher(readFileSync(keyPath, 'utf8').trim());

    mkdirSync(path.dirname(keyPath), { recursive: true });
    const secret = randomBytes(32).toString('base64url');
    writeFileSync(keyPath, `${secret}\n`, { encoding: 'utf8', mode: 0o600 });
    return new CredentialCipher(secret);
  }

  isEncrypted(value: string | null | undefined): boolean {
    return Boolean(value && value.startsWith(`${CREDENTIAL_PREFIX}:`));
  }

  encrypt(value: string): string {
    if (!value) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
      CREDENTIAL_PREFIX,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  decrypt(value: string): string {
    if (!value || !this.isEncrypted(value)) return value;
    const [prefix, version, ivValue, authTagValue, encryptedValue, ...rest] = value.split(':');
    if (`${prefix}:${version}` !== CREDENTIAL_PREFIX || !ivValue || !authTagValue || !encryptedValue || rest.length > 0) {
      throw new Error('已保存的凭据格式无效');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
      decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('无法解密已保存的凭据，请检查 CREDENTIAL_ENCRYPTION_KEY');
    }
  }
}
