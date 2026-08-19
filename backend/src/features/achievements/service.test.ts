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
});
