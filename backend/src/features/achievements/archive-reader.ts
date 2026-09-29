import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** 累计资格读取冷数据；只读打开，绝不运行迁移或修改归档库。 */
export class LifetimeArchiveReader {
  private cache = new Map<string, { expiresAt: number; rows: unknown[] }>();

  constructor(public filePath?: string) {}

  invalidate(): void { this.cache.clear(); }

  read<T>(sql: string, serverKey: string, dbid: number): T[] {
    if (!this.filePath || !existsSync(this.filePath)) return [];
    const key = JSON.stringify([sql, serverKey, dbid]);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.rows as T[];
    const db = new DatabaseSync(this.filePath, { readOnly: true });
    try {
      // 兼容早期 Node 22 对 readOnly 选项的处理，SQL 层也禁止写入。
      db.exec('PRAGMA query_only = ON');
      const rows = db.prepare(sql).all(serverKey, dbid) as T[];
      if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { rows, expiresAt: Date.now() + 60_000 });
      return rows;
    } finally { db.close(); }
  }
}

/** 实际结束时间取 end ?? now；只检查与本地凌晨 [02:00,05:00) 的真实交集。 */
export function overlapsNightWindow(startSec: number, endSec: number | null, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const end = Math.min(endSec ?? nowSec, nowSec);
  if (!Number.isFinite(startSec) || !Number.isFinite(end) || end <= startSec) return false;
  const window = new Date(startSec * 1000);
  window.setHours(2, 0, 0, 0);
  // 起始日和下一天已足以判定任意长会话，避免按天遍历多年数据。
  for (let i = 0; i < 2; i++) {
    const until = new Date(window); until.setHours(5, 0, 0, 0);
    if (Math.max(startSec, window.getTime() / 1000) < Math.min(end, until.getTime() / 1000)) return true;
    window.setDate(window.getDate() + 1);
  }
  return false;
}
