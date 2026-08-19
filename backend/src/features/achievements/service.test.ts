import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../db/database.js';
import { StatsService } from '../../services/stats.js';
import { AchievementService } from './service.js';
import type { Ts3ClientWrapper } from '../../ts3/client.js';

describe('成就服务', () => {
  it('只处理当前 TS3 服务器的数据与解锁记录', async () => {
    const db = openDatabase(':memory:');
    const stats = new StatsService(db);
    stats.setServerKey('server-a');
    const grants: Array<{ serverGroupId: number; clientDatabaseId: number }> = [];
    const ts3 = {
      addClientToServerGroup: async (serverGroupId: number, clientDatabaseId: number) => {
        grants.push({ serverGroupId, clientDatabaseId });
        return true;
      },
    } as unknown as Ts3ClientWrapper;
    const service = new AchievementService(db, ts3, stats);

    service.addLevel({ hours: 1, serverGroupId: 9, title: '在线一小时' });
    const insertDuration = db.prepare(
      `INSERT INTO user_online_duration (
        server_key, client_database_id, unique_identifier, nickname,
        total_seconds, week_seconds, longest_session_seconds, last_updated
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
    );
    insertDuration.run('server-a', 7, 'uid-a', '当前服务器用户', 3_600, Date.now());
    insertDuration.run('server-b', 8, 'uid-b', '其他服务器用户', 7_200, Date.now());

    await service.check();

    expect(grants).toEqual([{ serverGroupId: 9, clientDatabaseId: 7 }]);
    expect(service.getUnlockedUsers()).toEqual([
      { nickname: '当前服务器用户', title: '在线一小时', hours: 1 },
    ]);
    db.close();
  });

  it('手动检查和定时检查并发时只授予一次服务器组', async () => {
    const db = openDatabase(':memory:');
    const stats = new StatsService(db, 'server-a');
    let grantCalls = 0;
    const ts3 = {
      addClientToServerGroup: async () => {
        grantCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return true;
      },
    } as unknown as Ts3ClientWrapper;
    const service = new AchievementService(db, ts3, stats);
    service.addLevel({ hours: 1, serverGroupId: 9, title: '在线一小时' });
    db.prepare(
      `INSERT INTO user_online_duration (
        server_key, client_database_id, unique_identifier, nickname,
        total_seconds, week_seconds, longest_session_seconds, last_updated
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
    ).run('server-a', 7, 'uid-a', '当前服务器用户', 3_600, Date.now());

    const [first, second] = await Promise.all([service.check(), service.check()]);

    expect(grantCalls).toBe(1);
    expect(first).toEqual(second);
    expect(db.prepare('SELECT COUNT(*) AS count FROM achievement_grants').get()).toEqual({ count: 1 });
    db.close();
  });

  it('为主页汇总最高荣誉、连续在线前三与各成就解锁人数', async () => {
    const db = openDatabase(':memory:');
    const stats = new StatsService(db, 'server-a');
    const service = new AchievementService(db, {} as Ts3ClientWrapper, stats);
    const bronze = service.addLevel({ hours: 10, serverGroupId: 1, title: '新星' });
    const gold = service.addLevel({ hours: 100, serverGroupId: 2, title: '荣耀之冠' });

    const insertDuration = db.prepare(
      `INSERT INTO user_online_duration (
        server_key, client_database_id, unique_identifier, nickname,
        total_seconds, week_seconds, longest_session_seconds, last_updated
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
    );
    insertDuration.run('server-a', 1, 'uid-1', '小林', 520_800, Date.now());
    insertDuration.run('server-a', 2, 'uid-2', '小周', 367_200, Date.now());
    insertDuration.run('server-a', 3, 'uid-3', '小陈', 201_600, Date.now());
    insertDuration.run('server-b', 4, 'uid-4', '其他服务器用户', 999_999, Date.now());

    const dayKey = (daysAgo: number): string => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - daysAgo);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${date.getFullYear()}-${month}-${day}`;
    };
    const insertActivity = db.prepare(
      `INSERT INTO user_daily_activity (server_key, client_database_id, nickname, day, active_seconds)
       VALUES (?, ?, ?, ?, 600)`
    );
    for (const daysAgo of [0, 1, 2]) insertActivity.run('server-a', 1, '小林', dayKey(daysAgo));
    for (const daysAgo of [1, 2, 3, 4]) insertActivity.run('server-a', 2, '小周', dayKey(daysAgo));
    for (const daysAgo of [0, 2]) insertActivity.run('server-a', 3, '小陈', dayKey(daysAgo));
    for (const daysAgo of [0, 1, 2, 3, 4]) insertActivity.run('server-a', 5, 'MusicBot', dayKey(daysAgo));
    for (const daysAgo of [0, 1, 2, 3, 4, 5]) insertActivity.run('server-b', 4, '其他服务器用户', dayKey(daysAgo));

    const grant = db.prepare(
      'INSERT INTO achievement_grants (server_key, client_database_id, level_id, granted_at) VALUES (?, ?, ?, ?)'
    );
    grant.run('server-a', 1, bronze.id, 1);
    grant.run('server-a', 1, gold.id, 2);
    grant.run('server-a', 2, bronze.id, 3);
    grant.run('server-b', 4, gold.id, 4);

    expect(service.getHallOfFame()).toEqual({
      featured: { nickname: '小林', title: '荣耀之冠', hours: 100 },
      rankings: [
        { nickname: '小周', days: 4 },
        { nickname: '小林', days: 3 },
        { nickname: '小陈', days: 1 },
      ],
      levels: [
        { id: gold.id, title: '荣耀之冠', hours: 100, unlockedCount: 1 },
        { id: bronze.id, title: '新星', hours: 10, unlockedCount: 2 },
      ],
      unlockedCount: 2,
    });
    db.close();
  });
});
