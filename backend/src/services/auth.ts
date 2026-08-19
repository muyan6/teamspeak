import jwt from 'jsonwebtoken';

export interface AdminTokenPayload {
  role: 'admin';
}

export interface AdminPasswordStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function initializeAdminPassword(store: AdminPasswordStore, bootstrapPassword: string): {
  password: string;
  initialized: boolean;
} {
  const savedPassword = store.get('adminPassword');
  if (savedPassword) return { password: savedPassword, initialized: false };
  if (!bootstrapPassword) return { password: '', initialized: false };
  store.set('adminPassword', bootstrapPassword);
  return { password: bootstrapPassword, initialized: true };
}

export class AuthService {
  constructor(
    private adminPassword: string,
    private jwtSecret: string,
    private tokenTtlSeconds = 12 * 3600
  ) {}

  verifyAdminPassword(password: string): boolean {
    if (!this.adminPassword) return false;
    return password === this.adminPassword;
  }

  signToken(): string {
    const payload: AdminTokenPayload = { role: 'admin' };
    return jwt.sign(payload, this.jwtSecret, { expiresIn: this.tokenTtlSeconds });
  }

  verifyToken(token: string): AdminTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as AdminTokenPayload;
      return decoded.role === 'admin' ? decoded : null;
    } catch {
      return null;
    }
  }
}
