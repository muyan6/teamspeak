import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { hashAdminPassword } from '../../services/auth.js';

const MIN_ADMIN_PASSWORD_LENGTH = 8;
const MAX_ADMIN_PASSWORD_LENGTH = 256;

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

  router.post('/auth/password', admin, (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      res.status(400).json({ error: '请填写当前密码和新密码' });
      return;
    }
    if (newPassword.length < MIN_ADMIN_PASSWORD_LENGTH || newPassword.length > MAX_ADMIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `新密码长度需为 ${MIN_ADMIN_PASSWORD_LENGTH} 到 ${MAX_ADMIN_PASSWORD_LENGTH} 个字符` });
      return;
    }
    if (currentPassword === newPassword) {
      res.status(400).json({ error: '新密码不能与当前密码相同' });
      return;
    }
    if (!deps.auth.verifyAdminPassword(currentPassword)) {
      res.status(400).json({ error: '当前管理密码错误' });
      return;
    }
    if (!deps.persistAdminPasswordHash) {
      res.status(503).json({ error: '当前站点不支持修改管理密码' });
      return;
    }

    try {
      const passwordHash = hashAdminPassword(newPassword);
      deps.persistAdminPasswordHash(passwordHash);
      deps.auth.setAdminPasswordHash(passwordHash);
      res.json({ token: deps.auth.signToken() });
    } catch {
      res.status(503).json({ error: '管理密码保存失败，请稍后重试' });
    }
  });
}
