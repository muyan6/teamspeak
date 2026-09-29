import type { NextFunction, Request, Response } from 'express';

export type AsyncHandler = (req: Request, res: Response) => Promise<void>;

export const MAX_RATE_LIMIT_ENTRIES = 10_000;
const lastPruned = new WeakMap<object, number>();

export function pruneRateLimitMap<T>(
  entries: Map<string, T>,
  now: number,
  getExpiresAt: (entry: T) => number,
  maxEntries = MAX_RATE_LIMIT_ENTRIES,
): void {
  // 小表保持立即清理；大表按时间分摊，避免每个请求 O(N) 扫描与排序。
  if (entries.size < 100 || now - (lastPruned.get(entries) ?? 0) >= 1000) {
    for (const [key, entry] of entries) if (getExpiresAt(entry) <= now) entries.delete(key);
    lastPruned.set(entries, now);
  }

  if (entries.size <= maxEntries) return;
  while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
}

export function asyncRoute(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}
