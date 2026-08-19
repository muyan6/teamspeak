import http from 'node:http';
import express from 'express';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOME_MODULES,
  HOME_MODULES_CONFIG_KEY,
  normalizeHomeModules,
  saveHomeModules,
} from './home-modules.js';
import { createHomeModulesRouter } from './home-modules-router.js';

describe('主页模块开关配置', () => {
  it('默认启用全部模块，并忽略未知或非法值', () => {
    expect(normalizeHomeModules()).toEqual(DEFAULT_HOME_MODULES);
    expect(normalizeHomeModules({ trend: false, unknown: false, live: 'yes' })).toEqual({
      ...DEFAULT_HOME_MODULES,
      trend: false,
    });
  });

  it('仅持久化白名单内的布尔开关', () => {
    const writes: Array<{ key: string; value: unknown }> = [];
    const store = { setJson: (key: string, value: unknown) => writes.push({ key, value }) };

    const saved = saveHomeModules(store, { connection: false, unknown: false, injected: true });

    expect(saved).toEqual({ ...DEFAULT_HOME_MODULES, connection: false });
    expect(writes).toEqual([{ key: HOME_MODULES_CONFIG_KEY, value: saved }]);
  });

  it('公开读取开关，写入接口必须经过管理员鉴权', async () => {
    let stored: unknown = { trend: false };
    const app = express();
    app.use(express.json());
    app.use(createHomeModulesRouter({
      configStore: {
        getJson: <T>() => stored as T,
        setJson: (_key: string, value: unknown) => { stored = value; },
      } as never,
      requireAdmin: (req, res, next) => {
        if (req.headers.authorization !== 'Bearer admin-token') {
          res.status(401).json({ error: '未授权' });
          return;
        }
        next();
      },
    } as never));

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试服务器启动失败');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const initial = await fetch(`${baseUrl}/home-modules`);
      expect(await initial.json()).toEqual({ modules: { ...DEFAULT_HOME_MODULES, trend: false } });

      const anonymous = await fetch(`${baseUrl}/home-modules`, { method: 'PUT' });
      expect(anonymous.status).toBe(401);

      const saved = await fetch(`${baseUrl}/home-modules`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: { realtime: false, unexpected: false } }),
      });
      expect(await saved.json()).toEqual({ modules: { ...DEFAULT_HOME_MODULES, realtime: false } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
