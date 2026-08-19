import { Router, type NextFunction, type Request, type Response } from 'express';
import type { SiteConfigStore } from '../db/site-config.js';
import type { AuthService } from '../services/auth.js';
import type { DashboardService } from '../services/dashboard.js';
import type { StatsService } from '../services/stats.js';
import type { AchievementService } from '../features/achievements/service.js';
import type { ElasticChannelService } from '../features/elastic-channels/service.js';
import type { WeeklyChampionService } from '../features/weekly-champion/service.js';
import type { SubsiteManagementService } from '../features/subsite-management/service.js';
import type { Ts3ClientWrapper } from '../ts3/client.js';
import { adminAuth } from './middleware.js';
import { registerAchievementRoutes } from '../features/achievements/routes.js';
import { registerAuthRoutes } from '../features/auth/routes.js';
import { registerDashboardRoutes } from '../features/dashboard/routes.js';
import { registerElasticChannelRoutes } from '../features/elastic-channels/routes.js';
import { registerProfileRoutes } from '../features/profile/routes.js';
import { registerSiteConfigRoutes } from '../features/site-config/routes.js';
import { registerTs3AdminRoutes } from '../features/ts3-admin/routes.js';
import { registerWeeklyChampionRoutes } from '../features/weekly-champion/routes.js';
import { registerSubsiteManagementRoutes } from '../features/subsite-management/routes.js';

export interface ApiDeps {
  auth: AuthService;
  configStore: SiteConfigStore;
  stats: StatsService;
  elastic: ElasticChannelService;
  champion: WeeklyChampionService;
  achievement: AchievementService;
  dashboard: DashboardService;
  ts3: Ts3ClientWrapper;
  publicServer: { host: string; port: number };
  subsite: SubsiteManagementService;
}

export function createRouter(deps: ApiDeps): Router {
  const router = Router();
  const admin = adminAuth(deps.auth);

  registerDashboardRoutes(router, deps);
  registerProfileRoutes(router, deps);
  registerSiteConfigRoutes(router, deps, admin);
  registerElasticChannelRoutes(router, deps, admin);
  registerWeeklyChampionRoutes(router, deps, admin);
  registerAchievementRoutes(router, deps, admin);
  registerTs3AdminRoutes(router, deps, admin);
  registerAuthRoutes(router, deps, admin);
  registerSubsiteManagementRoutes(router, deps.subsite, admin);

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(503).json({
      status: 'error',
      message: (error as Error).message || '服务器内部错误',
    });
  });

  return router;
}
