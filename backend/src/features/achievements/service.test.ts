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

  it('TS3 授予失败时不写入本地成就记录，并在下一轮重试', async () => {
    const db = openDatabase(':memory:');
    const stats = new StatsService(db, 'server-a');
    let grantCalls = 0;
    const ts3 = {
      addClientToServerGroup: async () => {
        grantCalls += 1;
        return grantCalls > 1;
      },
    } as unknown as Ts3ClientWrapper;
    const service = new AchievementService(db, ts3, stats);
    const level = service.addLevel({ hours: 1, serverGroupId: 9, title: '在线一小时' });
    db.prepare(
      `INSERT INTO user_online_duration (
        server_key, client_database_id, unique_identifier, nickname,
        total_seconds, week_seconds, longest_session_seconds, last_updated
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
    ).run('server-a', 7, 'uid-a', '当前服务器用户', 3_600, Date.now());

    await service.check();
    expect(db.prepare('SELECT COUNT(*) AS count FROM achievement_grants WHERE level_id = ?').get(level.id)).toEqual({ count: 0 });

    await service.check();
    expect(grantCalls).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM achievement_grants WHERE level_id = ?').get(level.id)).toEqual({ count: 1 });
    db.close();
  });

  it('TS3 撤销失败时保留本地成就记录，并在下一轮重试', async () => {
    const db = openDatabase(':memory:');
    const stats = new StatsService(db, 'server-a');
    let removeCalls = 0;
    const ts3 = {
      addClientToServerGroup: async () => true,
      removeClientFromServerGroup: async () => {
        removeCalls += 1;
        return removeCalls > 1;
      },
    } as unknown as Ts3ClientWrapper;
    const service = new AchievementService(db, ts3, stats);
    const level = service.addLevel({ hours: 1, serverGroupId: 9, title: '在线一小时' });
    db.prepare(
      `INSERT INTO user_online_duration (
        server_key, client_database_id, unique_identifier, nickname,
        total_seconds, week_seconds, longest_session_seconds, last_updated
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
    ).run('server-a', 7, 'uid-a', '当前服务器用户', 3_600, Date.now());

    await service.check();
    db.prepare('UPDATE user_online_duration SET total_seconds = 0 WHERE server_key = ? AND client_database_id = ?').run('server-a', 7);

    await service.check();
    expect(db.prepare('SELECT COUNT(*) AS count FROM achievement_grants WHERE level_id = ?').get(level.id)).toEqual({ count: 1 });

    await service.check();
    expect(removeCalls).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM achievement_grants WHERE level_id = ?').get(level.id)).toEqual({ count: 0 });
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
    insertDuration.run('server-a', 5, '/4MNT/c3KE4sXuRGHedmmnFDZYc=', 'MusicBot', 600_000, Date.now());

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

    const goldUsers = service.getLevelUsers(gold.id);
    expect(goldUsers).toHaveLength(1);
    expect(goldUsers[0].nickname).toBe('小林');
    expect(goldUsers[0].uniqueIdentifier).toBe('uid-1');
    expect(goldUsers[0].hours).toBe(144.7);

    const bronzeUsers = service.getLevelUsers(bronze.id);
    expect(bronzeUsers).toHaveLength(2);
    expect(bronzeUsers.map((u) => u.nickname)).toEqual(['小林', '小周']);
    db.close();
  });

  it('支持后台查看、新增与修改勋章，并自动判定授予符合条件的用户', async () => {
    const db = openDatabase(':memory:');
    const stats = new StatsService(db, 'server-a');
    const service = new AchievementService(db, {} as Ts3ClientWrapper, stats);

    // 1. 验证默认播种的 6 个系统勋章
    const badges = service.listBadges();
    expect(badges.length).toBeGreaterThanOrEqual(6);
    expect(badges.some((b) => b.badgeKey === 'night_owl')).toBe(true);
    expect(badges.some((b) => b.badgeKey === 'streak_master')).toBe(true);

    // 2. 插入测试用户与活跃天数
    db.prepare(`
      INSERT INTO user_online_duration (
        server_key, client_database_id, unique_identifier, nickname,
        total_seconds, week_seconds, longest_session_seconds, last_updated
      ) VALUES ('server-a', 10, 'uid-10', '勋章达人', 72000, 0, 0, ?)
    `).run(Date.now());

    // 插入连续 8 天打卡
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      db.prepare('INSERT INTO user_daily_activity (server_key, client_database_id, nickname, day, active_seconds) VALUES (?, ?, ?, ?, ?)')
        .run('server-a', 10, '勋章达人', dayStr, 3600);
    }

    // 3. 验证默认“连击达人”(>=7天)已自动解锁
    const userBadges = service.getUserBadges(10);
    const streakBadge = userBadges.find((b) => b.name === '连击达人');
    expect(streakBadge?.unlocked).toBe(true);

    // 4. 自定义新增勋章：在线超 15 小时（total_hours >= 15）
    const customBadge = service.addBadge({
      name: '破晓之星',
      category: 'custom',
      icon: 'ph-star',
      color: '#38bdf8',
      description: '累计在线达 15 小时',
      conditionType: 'total_hours',
      conditionParams: { threshold: 15 },
    });
    expect(customBadge.id).toBeGreaterThan(0);

    // 用户有 72000s = 20 小时，应达成破晓之星
    const updatedUserBadges = service.getUserBadges(10);
    const starBadge = updatedUserBadges.find((b) => b.name === '破晓之星');
    expect(starBadge?.unlocked).toBe(true);

    // 5. 执行 check() 自动向用户写入 badge_grants
    const checkRes = await service.check();
    expect(checkRes.some((r) => r.nickname === '勋章达人' && r.title === '破晓之星')).toBe(true);

    // 再次查询已持久化解锁记录
    const unlockedBadges = service.getUnlockedBadges(10);
    expect(unlockedBadges.some((b) => b.name === '破晓之星')).toBe(true);

    // 6. 管理员修改条件（提高阈值到 50 小时，用户只有 20 小时）
    service.updateBadge(customBadge.id, {
      name: '破晓之星',
      category: 'custom',
      icon: 'ph-star',
      color: '#38bdf8',
      description: '累计在线达 50 小时',
      conditionType: 'total_hours',
      conditionParams: { threshold: 50 },
      enabled: 1,
    });

    // 重新判定：用户不再达成破晓之星
    const afterRaiseBadges = service.getUserBadges(10);
    const starBadgeAfterRaise = afterRaiseBadges.find((b) => b.name === '破晓之星');
    expect(starBadgeAfterRaise?.unlocked).toBe(false);

    // 执行 check() 应自动从 badge_grants 回收
    await service.check();
    const afterCheckUnlocked = service.getUnlockedBadges(10);
    expect(afterCheckUnlocked.some((b) => b.name === '破晓之星')).toBe(false);

    db.close();
  });

  it('用户跨越多个成就等级时仅授予最高等级并自动撤销较低等级 TS3 组', async () => {
    const db = openDatabase(':memory:');
    const stats = new StatsService(db, 'server-a');
    const grantedGroups: number[] = [];
    const removedGroups: number[] = [];
    const ts3 = {
      addClientToServerGroup: async (sgid: number) => {
        grantedGroups.push(sgid);
        return true;
      },
      removeClientFromServerGroup: async (sgid: number) => {
        removedGroups.push(sgid);
        return true;
      },
    } as unknown as Ts3ClientWrapper;
    const service = new AchievementService(db, ts3, stats);

    const l1 = service.addLevel({ hours: 10, serverGroupId: 101, title: '青铜等级' });
    const l2 = service.addLevel({ hours: 50, serverGroupId: 102, title: '白银等级' });
    const l3 = service.addLevel({ hours: 100, serverGroupId: 103, title: '黄金等级' });

    // 用户初始在线 60 小时 (已达成 l1 和 l2，最高为 l2)
    db.prepare(`
      INSERT INTO user_online_duration (
        server_key, client_database_id, unique_identifier, nickname,
        total_seconds, week_seconds, longest_session_seconds, last_updated
      ) VALUES ('server-a', 1, 'uid-1', '测试玩家', 216000, 0, 0, ?)
    `).run(Date.now());

    await service.check();

    // 应该只授予 l2 (sg=102)，而不授予 l1 (sg=101)
    expect(grantedGroups).toEqual([102]);
    expect(removedGroups).toEqual([]);
    expect(db.prepare('SELECT level_id FROM achievement_grants WHERE server_key = ? AND client_database_id = ?').all('server-a', 1)).toEqual([{ level_id: l2.id }]);

    // 用户在线时间增加到 120 小时 (达成 l3，最高变为 l3)
    db.prepare('UPDATE user_online_duration SET total_seconds = 432000 WHERE server_key = ? AND client_database_id = ?').run('server-a', 1);

    await service.check();

    // 应该移除 l2 (sg=102)，并授予 l3 (sg=103)
    expect(removedGroups).toEqual([102]);
    expect(grantedGroups).toEqual([102, 103]);
    expect(db.prepare('SELECT level_id FROM achievement_grants WHERE server_key = ? AND client_database_id = ?').all('server-a', 1)).toEqual([{ level_id: l3.id }]);

    db.close();
  });
});
