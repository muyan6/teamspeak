import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { hashAdminPasswordAsync } from '../../services/auth.js';

const MIN_ADMIN_PASSWORD_LENGTH = 8;
const MAX_ADMIN_PASSWORD_LENGTH = 256;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

interface LoginAttempt {
  count: number;
  firstFailureAt: number;
}

function loginClientKey(req: { ip?: string; socket: { remoteAddress?: string } }): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function registerAuthRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  const failedLogins = new Map<string, LoginAttempt>();

  const getRetryAfterSeconds = (clientKey: string): number => {
    const attempt = failedLogins.get(clientKey);
    if (!attempt) return 0;
    const remaining = LOGIN_WINDOW_MS - (Date.now() - attempt.firstFailureAt);
    if (remaining <= 0) {
      failedLogins.delete(clientKey);
      return 0;
    }
    return attempt.count >= LOGIN_MAX_FAILURES ? Math.ceil(remaining / 1000) : 0;
  };

  const recordFailedLogin = (clientKey: string): void => {
    const now = Date.now();
    const attempt = failedLogins.get(clientKey);
    if (!attempt || now - attempt.firstFailureAt >= LOGIN_WINDOW_MS) {
      failedLogins.set(clientKey, { count: 1, firstFailureAt: now });
      return;
    }
    attempt.count += 1;
  };

  router.post('/auth/login', async (req, res) => {
    const clientKey = loginClientKey(req);
    const retryAfterSeconds = getRetryAfterSeconds(clientKey);
    if (retryAfterSeconds > 0) {
      res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: '登录尝试次数过多，请稍后再试' });
      return;
    }

    const { password } = req.body ?? {};
    const validPassword = typeof password === 'string'
      && password.length >= MIN_ADMIN_PASSWORD_LENGTH
      && password.length <= MAX_ADMIN_PASSWORD_LENGTH
      && await deps.auth.verifyAdminPasswordAsync(password);
    if (!validPassword) {
      recordFailedLogin(clientKey);
      res.status(401).json({ error: '管理密码错误' });
      return;
    }
    failedLogins.delete(clientKey);
    res.json({ token: deps.auth.signToken() });
  });

  router.get('/auth/check', admin, (_req, res) => {
    res.json({ admin: true });
  });

  router.post('/auth/password', admin, async (req, res) => {
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
    if (!await deps.auth.verifyAdminPasswordAsync(currentPassword)) {
      res.status(400).json({ error: '当前管理密码错误' });
      return;
    }
    if (!deps.persistAdminPasswordHash) {
      res.status(503).json({ error: '当前站点不支持修改管理密码' });
      return;
    }

    try {
      const passwordHash = await hashAdminPasswordAsync(newPassword);
      deps.persistAdminPasswordHash(passwordHash);
      deps.auth.setAdminPasswordHash(passwordHash);
      res.json({ token: deps.auth.signToken() });
    } catch {
      res.status(503).json({ error: '管理密码保存失败，请稍后重试' });
    }
  });
}
