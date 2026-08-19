import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createRouter, type ApiDeps } from '../src/api/router.js';
import { AuthService } from '../src/services/auth.js';
import { WeeklyChampionService } from '../src/features/weekly-champion/service.js';
import { openDatabase } from '../src/db/database.js';
import { StatsService } from '../src/services/stats.js';

describe('管理接口与配置回归', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  async function startRouter(): Promise<{
    baseUrl: string;
    token: string;
    savedChampionConfigs: Array<{ enabled: number; serverGroupId: number | null; checkIntervalHours: number }>;
  }> {
    const auth = new AuthService('test-password', 'test-secret');
    const siteConfig = new Map<string, string>();
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

    const savedChampionConfigs: Array<{ enabled: number; serverGroupId: number | null; checkIntervalHours: number }> = [];
    const deps = {
      auth,
      configStore: {
        get: (key: string) => siteConfig.get(key) ?? null,
        getJson: (key: string, fallback: unknown) => {
          const value = siteConfig.get(key);
          return value ? JSON.parse(value) : fallback;
        },
        set: (key: string, value: string) => siteConfig.set(key, value),
        setJson: (key: string, value: unknown) => siteConfig.set(key, JSON.stringify(value)),
      },
      stats: { getTopUsers: () => [], getTopChannels: () => [], getDailyTrends: () => ({ labels: [], data: [] }) },
      elastic: { listGroups: () => elasticGroups, addGroup: () => elasticGroups[0], removeGroup: () => false },
      champion: {
        getConfig: () => ({}),
        saveConfig: (config: { enabled: number; serverGroupId: number | null; checkIntervalHours: number }) => {
          savedChampionConfigs.push(config);
          return config;
        },
        check: async () => null,
      },
      achievement: {
        listLevels: () => [],
        getUnlockedUsers: () => [],
        addLevel: () => ({ id: 1, hours: 1, serverGroupId: 1, title: '测试成就', enabled: 1 }),
        updateLevel: () => true,
        removeLevel: () => true,
        check: async () => [],
      },
      dashboard: { getSiteSlug: () => 'test', getSiteDomain: () => '', getData: async () => ({}) },
      ts3: { connected: true, getChannels: async () => [] },
      publicServer: { host: 'localhost', port: 9987 },
      subsite: { getConfig: () => ({ slug: 'test', domain: '' }), saveConfig: () => ({ slug: 'test', domain: '' }) },
    } as unknown as ApiDeps;

    const app = express();
    app.use(express.json());
    app.use('/api', createRouter(deps));
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试服务器启动失败');
    return { baseUrl: `http://127.0.0.1:${address.port}/api`, token: auth.signToken(), savedChampionConfigs };
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

  it('关闭周冠军时允许暂未配置奖励服务器组', async () => {
    const { baseUrl, token, savedChampionConfigs } = await startRouter();
    const response = await fetch(`${baseUrl}/champion/config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 0, serverGroupId: 0, checkIntervalHours: 24 }),
    });
    expect(response.status).toBe(200);
    expect(savedChampionConfigs).toEqual([{ enabled: 0, serverGroupId: null, checkIntervalHours: 24 }]);
  });

  it('教程与站点信息配置需要管理员凭证并能完整读写', async () => {
    const { baseUrl, token } = await startRouter();
    const tutorialPayload = {
      tutorial: {
        download: '下载教程内容',
        basic: '基础教程内容',
        advanced: '进阶教程内容',
      },
      clientDownload: {
        version: '3.6.2',
        officialUrl: 'https://example.com/official.exe',
        mirrorUrl: 'https://example.com/mirror.exe',
        translationUrl: 'https://example.com/zh.ts3_translation',
      },
    };
    const siteInfoPayload = {
      title: 'Voice',
      footerDescription: 'TeamSpeak3 语音服务器',
      serverName: '偏居一隅',
      serverAddress: '996',
      adminName: '管理员',
      adminSteam: 'https://steamcommunity.com/id/example',
    };

    expect((await fetch(`${baseUrl}/tutorial-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tutorialPayload),
    })).status).toBe(401);

    const saved = await fetch(`${baseUrl}/tutorial-config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(tutorialPayload),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual(tutorialPayload);

    const loaded = await fetch(`${baseUrl}/tutorial-config`);
    expect(await loaded.json()).toEqual(tutorialPayload);

    expect((await fetch(`${baseUrl}/site-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(siteInfoPayload),
    })).status).toBe(401);

    const savedSiteInfo = await fetch(`${baseUrl}/site-config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(siteInfoPayload),
    });
    expect(savedSiteInfo.status).toBe(200);
    expect(await savedSiteInfo.json()).toEqual(siteInfoPayload);

    const loadedSiteInfo = await fetch(`${baseUrl}/site-config`);
    expect(await loadedSiteInfo.json()).toEqual(siteInfoPayload);
  });

  it('成就管理接口需要管理员凭证并校验新增数据', async () => {
    const { baseUrl, token } = await startRouter();
    expect((await fetch(`${baseUrl}/achievements/levels`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/achievements/levels`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', hours: -1, serverGroupId: 0 }),
    })).status).toBe(400);
    expect((await fetch(`${baseUrl}/achievements/levels`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '十小时在线', hours: 10, serverGroupId: 3 }),
    })).status).toBe(201);
  });

  it('分站配置接口要求管理员凭证并能读写当前实例配置', async () => {
    const { baseUrl, token } = await startRouter();
    expect((await fetch(`${baseUrl}/admin/subsite`)).status).toBe(401);
    const response = await fetch(`${baseUrl}/admin/subsite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'server-a', domain: 'a.example.com' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ slug: 'test', domain: '' });
  });
});
