import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { asyncRoute } from '../../api/route-utils.js';

function parseInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function registerElasticChannelRoutes(router: Router, deps: ApiDeps, admin: RequestHandler): void {
  router.get('/elastic/groups', admin, (_req, res) => {
    res.json(deps.elastic.listGroups());
  });

  router.get('/elastic/load', admin, asyncRoute(async (_req, res) => {
    const groups = deps.elastic.listGroups();
    let channels: Array<{ cid: number; name: string; totalClients: number }> = [];
    try {
      channels = await deps.ts3.getChannels();
    } catch {
      channels = [];
    }
    const result = groups.map((group) => {
      const members = channels.filter((channel) => channel.name.startsWith(group.namePrefix));
      return {
        group,
        channels: members.map((channel) => ({ cid: channel.cid, name: channel.name, online: channel.totalClients })),
        totalChannels: members.length,
        totalOnline: members.reduce((sum, channel) => sum + channel.totalClients, 0),
      };
    });
    res.json({ groups: result, overallChannels: channels.length });
  }));

  router.post('/elastic/groups', admin, (req, res) => {
    const data = req.body ?? {};
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      res.status(400).json({ error: '请求数据无效' });
      return;
    }
    if (typeof data === 'object' && data !== null && 'channelGroupId' in data) {
      res.status(400).json({ error: '弹性频道不支持频道组；频道组只能分配给特定用户' });
      return;
    }
    const { name, namePrefix, createThreshold, deleteThreshold, password, baseChannelId, maxChannels } = data;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedPrefix = typeof namePrefix === 'string' ? namePrefix.trim() : '';
    if (!normalizedName || !normalizedPrefix) {
      res.status(400).json({ error: '名称与前缀必填' });
      return;
    }

    const normalizedCreateThreshold = createThreshold === undefined ? 2 : parseInteger(createThreshold);
    const normalizedDeleteThreshold = deleteThreshold === undefined ? 0 : parseInteger(deleteThreshold);
    const normalizedMaxChannels = maxChannels === undefined ? 8 : parseInteger(maxChannels);
    const normalizedBaseChannelId = baseChannelId === undefined || baseChannelId === null
      ? null
      : parseInteger(baseChannelId);
    if (
      normalizedCreateThreshold === null || normalizedCreateThreshold < 1
      || normalizedDeleteThreshold === null || normalizedDeleteThreshold < 0
      || normalizedDeleteThreshold >= normalizedCreateThreshold
      || normalizedMaxChannels === null || normalizedMaxChannels < 1
      || (baseChannelId !== undefined && baseChannelId !== null
        && (normalizedBaseChannelId === null || normalizedBaseChannelId < 1))
    ) {
      res.status(400).json({ error: '弹性频道参数无效' });
      return;
    }

    const group = deps.elastic.addGroup({
      name: normalizedName,
      namePrefix: normalizedPrefix,
      createThreshold: normalizedCreateThreshold,
      deleteThreshold: normalizedDeleteThreshold,
      password: typeof password === 'string' && password ? password : undefined,
      baseChannelId: normalizedBaseChannelId,
      maxChannels: normalizedMaxChannels,
    });
    res.status(201).json(group);
  });

  router.delete('/elastic/groups/:id', admin, (req, res) => {
    const ok = deps.elastic.removeGroup(Number.parseInt(req.params.id, 10));
    if (!ok) {
      res.status(404).json({ error: '频道组不存在' });
      return;
    }
    res.json({ success: true });
  });
}
