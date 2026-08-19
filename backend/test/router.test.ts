import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createRouter, type ApiDeps } from '../src/api/router.js';
import { AuthService } from '../src/services/auth.js';
import { WeeklyChampionService } from '../src/services/champion.js';
import { openDatabase } from '../src/db/database.js';
import { StatsService } from '../src/services/stats.js';

describe('管理接口与配置回归', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  async function startRouter(): Promise<{ baseUrl: string; token: string }> {
    const auth = new AuthService('test-password', 'test-secret');
    const elasticGroups = [{
      id: 1,
      name: 'Private room',
      namePrefix: '#private-',
      createThreshold: 2,
      deleteThreshold: 0,
      password: 'must-not-be-public',
      channelGroupId: null,
      baseChannelId: null,
      maxChannels: 8,
      enabled: 1,
      createdAt: Date.now(),
    }];

    const deps = {
      auth,
      configStore: { get: () => null, getJson: () => ({}), set: () => undefined, setJson: () => undefined },
      stats: { getTopUsers: () => [], getTopChannels: () => [], getDailyTrends: () => ({ labels: [], data: [] }) },
      elastic: { listGroups: () => elasticGroups, addGroup: () => elasticGroups[0], removeGroup: () => false },
      champion: { getConfig: () => ({}), saveConfig: () => ({}), check: async () => null },
      dashboard: { getSiteSlug: () => 'test', getSiteDomain: () => '', getData: async () => ({}) },
      ts3: { connected: true, getChannels: async () => [] },
      publicServer: { host: 'localhost', port: 9987 },
    } as unknown as ApiDeps;

    const app = express();
    app.use(express.json());
    app.use('/api', createRouter(deps));
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试服务器启动失败');
    return { baseUrl: `http://127.0.0.1:${address.port}/api`, token: auth.signToken() };
  }

  it('弹性频道接口要求管理员凭证，避免泄露频道密码', async () => {
    const { baseUrl, token } = await startRouter();

    const anonymousGroups = await fetch(`${baseUrl}/elastic/groups`);
    const anonymousLoad = await fetch(`${baseUrl}/elastic/load`);
    expect(anonymousGroups.status).toBe(401);
    expect(anonymousLoad.status).toBe(401);

    const adminGroups = await fetch(`${baseUrl}/elastic/groups`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(adminGroups.status).toBe(200);
  });

  it('周冠军配置保存后能完整读回数据库字段', () => {
    const db = openDatabase(':memory:');
    const stats = new StatsService(db);
    const ts3 = {} as never;
    const champion = new WeeklyChampionService(db, ts3, stats);

    const saved = champion.saveConfig({ enabled: 1, serverGroupId: 42, checkIntervalHours: 6 });
    expect(saved).toMatchObject({
      id: 1,
      enabled: 1,
      serverGroupId: 42,
      checkIntervalHours: 6,
      lastCheckTime: null,
      lastWinnerClientDbId: null,
      lastWinnerNickname: null,
    });
    db.close();
  });
});
