import type { NextFunction, Request, Response } from 'express';

export type AsyncHandler = (req: Request, res: Response) => Promise<void>;

export const MAX_RATE_LIMIT_ENTRIES = 10_000;

export function pruneRateLimitMap<T>(
  entries: Map<string, T>,
  now: number,
  getExpiresAt: (entry: T) => number,
  maxEntries = MAX_RATE_LIMIT_ENTRIES,
): void {
  for (const [key, entry] of entries) {
    if (getExpiresAt(entry) <= now) entries.delete(key);
  }

  if (entries.size <= maxEntries) return;
  const oldest = [...entries.entries()]
    .sort((a, b) => getExpiresAt(a[1]) - getExpiresAt(b[1]))
    .slice(0, entries.size - maxEntries);
  for (const [key] of oldest) entries.delete(key);
}

export function asyncRoute(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}
