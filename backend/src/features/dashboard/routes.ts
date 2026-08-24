import type { Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { asyncRoute, pruneRateLimitMap } from '../../api/route-utils.js';

const DATA_WINDOW_MS = 60 * 1000;
const DATA_MAX_REQUESTS = 30;
interface DataRateLimitEntry { count: number; resetAt: number }

export function registerDashboardRoutes(router: Router, deps: ApiDeps): void {
  const dataRateLimits = new Map<string, DataRateLimitEntry>();

  router.get('/site', (_req, res) => {
    res.json({ slug: deps.dashboard.getSiteSlug(), domain: deps.dashboard.getSiteDomain() });
  });

  router.get('/data', asyncRoute(async (req, res) => {
    const now = Date.now();
    pruneRateLimitMap(dataRateLimits, now, (entry) => entry.resetAt);
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    const entry = dataRateLimits.get(clientKey);
    if (!entry || now >= entry.resetAt) {
      dataRateLimits.set(clientKey, { count: 1, resetAt: now + DATA_WINDOW_MS });
      pruneRateLimitMap(dataRateLimits, now, (item) => item.resetAt);
    } else {
      entry.count += 1;
      if (entry.count > DATA_MAX_REQUESTS) {
        res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
        res.status(429).json({ error: '仪表盘请求过于频繁，请稍后再试' });
        return;
      }
    }
    try {
      res.json(await deps.dashboard.getData());
    } catch (error) {
      res.status(503).json({
        status: 'error',
        message: (error as Error).message || '无法获取服务器数据',
      });
    }
  }));

  router.get('/server-info', (_req, res) => {
    res.json({
      host: deps.publicServer.host,
      port: deps.publicServer.port,
      quickConnectUrl: `ts3server://${deps.publicServer.host}?port=${deps.publicServer.port}`,
    });
  });
}
