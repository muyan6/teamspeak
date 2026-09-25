import { Router, type RequestHandler } from 'express';
import { adminAuth } from '../../api/middleware.js';
import type { AuthService } from '../../services/auth.js';
import { resolveRequestHost } from '../../net/host.js';
import type { MultiSubsiteRuntimeManager } from './runtime.js';
import { registerMultiSubsiteRoutes } from './routes.js';

export { resolveRequestHost };

export function createMultiSubsitePlatformRouter(auth: AuthService, manager: MultiSubsiteRuntimeManager): Router {
  const router = Router();
  router.use((req, res, next) => {
    if (manager.isManagedSubsiteHost(resolveRequestHost(req.headers))) {
      res.status(404).json({ error: '分站不存在或已停用' });
      return;
    }
    next();
  });
  registerMultiSubsiteRoutes(router, manager, adminAuth(auth));
  return router;
}

export function createHostSelectedApiRouter(
  legacy: RequestHandler,
  manager: MultiSubsiteRuntimeManager
): RequestHandler {
  return (req, res, next): void => {
    const host = resolveRequestHost(req.headers);
    const subsiteRouter = manager.getRouterForHost(host);
    if (subsiteRouter) {
      subsiteRouter(req, res, next);
      return;
    }
    if (manager.isManagedSubsiteHost(host)) {
      res.status(404).json({ error: '分站不存在或已停用' });
      return;
    }
    legacy(req, res, next);
  };
}
