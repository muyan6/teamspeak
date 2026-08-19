import type { RequestHandler, Router } from 'express';
import type { ApiDeps } from '../../api/router.js';
import { asyncRoute } from '../../api/route-utils.js';

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
    const { name, namePrefix, createThreshold, deleteThreshold, password, channelGroupId, baseChannelId, maxChannels } = req.body ?? {};
    if (!name || !namePrefix) {
      res.status(400).json({ error: '名称与前缀必填' });
      return;
    }
    const group = deps.elastic.addGroup({
      name: String(name).trim(),
      namePrefix: String(namePrefix).trim(),
      createThreshold: Number.parseInt(String(createThreshold), 10) || 2,
      deleteThreshold: Number.parseInt(String(deleteThreshold), 10) || 0,
      password: password || undefined,
      channelGroupId: channelGroupId ? Number.parseInt(String(channelGroupId), 10) : null,
      baseChannelId: baseChannelId ? Number.parseInt(String(baseChannelId), 10) : null,
      maxChannels: Number.parseInt(String(maxChannels), 10) || 8,
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
