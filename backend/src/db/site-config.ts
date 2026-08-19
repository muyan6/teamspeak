import type { AppDatabase } from './database.js';

export class SiteConfigStore {
  constructor(private db: AppDatabase) {}

  get(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM site_config WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  set(key: string, value: string): void {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      )
      .run(key, value, now);
  }

  getJson<T>(key: string, fallback: T): T {
    const raw = this.get(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  getUpdatedAt(key: string): number | null {
    const row = this.db
      .prepare('SELECT updated_at FROM site_config WHERE key = ?')
      .get(key) as { updated_at: number } | undefined;
    return row ? row.updated_at : null;
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }
}
