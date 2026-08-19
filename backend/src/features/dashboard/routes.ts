import type { Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { asyncRoute } from '../../api/route-utils.js';

export function registerDashboardRoutes(router: Router, deps: ApiDeps): void {
  router.get('/site', (_req, res) => {
    res.json({ slug: deps.dashboard.getSiteSlug(), domain: deps.dashboard.getSiteDomain() });
  });

  router.get('/data', asyncRoute(async (_req, res) => {
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
