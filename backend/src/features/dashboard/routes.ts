import type { Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { asyncRoute, pruneRateLimitMap } from '../../api/route-utils.js';

const DATA_WINDOW_MS = 60 * 1000;
/**
 * 每 IP 每分钟的仪表盘请求上限。
 *
 * 前端在有 WebSocket 时约 60 秒轮询一次、无 WS 时 15 秒一次，正常单标签页
 * 只需 1~4 次/分钟。但当反向代理未设置 `X-Forwarded-For`（或 NAT 后多人
 * 共享出口 IP）时，`req.ip` 会退化成同一个地址，所有访客共用配额。
 * 30 太低会让首页直接被打成 429，因此放宽到 120，同时保留对脚本刷接口的约束。
 */
const DATA_MAX_REQUESTS = 120;
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
