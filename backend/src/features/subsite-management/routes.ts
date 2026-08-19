import type { RequestHandler, Router } from 'express';
import { SubsiteManagementService } from './service.js';

export function registerSubsiteManagementRoutes(
  router: Router,
  service: SubsiteManagementService,
  admin: RequestHandler
): void {
  router.get('/admin/subsite', admin, (_req, res) => {
    res.json(service.getConfig());
  });

  router.post('/admin/subsite', admin, (req, res) => {
    try {
      res.json(service.saveConfig(req.body ?? {}));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
}
