import { Router } from 'express';
import type { SiteConfigStore } from '../../db/site-config.js';
import { loadHomeModules, saveHomeModules } from './home-modules.js';

export interface HomeModulesRouterDependencies {
  configStore: SiteConfigStore;
  requireAdmin: ReturnType<typeof import('../../api/middleware.js').adminAuth>;
}

/**
 * 独立的主页模块管理路由；推荐在 /api 下挂载。
 * GET 对主页公开，PUT 必须通过后台认证。
 */
export function createHomeModulesRouter(deps: HomeModulesRouterDependencies): Router {
  const router = Router();

  router.get('/home-modules', (_req, res) => {
    res.json({ modules: loadHomeModules(deps.configStore) });
  });

  router.put('/home-modules', deps.requireAdmin, (req, res) => {
    res.json({ modules: saveHomeModules(deps.configStore, req.body?.modules) });
  });

  return router;
}
