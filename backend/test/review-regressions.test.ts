import { afterEach, describe, expect, it, vi } from 'vitest';
import express, { Router } from 'express';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase, type AppDatabase } from '../src/db/database.js';
import { SiteConfigStore } from '../src/db/site-config.js';
import { StatsService } from '../src/services/stats.js';
import { MonitorService } from '../src/services/monitor.js';
import { Ts3ClientWrapper, type OnlineClientData } from '../src/ts3/client.js';
import { DashboardService } from '../src/services/dashboard.js';
import { AchievementService } from '../src/features/achievements/service.js';
import { WeeklyChampionService } from '../src/features/weekly-champion/service.js';
import { ChampionScheduler } from '../src/features/weekly-champion/scheduler.js';
import { MultiSubsiteRegistry } from '../src/features/multi-subsites/service.js';
import { CredentialCipher } from '../src/services/auth.js';
import { registerTutorialConfigRoutes } from '../src/features/tutorial-config/routes.js';
import { registerSiteConfigRoutes } from '../src/features/site-config/routes.js';
import { registerTs3AdminRoutes, isValidHost } from '../src/features/ts3-admin/routes.js';
import { loadConfig } from '../src/config.js';
import { EventEmitter } from 'node:events';
import { overlapsNightWindow } from '../src/features/achievements/archive-reader.js';
import { WsHub } from '../src/ws/hub.js';
import type { ApiDeps } from '../src/api/router.js';
const databases: AppDatabase[] = [], directories: string[] = [], servers: http.Server[] = [];
const memory = (): AppDatabase => { const db = openDatabase(':memory:'); databases.push(db); return db; };
const temporary = (): string => { const dir = mkdtempSync(path.join(tmpdir(), 'ts3-regression-')); directories.push(dir); return dir; };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; };
const fake = () => ({ connected: true, getGeneration: () => 1, getConfig: () => ({ host: 'localhost', queryPort: 10011, serverPort: 9987, username: 'admin', password: '' }), getServerState: async () => ({ name: 'Server', clientsOnline: 0, maxClients: 32, uptime: 1 }), getClients: async () => [], getChannels: async () => [], getServerGroups: async () => [], addClientToServerGroup: vi.fn(async () => true), removeClientFromServerGroup: vi.fn(async () => true) });
const seed = (db: AppDatabase, id = 1, seconds = 3600) => db.prepare('INSERT INTO user_online_duration(server_key,client_database_id,unique_identifier,nickname,total_seconds,last_updated) VALUES(?,?,?,?,?,?)').run('legacy', id, `uid-${id}`, `User${id}`, seconds, Date.now());
const badge = (a: AchievementService, conditionType: 'active_days' | 'streak_days' | 'weekly_champion' | 'bond_friends', threshold: number, sgid = 0) => a.addBadge({ name: `${conditionType}-${threshold}`, icon: 'ph-medal', conditionType, conditionParams: { threshold }, serverGroupId: sgid });
async function serve(register: (router: Router) => void) { const app = express(); app.use(express.json()); const router = Router(); register(router); app.use(router); const s = http.createServer(app); servers.push(s); await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(s.address() as {
    port: number;
}).port}`; }
const admin: express.RequestHandler = (_q, _s, next) => next();
afterEach(async () => { vi.useRealTimers(); await Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r())))); for (const db of databases.splice(0))
    db.close(); for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true }); });
describe('审阅问题回归：隔离测试', () => {
    it('R02 切服期间丢弃旧采集，不写入新服务器', async () => {
        const db = memory(), stats = new StatsService(db, 'A'), gate = deferred<OnlineClientData[]>(), entered = deferred<void>();
        const ts3 = { ...fake(), getClients: async () => { entered.resolve(); return gate.promise; } };
        const monitor = new MonitorService(ts3 as never, stats, db, 30000, 300000);
        const collecting = monitor.collect();
        await entered.promise;
        stats.setServerKey('B');
        gate.resolve([{ clientDatabaseId: 1, uniqueIdentifier: 'uid-A', nickname: 'A', serverGroupIds: [], channelId: 1, channelName: 'A', connectedTime: 1 } as OnlineClientData]);
        await collecting;
        expect(db.prepare('SELECT * FROM online_clients').all()).toEqual([]);
    });
    it('R02 同一服务器重连版本变化也丢弃旧采集', async () => {
        const db = memory(), stats = new StatsService(db), gate = deferred<OnlineClientData[]>(), entered = deferred<void>();
        let version = 1;
        const ts3 = { ...fake(), getGeneration: () => version, getClients: async () => { entered.resolve(); return gate.promise; } };
        const monitor = new MonitorService(ts3 as never, stats, db, 30000, 300000);
        const collecting = monitor.collect();
        await entered.promise;
        version++;
        gate.resolve([]);
        await collecting;
        expect(db.prepare('SELECT * FROM online_samples').all()).toEqual([]);
    });
    it('停止监控后在途响应不访问已关闭数据库', async () => {
        const db = memory(), stats = new StatsService(db), gate = deferred<OnlineClientData[]>(), entered = deferred<void>();
        const monitor = new MonitorService({ ...fake(), getClients: async () => { entered.resolve(); return gate.promise; } } as never, stats, db, 30000, 300000);
        const collecting = monitor.collect();
        await entered.promise;
        monitor.stop();
        db.close();
        gate.resolve([]);
        await expect(collecting).resolves.toBeUndefined();
    });
    it('R03 保存首个 TS3 连接后公共地址立即更新，显式公共地址保持不变', async () => {
        const db = memory(), stats = new StatsService(db), store = new SiteConfigStore(db), config = loadConfig({});
        let current = { ...config.ts3 };
        const ts3 = { ...fake(), getConfig: () => current, updateConfig: (next: typeof current) => current = next };
        const achievements = new AchievementService(db, ts3 as never, stats);
        const dashboard = new DashboardService(config, ts3 as never, stats, store, { listGroups: () => [] } as never, achievements);
        const deps = { ts3, stats, dashboard, configStore: store, credentialCipher: new CredentialCipher('test') } as unknown as ApiDeps;
        const url = await serve(r => registerTs3AdminRoutes(r, deps, admin));
        const response = await fetch(url + '/admin/ts3-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: 'new.example.com', username: 'admin', serverPort: 9988 }) });
        expect(response.status).toBe(200);
        expect(dashboard.getPublicServer()).toEqual({ host: 'new.example.com', port: 9988 });
        expect((await dashboard.getData()).site.serverAddress).toBe('new.example.com:9988');
        const fixed = new DashboardService({ ...config, publicServer: { host: 'voice.example.com', port: 9990, hostConfigured: true, portConfigured: true } }, ts3 as never, stats, store, { listGroups: () => [] } as never, achievements);
        expect(fixed.getPublicServer()).toEqual({ host: 'voice.example.com', port: 9990 });
    });
    it('R04 夜间窗口只认真实交集，开放会话不提前授奖', () => {
        const sec = (v: string) => new Date(v).getTime() / 1000;
        expect(overlapsNightWindow(sec('2026-09-28T20:00:00'), sec('2026-09-29T01:00:00'), sec('2026-09-29T21:00:00'))).toBe(false);
        expect(overlapsNightWindow(sec('2026-09-29T20:00:00'), null, sec('2026-09-29T21:00:00'))).toBe(false);
        expect(overlapsNightWindow(sec('2026-09-28T20:00:00'), null, sec('2026-09-29T02:30:00'))).toBe(true);
        expect(overlapsNightWindow(sec('2026-09-29T05:00:00'), sec('2026-09-29T06:00:00'), sec('2026-09-29T21:00:00'))).toBe(false);
    });
    it('R05 归档及重启后累计天数、最大连续、勋章资格不减少', async () => {
        const dir = temporary(), main = path.join(dir, 'main.db'), archive = path.join(dir, 'archive.db');
        const db = openDatabase(main);
        databases.push(db);
        const stats = new StatsService(db);
        seed(db, 1, 400 * 3600);
        db.exec('DELETE FROM badges');
        for (let i = 0; i < 400; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            db.prepare('INSERT INTO user_daily_activity(server_key,client_database_id,nickname,day,active_seconds) VALUES(?,?,?,?,?)').run('legacy', 1, 'User1', day, 3600);
        }
        const ts3 = fake(), a = new AchievementService(db, ts3 as never, stats);
        const b = badge(a, 'active_days', 390, 10), streak = badge(a, 'streak_days', 390);
        await a.check();
        stats.archiveOldData(archive, 180, 365);
        await a.check();
        expect(stats.getUserActiveDays(1)).toBe(400);
        expect(stats.getUserStreak(1).max).toBe(400);
        expect(a.evaluateBadgeForUser(b, 1).unlocked).toBe(true);
        expect(a.evaluateBadgeForUser(streak, 1).unlocked).toBe(true);
        expect(ts3.removeClientFromServerGroup).not.toHaveBeenCalled();
        db.close();
        const reopened = openDatabase(main);
        databases.push(reopened);
        expect(new StatsService(reopened).getUserActiveDays(1)).toBe(400);
    });
    it('R05 历史夜间会话归档后仍保留资格', () => {
        const db = memory(), stats = new StatsService(db);
        const date = new Date();
        date.setDate(date.getDate() - 200);
        date.setHours(2, 0, 0, 0);
        const start = date.getTime() / 1000;
        db.prepare('INSERT INTO sessions(server_key,client_database_id,nickname,start_time,end_time,duration_seconds) VALUES(?,?,?,?,?,?)').run('legacy', 1, 'User1', start, start + 3600, 3600);
        expect(stats.hasNightOwlSessions(1)).toBe(true);
        stats.archiveOldData(path.join(temporary(), 'archive.db'));
        expect(stats.hasNightOwlSessions(1)).toBe(true);
    });
    it('R06 获奖者变化时清理前一轮未完成交接，重建服务仍能追踪', async () => {
        const db = memory(), stats = new StatsService(db);
        let top = 2, fail = true;
        const members = new Set([1]);
        stats.getTopUsers = () => [{ clientDatabaseId: top, nickname: `User${top}`, seconds: 3600 }];
        const ts3 = { ...fake(), addClientToServerGroup: async (_g: number, id: number) => { members.add(id); return true; }, removeClientFromServerGroup: async (_g: number, id: number) => { if (fail)
                return false; members.delete(id); return true; } };
        const c = new WeeklyChampionService(db, ts3 as never, stats);
        c.saveConfig({ enabled: 1, serverGroupId: 10, checkIntervalHours: 24 });
        db.prepare('UPDATE champion_config SET last_winner_client_db_id=1').run();
        await c.check();
        expect([...members].sort()).toEqual([1, 2]);
        top = 3;
        fail = false;
        await new WeeklyChampionService(db, ts3 as never, stats).check();
        expect([...members]).toEqual([3]);
    });
    it('R07 编辑勋章分类真正持久化', () => { const db = memory(), a = new AchievementService(db, fake() as never, new StatsService(db)); const b = badge(a, 'active_days', 30); a.updateBadge(b.id, { ...b, category: 'custom' }); expect(a.listBadges().find(x => x.id === b.id)?.category).toBe('custom'); });
    it('R08 周冠军次数按不同周统计，不重复计算同周', () => {
        const db = memory(), stats = new StatsService(db), a = new AchievementService(db, fake() as never, stats), b = badge(a, 'weekly_champion', 3);
        stats.recordChampionWinner(1, 'User1', '2026-09-01');
        stats.recordChampionWinner(1, 'User1', '2026-09-01');
        expect(a.evaluateBadgeForUser(b, 1).unlocked).toBe(false);
        stats.recordChampionWinner(1, 'User1', '2026-09-08');
        stats.recordChampionWinner(1, 'User1', '2026-09-15');
        expect(a.evaluateBadgeForUser(b, 1).unlocked).toBe(true);
    });
    it('R09 羁绊计数不限 Top10，并过滤机器人', () => {
        const db = memory(), stats = new StatsService(db);
        for (let i = 2; i <= 13; i++)
            db.prepare('INSERT INTO user_channel_bonds VALUES(?,?,?,?,?,?,?)').run('legacy', 1, i, 'User1', `User${i}`, 3600, 1);
        const a = new AchievementService(db, fake() as never, stats), b = badge(a, 'bond_friends', 11);
        expect(stats.getBondFriendsCount(1)).toBe(12);
        expect(a.evaluateBadgeForUser(b, 1).unlocked).toBe(true);
    });
    it('R10 创建、重置都拒绝超过256字符的密码，失败不修改旧密码', () => {
        const db = memory(), reg = new MultiSubsiteRegistry(db, 'example.com', new CredentialCipher('test')), input = { slug: 'alpha', displayName: 'Alpha', ts3Host: 'localhost', adminPassword: 'test-password' };
        expect(() => reg.create({ ...input, adminPassword: 'x'.repeat(257) })).toThrow('256');
        const sub = reg.create(input);
        const before = reg.get(sub.id)?.adminPassword;
        expect(() => reg.resetAdminPassword(sub.id, 'x'.repeat(257))).toThrow('256');
        expect(reg.get(sub.id)?.adminPassword).toBe(before);
    });
    it('R12 新等级授予失败时保留旧奖励，成功后再回收', async () => {
        const db = memory(), stats = new StatsService(db);
        seed(db, 1, 10 * 3600);
        db.exec('DELETE FROM badges');
        let succeed = false;
        const ts3 = { ...fake(), addClientToServerGroup: vi.fn(async () => succeed) };
        const a = new AchievementService(db, ts3 as never, stats);
        const low = a.addLevel({ hours: 1, serverGroupId: 10, title: 'Bronze' }), high = a.addLevel({ hours: 10, serverGroupId: 20, title: 'Gold' });
        db.prepare('INSERT INTO achievement_grants(server_key,client_database_id,level_id,granted_at) VALUES(?,?,?,?)').run('legacy', 1, low.id, 1);
        await a.check();
        expect(ts3.removeClientFromServerGroup).not.toHaveBeenCalled();
        expect(db.prepare('SELECT level_id FROM achievement_grants').all()).toEqual([{ level_id: low.id }]);
        succeed = true;
        await a.check();
        expect(db.prepare('SELECT level_id FROM achievement_grants').all()).toEqual([{ level_id: high.id }]);
    });
    it('R13 教程400请求不写入任何字段', async () => {
        const db = memory(), store = new SiteConfigStore(db);
        store.setJson('tutorial', { basic: 'Original' });
        const url = await serve(r => registerTutorialConfigRoutes(r, { configStore: store } as ApiDeps, admin));
        const response = await fetch(url + '/tutorial-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tutorial: { basic: 'Changed' }, clientDownload: { officialUrl: 'invalid' } }) });
        expect(response.status).toBe(400);
        expect(store.getJson('tutorial', {})).toEqual({ basic: 'Original' });
    });
    it('R13 站点多个外链整体校验后才写入', async () => {
        const db = memory(), store = new SiteConfigStore(db);
        store.set('musicBotUrl', 'https://old.example');
        const url = await serve(r => registerSiteConfigRoutes(r, { configStore: store } as ApiDeps, admin));
        const response = await fetch(url + '/site-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ musicBotUrl: 'https://new.example', webClientUrl: 'invalid' }) });
        expect(response.status).toBe(400);
        expect(store.get('musicBotUrl')).toBe('https://old.example');
        expect(store.get('siteInfo')).toBeNull();
    });
    it('R15 异步quit失败有捕获且强制释放连接', async () => {
        const client = new Ts3ClientWrapper({ host: 'localhost', queryPort: 10011, serverPort: 9987, username: 'test', password: '' });
        const forceQuit = vi.fn();
        Reflect.set(client, 'ts3', { removeAllListeners() { }, on() { }, quit: async () => { throw new Error('injected quit failure'); }, forceQuit });
        client.stop();
        await new Promise(r => setImmediate(r));
        expect(forceQuit).toHaveBeenCalledOnce();
    });
    it('共享实时快照合并并发读取，getClients复用已获取频道', async () => {
        const client = new Ts3ClientWrapper({ host: 'localhost', queryPort: 10011, serverPort: 9987, username: 'test', password: '' });
        const channels = [{ cid: 1, name: 'Room', parentId: 0, totalClients: 0, totalClientsFamily: 0, order: 0 }];
        client.getServerState = vi.fn(async () => ({ name: 'Server', clientsOnline: 0, maxClients: 32, uptime: 1 }));
        client.getChannels = vi.fn(async () => channels);
        client.getClients = vi.fn(async () => []);
        const [a, b] = await Promise.all([client.getSnapshot(), client.getSnapshot()]);
        expect(a).toBe(b);
        expect(client.getChannels).toHaveBeenCalledOnce();
        expect(client.getClients).toHaveBeenCalledWith(channels);
        await client.getSnapshot();
        expect(client.getServerState).toHaveBeenCalledOnce();
        client.stop();
    });
    it('旧连接查询超时不会关闭已切换的新连接', async () => {
        vi.useFakeTimers();
        const client = new Ts3ClientWrapper({ host: 'localhost', queryPort: 10011, serverPort: 9987, username: 'test', password: '' });
        const old = { removeAllListeners() { }, on() { }, quit: async () => undefined, forceQuit: vi.fn(), channelList: () => new Promise<never>(() => { }) };
        Reflect.set(client, 'ts3', old);
        client.connected = true;
        const request = client.getChannels();
        const checked = expect(request).rejects.toThrow('超时');
        client.stop();
        const next = { forceQuit: vi.fn() };
        Reflect.set(client, 'ts3', next);
        client.connected = true;
        await vi.advanceTimersByTimeAsync(10001);
        await checked;
        expect(client.query).toBe(next);
        expect(client.connected).toBe(true);
        expect(next.forceQuit).not.toHaveBeenCalled();
        Reflect.set(client, 'ts3', null);
    });
    it('批量羁绊写入保持全部关系与精确增量，机器人配置每轮只读一次', () => {
        const db = memory(), stats = new StatsService(db);
        const prepare = db.prepare.bind(db);
        let reads = 0;
        db.prepare = ((sql: string) => { if (sql.includes('SELECT value FROM site_config'))
            reads++; return prepare(sql); });
        const now = Date.now(), clients = Array.from({ length: 50 }, (_, i) => ({ clientDatabaseId: i + 1, uniqueIdentifier: `human-${i}`, nickname: `Human${i}`, serverGroupIds: [], channelId: 1, channelName: 'Room', connectedTime: Math.floor(now / 1000) - 30 } as OnlineClientData));
        stats.recordSnapshot(clients, [], now);
        expect(reads).toBe(1);
        expect(db.prepare('SELECT COUNT(*) AS count,MIN(seconds) AS seconds FROM user_channel_bonds').get()).toEqual({ count: 1225, seconds: 30 });
        stats.recordSnapshot(clients, [], now + 30000);
        expect(reads).toBe(2);
        expect(db.prepare('SELECT COUNT(*) AS count,MIN(seconds) AS seconds FROM user_channel_bonds').get()).toEqual({ count: 1225, seconds: 60 });
    });
    it('WebSocket慢连接触发背压回收，不继续积累发送队列', () => {
        const server = http.createServer(), hub = new WsHub(server);
        const socket = { readyState: 1, OPEN: 1, bufferedAmount: 2 * 1024 * 1024, send: vi.fn(), terminate: vi.fn() };
        Reflect.get(hub, 'clients').set(socket, 'localhost');
        hub.broadcast('online-update', { online: 1 });
        expect(socket.send).not.toHaveBeenCalled();
        expect(socket.terminate).toHaveBeenCalledOnce();
        expect(hub.getClientCount()).toBe(0);
        hub.close();
    });
    it('成员目录缓存新身份，但不伪造在线时长', () => {
        const db = memory(), stats = new StatsService(db);
        stats.syncClientIdentities([{ clientDatabaseId: 5, uniqueIdentifier: 'new-uid', nickname: 'NewMember', created: 123 } as never]);
        expect(stats.getLocalIdentityByUid('new-uid')?.nickname).toBe('NewMember');
        expect(stats.suggestNicknames('New')).toEqual([{ nickname: 'NewMember', uid: 'new-uid' }]);
        expect(stats.getClientCreated(5)).toBe(123);
        expect(stats.getTotalUserCount()).toBe(0);
    });
    it('离线兜底仍读取最新站点内容；切服不会沿用历史仪表盘', async () => {
        const db = memory(), stats = new StatsService(db), store = new SiteConfigStore(db);
        let online = true;
        const ts3 = { ...fake(), getServerState: async () => online ? { name: 'Server', maxClients: 32 } : null };
        const a = new AchievementService(db, ts3 as never, stats), dashboard = new DashboardService(loadConfig({}), ts3 as never, stats, store, { listGroups: () => [] } as never, a);
        await dashboard.getData();
        online = false;
        store.setJson('siteInfo', { title: 'NewTitle' });
        dashboard.invalidateCache();
        expect((await dashboard.getData()).site.title).toBe('NewTitle');
        stats.setServerKey('B');
        expect((await dashboard.getData()).ranks.week).toEqual([]);
    });
    it('主机字段拒绝端口与userinfo，接受纯IPv6', () => { for (const host of ['example.com:10011', 'user@example.com', '[::1]:10011', 'https://example.com'])
        expect(isValidHost(host)).toBe(false); for (const host of ['::1', '[::1]', '127.0.0.1', 'ts3.example.com'])
        expect(isValidHost(host)).toBe(true); });
    it('周冠军配置变更即时重新排期，连接成功不再等旧周期', async () => {
        vi.useFakeTimers();
        const champion = Object.assign(new EventEmitter(), { check: vi.fn(async () => null), getConfig: () => ({ checkIntervalHours: 24 }) });
        const ts3 = Object.assign(new EventEmitter(), { connected: false });
        const scheduler = new ChampionScheduler(champion as never, ts3 as never);
        scheduler.start();
        await vi.advanceTimersByTimeAsync(2000);
        expect(champion.check).not.toHaveBeenCalled();
        ts3.connected = true;
        ts3.emit('connected');
        await vi.advanceTimersByTimeAsync(1000);
        expect(champion.check).toHaveBeenCalledTimes(1);
        champion.emit('configChanged');
        await vi.advanceTimersByTimeAsync(0);
        expect(champion.check).toHaveBeenCalledTimes(2);
        scheduler.stop();
        await vi.advanceTimersByTimeAsync(24 * 3600000);
        expect(champion.check).toHaveBeenCalledTimes(2);
    });
});
