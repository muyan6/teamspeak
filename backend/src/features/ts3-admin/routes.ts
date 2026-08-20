import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { asyncRoute } from '../../api/route-utils.js';
import { getTs3ServerKey } from '../../ts3/client.js';

export function registerTs3AdminRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  router.get('/server-groups', admin, asyncRoute(async (_req, res) => {
    try {
      res.json(await deps.ts3.getServerGroups());
    } catch {
      res.status(503).json({ error: '无法获取服务器组，请确认 TS3 连接正常' });
    }
  }));

  router.get('/admin/ts3-config', admin, (_req, res) => {
    const config = deps.ts3.getConfig();
    res.json({
      host: config.host,
      queryPort: config.queryPort,
      serverPort: config.serverPort,
      serverId: config.serverId ?? 0,
      username: config.username,
      hasPassword: !!config.password,
      connected: deps.ts3.connected,
      lastError: deps.ts3.lastError,
    });
  });

  router.post('/admin/ts3-config', admin, (req, res) => {
    const { host, queryPort, serverPort, serverId, username, password } = req.body ?? {};
    const current = deps.ts3.getConfig();
    const parsedQueryPort = Number(queryPort ?? current.queryPort);
    const parsedServerPort = Number(serverPort ?? current.serverPort);
    const parsedServerId = Number(serverId ?? current.serverId ?? 0);
    const config = {
      host: host ? String(host).trim() : current.host,
      queryPort: parsedQueryPort,
      serverPort: parsedServerPort,
      serverId: parsedServerId,
      username: username ? String(username).trim() : current.username,
      password: password !== undefined && password !== '' ? String(password) : current.password,
    };
    if (!config.host || !Number.isInteger(config.queryPort) || config.queryPort < 1 || config.queryPort > 65535 || !Number.isInteger(config.serverPort) || config.serverPort < 1 || config.serverPort > 65535 || !Number.isInteger(config.serverId) || config.serverId < 0 || !config.username) {
      res.status(400).json({ error: '服务器地址、端口、虚拟服务器 ID 和 ServerQuery 账号无效' });
      return;
    }
    deps.configStore.setJson('ts3Connection', {
      ...config,
      password: deps.credentialCipher.encrypt(config.password),
    });
    deps.stats.setServerKey(getTs3ServerKey(config), true);
    deps.ts3.updateConfig(config);
    if (deps.persistTs3Config) deps.persistTs3Config(config);
    res.json({
      success: true,
      config: {
        host: config.host,
        queryPort: config.queryPort,
        serverPort: config.serverPort,
        serverId: config.serverId,
        username: config.username,
        hasPassword: !!config.password,
        lastError: deps.ts3.lastError,
      },
    });
  });

  router.get('/admin/channels', admin, asyncRoute(async (_req, res) => {
    try {
      res.json(await deps.ts3.getChannels());
    } catch {
      res.status(503).json({ error: '无法获取频道列表' });
    }
  }));

  router.post('/admin/channels', admin, asyncRoute(async (req, res) => {
    const { name, cpid, password } = req.body ?? {};
    if (!name) {
      res.status(400).json({ error: '频道名必填' });
      return;
    }
    const cid = await deps.ts3.createChannel({
      name: String(name).trim(),
      cpid: cpid ? Number.parseInt(String(cpid), 10) : undefined,
      password: password || undefined,
    });
    if (!cid) {
      res.status(500).json({ error: '创建频道失败' });
      return;
    }
    res.status(201).json({ cid });
  }));

  router.patch('/admin/channels/:cid', admin, asyncRoute(async (req, res) => {
    const cid = Number.parseInt(req.params.cid, 10);
    if (!Number.isInteger(cid) || cid <= 0) {
      res.status(400).json({ error: '频道 ID 无效' });
      return;
    }
    const { name, cpid, password, maxclients } = req.body ?? {};
    const ok = await deps.ts3.editChannel(cid, {
      name: name ? String(name).trim() : undefined,
      cpid: cpid !== undefined && cpid !== null ? Number.parseInt(String(cpid), 10) : undefined,
      password: password !== undefined ? String(password) : undefined,
      maxclients: maxclients !== undefined && maxclients !== null ? Number.parseInt(String(maxclients), 10) : undefined,
    });
    if (!ok) {
      res.status(500).json({ error: '编辑频道失败' });
      return;
    }
    res.json({ success: true });
  }));

  router.delete('/admin/channels/:cid', admin, asyncRoute(async (req, res) => {
    const cid = Number.parseInt(req.params.cid, 10);
    if (!Number.isInteger(cid) || cid <= 0) {
      res.status(400).json({ error: '频道 ID 无效' });
      return;
    }
    const ok = await deps.ts3.deleteChannel(cid);
    if (!ok) {
      res.status(500).json({ error: '删除频道失败' });
      return;
    }
    res.json({ success: true });
  }));

  router.get('/admin/clients', admin, asyncRoute(async (_req, res) => {
    try {
      res.json(await deps.ts3.getClients());
    } catch {
      res.status(503).json({ error: '无法获取在线用户' });
    }
  }));

  router.post('/admin/clients/:clid/kick', admin, asyncRoute(async (req, res) => {
    const clid = Number.parseInt(req.params.clid, 10);
    if (!Number.isInteger(clid) || clid <= 0) {
      res.status(400).json({ error: '客户端 ID 无效' });
      return;
    }
    const { reason } = req.body ?? {};
    const ok = await deps.ts3.kickClient(clid, reason ? String(reason) : undefined);
    if (!ok) {
      res.status(500).json({ error: '踢出失败' });
      return;
    }
    res.json({ success: true });
  }));

  router.post('/admin/clients/:clid/move', admin, asyncRoute(async (req, res) => {
    const clid = Number.parseInt(req.params.clid, 10);
    const { cid, password } = req.body ?? {};
    const parsedChannelId = Number(cid);
    if (!Number.isInteger(clid) || clid <= 0 || !Number.isInteger(parsedChannelId) || parsedChannelId <= 0) {
      res.status(400).json({ error: '客户端与目标频道必填' });
      return;
    }
    const ok = await deps.ts3.moveClient(clid, parsedChannelId, password ? String(password) : undefined);
    if (!ok) {
      res.status(500).json({ error: '移动失败' });
      return;
    }
    res.json({ success: true });
  }));

  router.post('/admin/clients/:clid/ban', admin, asyncRoute(async (req, res) => {
    const clid = Number.parseInt(req.params.clid, 10);
    const { uid, reason, time } = req.body ?? {};
    if (!Number.isInteger(clid) || clid <= 0 || !uid) {
      res.status(400).json({ error: '客户端 ID 与用户 UID 必填' });
      return;
    }
    const parsedTime = time === undefined || time === '' ? undefined : Number(time);
    if (parsedTime !== undefined && (!Number.isInteger(parsedTime) || parsedTime < 0)) {
      res.status(400).json({ error: '封禁时长无效' });
      return;
    }
    const ok = await deps.ts3.banClientByUid(String(uid), reason ? String(reason) : undefined, parsedTime);
    if (!ok) {
      res.status(500).json({ error: '封禁失败' });
      return;
    }
    res.json({ success: true });
  }));

  router.post('/admin/server-groups/assign', admin, asyncRoute(async (req, res) => {
    const { sgid, clientDatabaseId } = req.body ?? {};
    const parsedGroupId = Number(sgid);
    const parsedClientId = Number(clientDatabaseId);
    if (!Number.isInteger(parsedGroupId) || parsedGroupId <= 0 || !Number.isInteger(parsedClientId) || parsedClientId <= 0) {
      res.status(400).json({ error: '服务器组与用户必填' });
      return;
    }
    const ok = await deps.ts3.addClientToServerGroup(parsedGroupId, parsedClientId);
    if (!ok) {
      res.status(500).json({ error: '分配失败' });
      return;
    }
    res.json({ success: true });
  }));

  router.post('/admin/server-groups/remove', admin, asyncRoute(async (req, res) => {
    const { sgid, clientDatabaseId } = req.body ?? {};
    const parsedGroupId = Number(sgid);
    const parsedClientId = Number(clientDatabaseId);
    if (!Number.isInteger(parsedGroupId) || parsedGroupId <= 0 || !Number.isInteger(parsedClientId) || parsedClientId <= 0) {
      res.status(400).json({ error: '服务器组与用户必填' });
      return;
    }
    const ok = await deps.ts3.removeClientFromServerGroup(parsedGroupId, parsedClientId);
    if (!ok) {
      res.status(500).json({ error: '移除失败' });
      return;
    }
    res.json({ success: true });
  }));

  router.get('/admin/channel-groups', admin, asyncRoute(async (_req, res) => {
    try {
      res.json(await deps.ts3.getChannelGroups());
    } catch {
      res.status(503).json({ error: '无法获取频道组' });
    }
  }));

  router.post('/admin/channel-groups/assign', admin, asyncRoute(async (req, res) => {
    const { cgid, cid, clientDatabaseId } = req.body ?? {};
    const parsedGroupId = Number(cgid);
    const parsedChannelId = Number(cid);
    const parsedClientId = Number(clientDatabaseId);
    if (!Number.isInteger(parsedGroupId) || parsedGroupId <= 0 || !Number.isInteger(parsedChannelId) || parsedChannelId <= 0 || !Number.isInteger(parsedClientId) || parsedClientId <= 0) {
      res.status(400).json({ error: '频道组、频道与用户必填' });
      return;
    }
    const ok = await deps.ts3.setClientChannelGroup(parsedGroupId, parsedChannelId, parsedClientId);
    if (!ok) {
      res.status(500).json({ error: '分配频道组失败' });
      return;
    }
    res.json({ success: true });
  }));

  router.post('/admin/channel-groups/remove', admin, asyncRoute(async (req, res) => {
    const { cid, clientDatabaseId } = req.body ?? {};
    const parsedChannelId = Number(cid);
    const parsedClientId = Number(clientDatabaseId);
    if (!Number.isInteger(parsedChannelId) || parsedChannelId <= 0 || !Number.isInteger(parsedClientId) || parsedClientId <= 0) {
      res.status(400).json({ error: '频道与用户必填' });
      return;
    }
    const ok = await deps.ts3.setClientChannelGroup(0, parsedChannelId, parsedClientId);
    if (!ok) {
      res.status(500).json({ error: '移除频道组失败' });
      return;
    }
    res.json({ success: true });
  }));
}
