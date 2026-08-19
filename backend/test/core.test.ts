import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockTs3Server } from './mock-ts3-server.js';
import { AppDatabase, migrateStatsSchema, openDatabase, SCHEMA } from '../src/db/database.js';
import { getTs3ServerKey, Ts3ClientWrapper } from '../src/ts3/client.js';
import { StatsService } from '../src/services/stats.js';
import { ElasticChannelService } from '../src/features/elastic-channels/service.js';
import { AchievementService } from '../src/features/achievements/service.js';
import { WeeklyChampionService } from '../src/features/weekly-champion/service.js';
import { WsHub } from '../src/ws/hub.js';

describe('TS3 监控后端核心链路', () => {
  const mock = new MockTs3Server(10012);
  const db = openDatabase(':memory:');
  let ts3: Ts3ClientWrapper;

  beforeAll(async () => {
    await mock.start();
    mock.addChannel('Lobby', 0, 0);
    mock.addChannel('#开黑-1', 0, 1);
    mock.addClient('Alice', 1, '1');
    mock.addClient('Bob', 2, '1');

    ts3 = new Ts3ClientWrapper({
      host: '127.0.0.1',
      queryPort: 10012,
      username: 'serveradmin',
      password: '',
    });
    await ts3.start();
  }, 20000);

  afterAll(() => {
    ts3.stop();
    mock.stop();
    db.close();
  });

  it('连接模拟服务器并读取状态', async () => {
    const state = await ts3.getServerState();
    expect(state).not.toBeNull();
    expect(state!.clientsOnline).toBe(2);
    expect(state!.maxClients).toBe(32);
  });

  it('统计表重建失败时回滚，并恢复旧版本遗留的临时表数据', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts3-monitor-migration-'));
    const failedPath = join(dir, 'failed.db');
    const recoveryPath = join(dir, 'recovery.db');
    const failedDb = new AppDatabase(failedPath);
    try {
      failedDb.exec(`CREATE TABLE channel_activity (
        channel_id INTEGER NOT NULL,
        channel_name TEXT NOT NULL,
        parent_id INTEGER,
        total_member_minutes INTEGER NOT NULL,
        last_updated INTEGER NOT NULL
      )`);
      failedDb.exec(`INSERT INTO channel_activity VALUES (9, '旧频道', 0, 10, 1), (9, '旧频道', 0, 20, 2)`);
      failedDb.exec(SCHEMA);

      expect(() => migrateStatsSchema(failedDb)).toThrow();
      expect(failedDb.prepare('SELECT COUNT(*) AS count FROM channel_activity').get<{ count: number }>()?.count).toBe(2);
      expect(failedDb.prepare("SELECT name FROM sqlite_master WHERE name IN ('channel_activity__old', 'channel_activity__new')").all()).toHaveLength(0);
    } finally {
      failedDb.close();
    }

    const interruptedDb = new AppDatabase(recoveryPath);
    interruptedDb.exec(`CREATE TABLE online_clients__old (
      client_database_id INTEGER PRIMARY KEY,
      unique_identifier TEXT NOT NULL,
      nickname TEXT NOT NULL,
      servergroup_ids TEXT,
      channel_id INTEGER,
      channel_name TEXT,
      connected_time INTEGER,
      last_seen INTEGER NOT NULL
    )`);
    interruptedDb.exec("INSERT INTO online_clients__old VALUES (7, 'uid-7', '恢复用户', '1', 1, '大厅', 1, 2)");
    interruptedDb.close();

    try {
      const recoveredDb = openDatabase(recoveryPath);
      expect(recoveredDb.prepare('SELECT server_key, nickname FROM online_clients WHERE client_database_id = 7').get()).toEqual({
        server_key: 'legacy',
        nickname: '恢复用户',
      });
      expect(recoveredDb.prepare("SELECT name FROM sqlite_master WHERE name = 'online_clients__old'").all()).toHaveLength(0);
      recoveredDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('指定虚拟服务器 ID 时按 SID 选择，并隔离统计数据键', async () => {
    const sidMock = new MockTs3Server(10014);
    const sidClient = new Ts3ClientWrapper({
      host: '127.0.0.1',
      queryPort: 10014,
      serverPort: 9987,
      serverId: 42,
      username: 'serveradmin',
      password: '',
    });
    await sidMock.start();
    try {
      await sidClient.start();
      expect(sidMock.selectedServer).toEqual({ type: 'sid', value: 42 });
      expect(getTs3ServerKey(sidClient.getConfig())).toBe('127.0.0.1:10014:sid:42');
    } finally {
      sidClient.stop();
      sidMock.stop();
    }
  });

  it('读取客户端列表', async () => {
    const clients = await ts3.getClients();
    expect(clients.length).toBe(2);
    expect(clients.map((c) => c.nickname)).toEqual(expect.arrayContaining(['Alice', 'Bob']));
  });

  it('通过 ServerQuery 读取客户端数据库中的 UID', async () => {
    const clients = await ts3.getClientDbList();
    expect(clients).toEqual(expect.arrayContaining([
      expect.objectContaining({ nickname: 'Alice', uniqueIdentifier: 'uid_1000' }),
      expect.objectContaining({ nickname: 'Bob', uniqueIdentifier: 'uid_1001' }),
    ]));
  });

  it('读取频道列表', async () => {
    const channels = await ts3.getChannels();
    expect(channels.some((c) => c.name === 'Lobby')).toBe(true);
    expect(channels.some((c) => c.name === '#开黑-1')).toBe(true);
  });

  it('统计服务记录快照并累计时长', async () => {
    const stats = new StatsService(db);
    const clients = await ts3.getClients();
    const channels = await ts3.getChannels();
    stats.recordSnapshot(clients, channels, Date.now());
    stats.recordSnapshot(clients, channels, Date.now() + 5000);

    const top = stats.getTopUsers('all');
    expect(top.length).toBe(2);
    expect(top[0].seconds).toBeGreaterThanOrEqual(4);
  });

  it('断线清理不会保留在线用户或继续累计时长', async () => {
    const stats = new StatsService(db);
    const clients = await ts3.getClients();
    const channels = await ts3.getChannels();
    stats.recordSnapshot(clients, channels, Date.now());
    expect(stats.getCurrentOnline().length).toBeGreaterThan(0);

    stats.clearOnlineState();
    expect(stats.getCurrentOnline()).toHaveLength(0);
  });

  it('查询连接短暂中断后恢复时会补算同一连接的缺失时段', () => {
    const gapDb = openDatabase(':memory:');
    const stats = new StatsService(gapDb);
    const now = Date.now();
    const client = {
      clid: 900,
      clientDatabaseId: 900,
      uniqueIdentifier: 'uid-gap',
      nickname: 'GapUser',
      serverGroupIds: [1],
      channelId: 1,
      channelName: 'Lobby',
      channelGroupId: 1,
      connectedTime: Math.floor(now / 1000) - 100,
      clientType: 0,
    };
    const channel = { cid: 1, parentId: 0, name: 'Lobby', totalClients: 1, totalClientsFamily: 1, order: 0 };

    stats.recordSnapshot([client], [channel], now);
    stats.recordSnapshot([client], [channel], now + 10_000);
    stats.clearOnlineState();
    stats.recordSnapshot([client], [channel], now + 70_000);

    const top = stats.getTopUsers('all').find((row) => row.nickname === 'GapUser');
    expect(top?.seconds).toBe(170);
    gapDb.close();
  });

  it('用户重新连接时不会把离线间隔计入在线时长', () => {
    const reconnectDb = openDatabase(':memory:');
    const stats = new StatsService(reconnectDb);
    const now = Date.now();
    const channel = { cid: 1, parentId: 0, name: 'Lobby', totalClients: 1, totalClientsFamily: 1, order: 0 };
    const base = {
      clid: 901,
      clientDatabaseId: 901,
      uniqueIdentifier: 'uid-reconnect',
      nickname: 'ReconnectUser',
      serverGroupIds: [1],
      channelId: 1,
      channelName: 'Lobby',
      channelGroupId: 1,
      clientType: 0,
    };

    stats.recordSnapshot([{ ...base, connectedTime: Math.floor(now / 1000) - 100 }], [channel], now);
    stats.recordSnapshot([{ ...base, connectedTime: Math.floor(now / 1000) - 100 }], [channel], now + 10_000);
    stats.recordSnapshot([{ ...base, connectedTime: Math.floor(now / 1000) + 20 }], [channel], now + 70_000);

    const top = stats.getTopUsers('all').find((row) => row.nickname === 'ReconnectUser');
    expect(top?.seconds).toBe(160);
    reconnectDb.close();
  });

  it('用户离线时将最后一个采样间隔补记到频道统计', () => {
    const offlineDb = openDatabase(':memory:');
    const stats = new StatsService(offlineDb);
    const now = Date.now();
    const channel = { cid: 9, parentId: 0, name: '离线测试', totalClients: 1, totalClientsFamily: 1, order: 0 };
    const client = {
      clid: 902,
      clientDatabaseId: 902,
      uniqueIdentifier: 'uid-offline',
      nickname: 'OfflineUser',
      serverGroupIds: [1],
      channelId: 9,
      channelName: '离线测试',
      channelGroupId: 1,
      connectedTime: Math.floor(now / 1000) - 100,
      clientType: 0,
    };

    stats.recordSnapshot([client], [channel], now);
    stats.recordSnapshot([], [channel], now + 30_000);

    const total = stats.getTopUsers('all').find((row) => row.clientDatabaseId === 902);
    const channelSeconds = offlineDb.prepare(
      'SELECT total_member_minutes as seconds FROM channel_activity WHERE channel_id = ?'
    ).get<{ seconds: number }>(9);
    const userChannelSeconds = offlineDb.prepare(
      'SELECT seconds FROM user_channel_activity WHERE client_database_id = ? AND channel_id = ?'
    ).get<{ seconds: number }>(902, 9);
    expect(total?.seconds).toBe(130);
    expect(channelSeconds?.seconds).toBe(130);
    expect(userChannelSeconds?.seconds).toBe(130);
    offlineDb.close();
  });

  it('首次采集跨天时会按日期拆分活动时长', async () => {
    const splitDb = openDatabase(':memory:');
    const stats = new StatsService(splitDb);
    const clients = await ts3.getClients();
    const channels = await ts3.getChannels();
    const now = Date.now();
    const longSessionClient = { ...clients[0], connectedTime: Math.floor(now / 1000) - 86400 - 10 };

    stats.recordSnapshot([longSessionClient], channels, now);
    const dailyRows = splitDb
      .prepare('SELECT day, active_seconds as seconds FROM user_daily_activity WHERE client_database_id = ? ORDER BY day')
      .all(longSessionClient.clientDatabaseId) as Array<{ day: string; seconds: number }>;

    expect(dailyRows.length).toBeGreaterThanOrEqual(2);
    expect(dailyRows.reduce((sum, row) => sum + row.seconds, 0)).toBeGreaterThanOrEqual(86400);
    splitDb.close();
  });

  it('同名用户按 TeamSpeak UID 查询时不会混合统计数据', async () => {
    const profileDb = openDatabase(':memory:');
    const stats = new StatsService(profileDb);
    const clients = await ts3.getClients();
    const channels = await ts3.getChannels();
    const now = Date.now();
    const first = {
      ...clients[0],
      clientDatabaseId: 101,
      nickname: 'TeamSpeakUser',
      uniqueIdentifier: 'uid-first',
      connectedTime: Math.floor(now / 1000) - 120,
    };
    const second = {
      ...clients[1],
      clientDatabaseId: 202,
      nickname: 'TeamSpeakUser',
      uniqueIdentifier: 'uid-second',
      connectedTime: Math.floor(now / 1000) - 60,
    };

    stats.recordSnapshot([first, second], channels, now);
    const profile = stats.getUserStats('TeamSpeakUser', 'uid-second');

    expect(profile?.uid).toBe('uid-second');
    expect(profile?.dbid).toBe(202);
    expect(stats.suggestNicknames('TeamSpeakUser')).toEqual(
      expect.arrayContaining([
        { nickname: 'TeamSpeakUser', uid: 'uid-first' },
        { nickname: 'TeamSpeakUser', uid: 'uid-second' },
      ])
    );
    profileDb.close();
  });

  it('同名用户在榜单中保持独立，周冠军使用榜首的数据库 ID', async () => {
    const championDb = openDatabase(':memory:');
    const stats = new StatsService(championDb);
    const nowDate = new Date();
    nowDate.setDate(nowDate.getDate() + ((3 - nowDate.getDay() + 7) % 7));
    nowDate.setHours(12, 0, 0, 0);
    const now = nowDate.getTime();
    const channel = { cid: 1, parentId: 0, name: 'Lobby', totalClients: 3, totalClientsFamily: 3, order: 0 };
    const base = {
      clid: 1,
      serverGroupIds: [1],
      channelId: 1,
      channelName: 'Lobby',
      channelGroupId: 1,
      clientType: 0,
    };
    stats.recordSnapshot([
      { ...base, clientDatabaseId: 111, uniqueIdentifier: 'uid-same-1', nickname: 'SameName', connectedTime: Math.floor(now / 1000) - 21_600 },
      { ...base, clientDatabaseId: 222, uniqueIdentifier: 'uid-same-2', nickname: 'SameName', connectedTime: Math.floor(now / 1000) - 21_600 },
      { ...base, clientDatabaseId: 333, uniqueIdentifier: 'uid-winner', nickname: 'Winner', connectedTime: Math.floor(now / 1000) - 36_000 },
    ], [channel], now);

    const sameNameRows = stats.getTopUsers('week', 10).filter((row) => row.nickname === 'SameName');
    expect(sameNameRows).toHaveLength(2);
    expect(sameNameRows.every((row) => row.seconds === 21_600)).toBe(true);

    const grants: Array<[number, number]> = [];
    const champion = new WeeklyChampionService(championDb, {
      addClientToServerGroup: async (groupId: number, clientDbId: number) => {
        grants.push([groupId, clientDbId]);
        return true;
      },
      removeClientFromServerGroup: async () => true,
    } as never, stats);
    champion.saveConfig({ enabled: 1, serverGroupId: 7, checkIntervalHours: 24 });
    await champion.check();
    expect(grants).toEqual([[7, 333]]);
    championDb.close();
  });

  it('周冠军授予或旧冠军移除失败时保留原获奖者并允许下轮重试', async () => {
    const championDb = openDatabase(':memory:');
    const stats = { getTopUsers: () => [{ clientDatabaseId: 200, nickname: '新冠军', seconds: 3600 }] } as never;
    const calls: string[] = [];
    const champion = new WeeklyChampionService(championDb, {
      addClientToServerGroup: async () => {
        calls.push('add');
        return false;
      },
      removeClientFromServerGroup: async () => {
        calls.push('remove');
        return true;
      },
    } as never, stats);
    champion.saveConfig({ enabled: 1, serverGroupId: 7, checkIntervalHours: 24 });
    championDb.prepare('UPDATE champion_config SET last_winner_client_db_id = 100, last_winner_nickname = ? WHERE id = 1').run('旧冠军');

    await champion.check();
    await champion.check();
    expect(calls).toEqual(['add', 'add']);
    expect(champion.getConfig().lastWinnerClientDbId).toBe(100);

    const rollbackCalls: string[] = [];
    const rollbackChampion = new WeeklyChampionService(championDb, {
      addClientToServerGroup: async () => {
        rollbackCalls.push('add-new');
        return true;
      },
      removeClientFromServerGroup: async (_groupId: number, clientDbId: number) => {
        rollbackCalls.push(`remove-${clientDbId}`);
        return clientDbId !== 100;
      },
    } as never, stats);
    const result = await rollbackChampion.check();
    expect(result?.granted).toBe(false);
    expect(rollbackCalls).toEqual(['add-new', 'remove-100', 'remove-200']);
    expect(rollbackChampion.getConfig().lastWinnerClientDbId).toBe(100);
    championDb.close();
  });

  it('周冠军并发检查只授予一次奖励', async () => {
    const championDb = openDatabase(':memory:');
    const stats = { getTopUsers: () => [{ clientDatabaseId: 200, nickname: '并发冠军', seconds: 3600 }] } as never;
    let grants = 0;
    const champion = new WeeklyChampionService(championDb, {
      addClientToServerGroup: async () => {
        grants += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return true;
      },
      removeClientFromServerGroup: async () => true,
    } as never, stats);
    champion.saveConfig({ enabled: 1, serverGroupId: 7, checkIntervalHours: 24 });

    const [first, second] = await Promise.all([champion.check(), champion.check()]);

    expect(grants).toBe(1);
    expect(first).toEqual(second);
    championDb.close();
  });

  it('周期频道排行榜采用最新日期保存的频道名称', () => {
    const channelsDb = openDatabase(':memory:');
    const stats = new StatsService(channelsDb);
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const formatDay = (value: Date): string => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    const earlier = new Date(weekStart);
    earlier.setDate(earlier.getDate() + 1);
    const latest = new Date(weekStart);
    latest.setDate(latest.getDate() + 2);
    channelsDb.prepare('INSERT INTO channel_daily_activity (server_key, channel_id, channel_name, day, member_seconds) VALUES (?, ?, ?, ?, ?)')
      .run('legacy', 5, '旧频道名', formatDay(earlier), 100);
    channelsDb.prepare('INSERT INTO channel_daily_activity (server_key, channel_id, channel_name, day, member_seconds) VALUES (?, ?, ?, ?, ?)')
      .run('legacy', 5, '新频道名', formatDay(latest), 200);

    expect(stats.getTopChannels('week')).toEqual([{ channelName: '新频道名', memberSeconds: 300 }]);
    channelsDb.close();
  });

  it('同步 ServerQuery 身份资料会回填 UID，且不修改本地统计时长', () => {
    const syncDb = openDatabase(':memory:');
    const stats = new StatsService(syncDb, 'server-a');
    const now = Date.now();
    const client = {
      clid: 888,
      clientDatabaseId: 888,
      uniqueIdentifier: '',
      nickname: '旧昵称',
      serverGroupIds: [1],
      channelId: 1,
      channelName: 'Lobby',
      channelGroupId: 1,
      connectedTime: Math.floor(now / 1000) - 120,
      clientType: 0,
    };
    stats.recordSnapshot([client], [], now);
    const before = stats.getTopUsers('all').find((row) => row.nickname === '旧昵称')?.seconds;

    stats.syncClientIdentities([{ clientDatabaseId: 888, uniqueIdentifier: 'serverquery-uid', nickname: '新昵称' }]);

    const profile = stats.getUserStatsByIdentity({ clientDatabaseId: 888, uniqueIdentifier: 'serverquery-uid', nickname: '新昵称' });
    expect(profile.uid).toBe('serverquery-uid');
    expect(profile.nickname).toBe('新昵称');
    expect(profile.total_time.minutes).toBe(Math.round((before || 0) / 60));
    syncDb.close();
  });

  it('统计数据按服务器标识隔离', async () => {
    const scopedDb = openDatabase(':memory:');
    const firstServer = new StatsService(scopedDb, 'server-a');
    const secondServer = new StatsService(scopedDb, 'server-b');
    const clients = await ts3.getClients();
    const channels = await ts3.getChannels();
    const now = Date.now();

    firstServer.recordSnapshot([{ ...clients[0], clientDatabaseId: 7, nickname: 'ServerAUser' }], channels, now);
    secondServer.recordSnapshot([{ ...clients[0], clientDatabaseId: 7, nickname: 'ServerBUser' }], channels, now);

    expect(firstServer.getTopUsers('all')).toEqual(expect.arrayContaining([expect.objectContaining({ nickname: 'ServerAUser' })]));
    expect(firstServer.getTopUsers('all')).not.toEqual(expect.arrayContaining([expect.objectContaining({ nickname: 'ServerBUser' })]));
    expect(secondServer.getTopUsers('all')).toEqual(expect.arrayContaining([expect.objectContaining({ nickname: 'ServerBUser' })]));
    expect(secondServer.getTopUsers('all')).not.toEqual(expect.arrayContaining([expect.objectContaining({ nickname: 'ServerAUser' })]));
    scopedDb.close();
  });

  it('弹性频道服务能识别满员并扩容', async () => {
    const channels = await ts3.getChannels();
    const lobby = channels.find((c) => c.name === 'Lobby')!;
    const room1 = channels.find((c) => c.name === '#开黑-1')!;

    mock.clearClients();
    mock.addClient('Eve', room1.cid, '1');
    mock.addClient('Frank', room1.cid, '1');
    mock.addClient('Grace', lobby.cid, '1');
    mock.addClient('Henry', lobby.cid, '1');

    const elastic = new ElasticChannelService(db, ts3);
    elastic.addGroup({
      name: '开黑',
      namePrefix: '#开黑-',
      createThreshold: 2,
      deleteThreshold: 0,
      maxChannels: 4,
    });

    const actions = await elastic.tick();
    expect(actions.some((a) => a.type === 'create')).toBe(true);
  });

  it('弹性频道保留备用频道且只删除自身创建的频道', async () => {
    const elasticDb = openDatabase(':memory:');
    let channels = [
      { cid: 1, parentId: 0, name: '#room-1', totalClients: 2, totalClientsFamily: 2, order: 1 },
    ];
    const deleted: number[] = [];
    const elastic = new ElasticChannelService(elasticDb, {
      getChannels: async () => channels,
      createChannel: async ({ name }: { name: string }) => {
        const cid = channels.length + 1;
        channels = [...channels, { cid, parentId: 0, name, totalClients: 0, totalClientsFamily: 0, order: cid }];
        return cid;
      },
      deleteChannel: async (cid: number) => {
        deleted.push(cid);
        channels = channels.filter((channel) => channel.cid !== cid);
        return true;
      },
      getChannel: async (cid: number) => {
        const channel = channels.find((item) => item.cid === cid);
        return channel ? { name: channel.name, totalClients: channel.totalClients } : null;
      },
    } as never);
    elastic.addGroup({ name: '房间', namePrefix: '#room-', createThreshold: 2, deleteThreshold: 0, maxChannels: 4 });

    expect((await elastic.tick()).map((action) => action.type)).toEqual(['create']);
    expect((await elastic.tick())).toEqual([]);
    expect(channels).toHaveLength(2);

    channels[0].totalClients = 0;
    expect((await elastic.tick()).map((action) => action.type)).toEqual(['delete']);
    expect(deleted).toEqual([2]);
    expect(channels.map((channel) => channel.cid)).toEqual([1]);
    elasticDb.close();
  });

  it('弹性频道并发检查只创建一个频道', async () => {
    const elasticDb = openDatabase(':memory:');
    let channels = [
      { cid: 1, parentId: 0, name: '#room-1', totalClients: 2, totalClientsFamily: 2, order: 1 },
    ];
    let createCount = 0;
    const elastic = new ElasticChannelService(elasticDb, {
      getChannels: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return channels;
      },
      createChannel: async ({ name }: { name: string }) => {
        createCount += 1;
        const cid = channels.length + 1;
        channels = [...channels, { cid, parentId: 0, name, totalClients: 0, totalClientsFamily: 0, order: cid }];
        return cid;
      },
      deleteChannel: async () => true,
      getChannel: async (cid: number) => {
        const channel = channels.find((item) => item.cid === cid);
        return channel ? { name: channel.name, totalClients: channel.totalClients } : null;
      },
    } as never);
    elastic.addGroup({ name: '房间', namePrefix: '#room-', createThreshold: 2, deleteThreshold: 0, maxChannels: 4 });

    const results = await Promise.all([elastic.tick(), elastic.tick()]);

    expect(createCount).toBe(1);
    expect(results[0]).toHaveLength(1);
    expect(results[0]).toEqual(results[1]);
    elasticDb.close();
  });

  it('弹性频道删除前重新确认实时人数', async () => {
    const elasticDb = openDatabase(':memory:');
    let channels = [
      { cid: 1, parentId: 0, name: '#room-1', totalClients: 2, totalClientsFamily: 2, order: 1 },
    ];
    const deleted: number[] = [];
    const elastic = new ElasticChannelService(elasticDb, {
      getChannels: async () => channels,
      createChannel: async ({ name }: { name: string }) => {
        const cid = channels.length + 1;
        channels = [...channels, { cid, parentId: 0, name, totalClients: 0, totalClientsFamily: 0, order: cid }];
        return cid;
      },
      deleteChannel: async (cid: number) => {
        deleted.push(cid);
        return true;
      },
      getChannel: async (cid: number) => {
        const channel = channels.find((item) => item.cid === cid);
        if (!channel) return null;
        return { name: channel.name, totalClients: cid === 2 ? 1 : channel.totalClients };
      },
    } as never);
    elastic.addGroup({ name: '房间', namePrefix: '#room-', createThreshold: 2, deleteThreshold: 0, maxChannels: 4 });

    await elastic.tick();
    channels[0].totalClients = 0;
    await elastic.tick();

    expect(deleted).toEqual([]);
    elasticDb.close();
  });

  it('成就服务能授予达标用户', async () => {
    const ach = new AchievementService(db, ts3, new StatsService(db));
    ach.addLevel({ hours: 0, serverGroupId: 3, title: '测试成就' });

    const results = await ach.check();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('测试成就');
  });

  it('周冠军服务读取本周榜首', async () => {
    const stats = new StatsService(db);
    const champion = new WeeklyChampionService(db, ts3, stats);
    const current = champion.getCurrentChampion();
    expect(current).not.toBeNull();
  });

  it('首次连接失败后会自动重试并恢复连接', async () => {
    const retryPort = 10013;
    const retryClient = new Ts3ClientWrapper({
      host: '127.0.0.1',
      queryPort: retryPort,
      username: 'serveradmin',
      password: '',
    });
    const retryServer = new MockTs3Server(retryPort);

    try {
      retryClient.on('error', () => undefined);
      void retryClient.start();
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(retryClient.connected).toBe(false);

      await retryServer.start();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('自动重连超时')), 5000);
        retryClient.once('connected', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      expect(retryClient.connected).toBe(true);
    } finally {
      retryClient.stop();
      retryServer.stop();
    }
  }, 10000);

  it('没有 error 监听器时，TS3 管理操作仍返回 false', async () => {
    const disconnected = new Ts3ClientWrapper({
      host: '127.0.0.1',
      queryPort: 65534,
      username: 'serveradmin',
      password: '',
    });
    await expect(disconnected.deleteChannel(1)).resolves.toBe(false);
    await expect(disconnected.removeClientFromServerGroup(1, 1)).resolves.toBe(false);
  });

  it('WebSocket 广播按 Host 过滤连接', async () => {
    const server = http.createServer();
    const hub = new WsHub(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试服务器启动失败');

    const connect = (host: string): Promise<WebSocket> => new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { headers: { Host: host } });
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });
    const root = await connect('root.example.com');
    const subsite = await connect('alpha.example.com');
    try {
      const rootMessage = new Promise<string>((resolve) => root.once('message', (message) => resolve(message.toString())));
      let subsiteReceived = false;
      subsite.once('message', () => { subsiteReceived = true; });
      hub.broadcastWhere((host) => host === 'root.example.com', 'online-update', { online: 1 });
      expect(await rootMessage).toContain('online-update');
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(subsiteReceived).toBe(false);
    } finally {
      root.close();
      subsite.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
