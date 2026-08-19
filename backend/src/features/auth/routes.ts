import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';

export function registerAuthRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  router.post('/auth/login', (req, res) => {
    const { password } = req.body ?? {};
    if (!password || !deps.auth.verifyAdminPassword(String(password))) {
      res.status(401).json({ error: '管理密码错误' });
      return;
    }
    res.json({ token: deps.auth.signToken() });
  });

  router.get('/auth/check', admin, (_req, res) => {
    res.json({ admin: true });
  });
}
