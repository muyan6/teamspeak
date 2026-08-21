import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createRouter, type ApiDeps } from '../src/api/router.js';
import { AuthService, CredentialCipher, initializeAdminPassword } from '../src/services/auth.js';
import { WeeklyChampionService } from '../src/features/weekly-champion/service.js';
import { openDatabase } from '../src/db/database.js';
import { StatsService } from '../src/services/stats.js';
import { loadConfig } from '../src/config.js';
import { buildTutorial } from '../src/site.js';

describe('管理接口与配置回归', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it('首次启动导入管理员密码，后续启动优先使用数据库密码', () => {
    const values = new Map<string, string>();
    const store = {
      get: (key: string) => values.get(key) ?? null,
      set: (key: string, value: string) => values.set(key, value),
    };

    const initialized = initializeAdminPassword(store, 'initial-password');
    expect(initialized).toMatchObject({ initialized: true, migrated: false });
    expect(initialized.password).not.toBe('initial-password');
    expect(store.get('adminPassword')).toBe(initialized.password);
    expect(initializeAdminPassword(store, 'changed-in-env')).toMatchObject({
      password: initialized.password,
      initialized: false,
      migrated: false,
    });

    const legacyValues = new Map<string, string>([['adminPassword', 'legacy-password']]);
    const migrated = initializeAdminPassword({
      get: (key) => legacyValues.get(key) ?? null,
      set: (key, value) => legacyValues.set(key, value),
    }, '');
    expect(migrated).toMatchObject({ initialized: false, migrated: true });
    expect(legacyValues.get('adminPassword')).not.toBe('legacy-password');
    expect(new AuthService(migrated.password, 'test-secret').verifyAdminPassword('legacy-password')).toBe(true);
  });

  it('loadConfig 只读取传入的环境变量对象', () => {
    const config = loadConfig({
      PORT: '4100',
      TS3_QUERY_PORT: '12000',
      TS3_SERVER_PORT: '9988',
      TS3_SERVER_ID: '3',
      TS3_PUBLIC_PORT: '9989',
      COLLECT_INTERVAL_MS: '1500',
      SAMPLE_INTERVAL_MS: '2500',
    });
    expect(config).toMatchObject({
      port: 4100,
      ts3: { queryPort: 12000, serverPort: 9988, serverId: 3 },
      publicServer: { port: 9989 },
      collectIntervalMs: 1500,
      sampleIntervalMs: 2500,
    });
  });

  async function startRouter(): Promise<{
    baseUrl: string;
    token: string;
    auth: AuthService;
    savedChampionConfigs: Array<{ enabled: number; serverGroupId: number | null; checkIntervalHours: number }>;
    siteConfig: Map<string, string>;
    clientDbListCalls: () => number;
  }> {
    const auth = new AuthService('test-password', 'test-secret');
    const siteConfig = new Map<string, string>();
    const credentialCipher = new CredentialCipher('router-test-credential-key');
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
    let clientDbListCalls = 0;
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
      stats: {
        getTopUsers: () => [],
        getTopChannels: () => [],
        getDailyTrends: () => ({ labels: [], data: [] }),
        setServerKey: () => undefined,
      },
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
      ts3: {
        connected: true,
        lastError: '',
        getChannels: async () => [],
        getClientDbList: async () => {
          clientDbListCalls += 1;
          return [
            { clientDatabaseId: 1, uniqueIdentifier: 'uid-1', nickname: '重复昵称', created: 1, lastConnected: 1, totalConnections: 1 },
            { clientDatabaseId: 2, uniqueIdentifier: 'uid-2', nickname: '重复昵称', created: 1, lastConnected: 1, totalConnections: 1 },
          ];
        },
        getConfig: () => ({ host: 'localhost', queryPort: 10011, serverPort: 9987, serverId: 0, username: 'serveradmin', password: '' }),
        updateConfig: () => undefined,
      },
      publicServer: { host: 'localhost', port: 9987 },
      credentialCipher,
      persistAdminPasswordHash: (passwordHash: string) => siteConfig.set('adminPassword', passwordHash),
    } as unknown as ApiDeps;

    const app = express();
    app.use(express.json());
    app.use('/api', createRouter(deps));
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试服务器启动失败');
    return { baseUrl: `http://127.0.0.1:${address.port}/api`, token: auth.signToken(), auth, savedChampionConfigs, siteConfig, clientDbListCalls: () => clientDbListCalls };
  }

  it('已登录管理员改密后持久化哈希、旧令牌失效且新令牌可用', async () => {
    const { baseUrl, token, auth, siteConfig } = await startRouter();

    const invalid = await fetch(`${baseUrl}/auth/password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'test-password', newPassword: 'short' }),
    });
    expect(invalid.status).toBe(400);

    const wrongCurrentPassword = await fetch(`${baseUrl}/auth/password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'new-password-123' }),
    });
    expect(wrongCurrentPassword.status).toBe(400);

    const changed = await fetch(`${baseUrl}/auth/password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'test-password', newPassword: 'new-password-123' }),
    });
    expect(changed.status).toBe(200);
    const { token: replacementToken } = await changed.json() as { token: string };

    expect(replacementToken).not.toBe(token);
    expect(siteConfig.get('adminPassword')).toMatch(/^scrypt\$/);
    expect(siteConfig.get('adminPassword')).not.toContain('new-password-123');
    expect(auth.verifyAdminPassword('test-password')).toBe(false);
    expect(auth.verifyAdminPassword('new-password-123')).toBe(true);
    expect((await fetch(`${baseUrl}/auth/check`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await fetch(`${baseUrl}/auth/check`, { headers: { Authorization: `Bearer ${replacementToken}` } })).status).toBe(200);
  });

  it('登录接口限制密码长度、异步校验密码并限制连续失败次数', async () => {
    const { baseUrl } = await startRouter();
    const request = (password: unknown) => fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    expect((await request('short')).status).toBe(401);
    expect((await request('x'.repeat(257))).status).toBe(401);
    expect((await request('wrong-password')).status).toBe(401);
    expect((await request('wrong-password')).status).toBe(401);
    expect((await request('wrong-password')).status).toBe(401);

    const limited = await request('test-password');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

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

  it('弹性频道接口拒绝空白前缀和非法阈值、频道 ID、最大数量', async () => {
    const { baseUrl, token } = await startRouter();
    const invalidPayloads = [
      { name: '房间', namePrefix: '   ', createThreshold: 2, deleteThreshold: 0, maxChannels: 8 },
      { name: '房间', namePrefix: '#room-', createThreshold: -1, deleteThreshold: 0, maxChannels: 8 },
      { name: '房间', namePrefix: '#room-', createThreshold: 2, deleteThreshold: 2, maxChannels: 8 },
      { name: '房间', namePrefix: '#room-', createThreshold: 2, deleteThreshold: 0, baseChannelId: -1, maxChannels: 8 },
      { name: '房间', namePrefix: '#room-', createThreshold: 2, deleteThreshold: 0, maxChannels: -1 },
    ];

    for (const payload of invalidPayloads) {
      const response = await fetch(`${baseUrl}/elastic/groups`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(400);
    }
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

  it('周冠军检查周期仅允许 1 到 168 小时的整数', async () => {
    const { baseUrl, token } = await startRouter();
    for (const checkIntervalHours of [0, 0.001, 169]) {
      const response = await fetch(`${baseUrl}/champion/config`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 0, serverGroupId: 0, checkIntervalHours }),
      });
      expect(response.status).toBe(400);
    }
  });

  it('周冠军配置读取接口要求管理员凭证', async () => {
    const { baseUrl, token } = await startRouter();
    expect((await fetch(`${baseUrl}/champion/config`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/champion/config`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
  });

  it('同名用户查询只拉取一次成员数据库', async () => {
    const { baseUrl, clientDbListCalls } = await startRouter();
    const response = await fetch(`${baseUrl}/stats/user?nickname=${encodeURIComponent('重复昵称')}`);
    expect(response.status).toBe(409);
    expect(clientDbListCalls()).toBe(1);
  });

  it('TS3 连接密码以密文写入配置存储', async () => {
    const { baseUrl, token, siteConfig } = await startRouter();
    const response = await fetch(`${baseUrl}/admin/ts3-config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'ts3.example.com',
        queryPort: 10011,
        serverPort: 9987,
        serverId: 3,
        username: 'serveradmin',
        password: 'query-password',
      }),
    });
    expect(response.status).toBe(200);
    const stored = siteConfig.get('ts3Connection') || '';
    expect(stored).not.toContain('query-password');
    expect(JSON.parse(stored).password).toMatch(/^enc:v1:/);
    expect(JSON.parse(stored).serverId).toBe(3);
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

    const invalidTutorial = await fetch(`${baseUrl}/tutorial-config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorial: { basic: 123 } }),
    });
    expect(invalidTutorial.status).toBe(400);

    const unsafeDownload = await fetch(`${baseUrl}/tutorial-config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientDownload: { officialUrl: 'javascript:alert(1)' } }),
    });
    expect(unsafeDownload.status).toBe(400);

    const fallbackTutorial = buildTutorial(
      loadConfig({ TS3_PUBLIC_HOST: 'localhost' }),
      { basic: 123 } as never
    );
    expect(fallbackTutorial.sections.find((section) => section.key === 'basic')?.content).toContain('打开设置');

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

    const unsafeContact = await fetch(`${baseUrl}/site-config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...siteInfoPayload, adminSteam: 'javascript:alert(1)' }),
    });
    expect(unsafeContact.status).toBe(400);

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
});
