import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { asyncRoute } from '../../api/route-utils.js';

export function registerWeeklyChampionRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  router.get('/champion/config', admin, (_req, res) => {
    res.json(deps.champion.getConfig());
  });

  router.post('/champion/config', admin, (req, res) => {
    const { enabled, serverGroupId, checkIntervalHours } = req.body ?? {};
    const parsedEnabled = Number(enabled);
    const parsedInterval = Number(checkIntervalHours);
    const parsedGroupId = Number(serverGroupId);
    const needsGroup = parsedEnabled === 1;
    if (
      ![0, 1].includes(parsedEnabled)
      || !Number.isFinite(parsedInterval)
      || parsedInterval <= 0
      || (needsGroup && (!Number.isInteger(parsedGroupId) || parsedGroupId <= 0))
    ) {
      res.status(400).json({ error: '周冠军配置无效' });
      return;
    }
    res.json(deps.champion.saveConfig({
      enabled: parsedEnabled,
      serverGroupId: needsGroup ? parsedGroupId : null,
      checkIntervalHours: parsedInterval,
    }));
  });

  router.post('/champion/check', admin, asyncRoute(async (_req, res) => {
    res.json({ result: await deps.champion.check() });
  }));
}
