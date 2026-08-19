import type { AppDatabase } from '../db/database.js';
import { Ts3ClientWrapper } from '../ts3/client.js';

export interface ElasticGroup {
  id: number;
  name: string;
  namePrefix: string;
  createThreshold: number;
  deleteThreshold: number;
  password: string | null;
  channelGroupId: number | null;
  baseChannelId: number | null;
  maxChannels: number;
  enabled: number;
  createdAt: number;
}

export class ElasticChannelService {
  constructor(
    private db: AppDatabase,
    private ts3: Ts3ClientWrapper
  ) {}

  listGroups(): ElasticGroup[] {
    return this.db
      .prepare(
        'SELECT id, name, name_prefix as namePrefix, create_threshold as createThreshold, delete_threshold as deleteThreshold, password, channel_group_id as channelGroupId, base_channel_id as baseChannelId, max_channels as maxChannels, enabled, created_at as createdAt FROM elastic_groups ORDER BY id ASC'
      )
      .all() as ElasticGroup[];
  }

  addGroup(data: {
    name: string;
    namePrefix: string;
    createThreshold: number;
    deleteThreshold: number;
    password?: string;
    channelGroupId?: number | null;
    baseChannelId?: number | null;
    maxChannels?: number;
  }): ElasticGroup {
    const info = this.db
      .prepare(
        `INSERT INTO elastic_groups (name, name_prefix, create_threshold, delete_threshold, password, channel_group_id, base_channel_id, max_channels, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        data.name,
        data.namePrefix,
        data.createThreshold,
        data.deleteThreshold,
        data.password ?? null,
        data.channelGroupId ?? null,
        data.baseChannelId ?? null,
        data.maxChannels ?? 8,
        Date.now()
      );
    const row = this.db
      .prepare('SELECT * FROM elastic_groups WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
    return this.toGroup(row);
  }

  removeGroup(id: number): boolean {
    return this.db.prepare('DELETE FROM elastic_groups WHERE id = ?').run(id).changes > 0;
  }

  private toGroup(row: Record<string, unknown>): ElasticGroup {
    return {
      id: row.id as number,
      name: row.name as string,
      namePrefix: row.name_prefix as string,
      createThreshold: row.create_threshold as number,
      deleteThreshold: row.delete_threshold as number,
      password: (row.password as string | null) ?? null,
      channelGroupId: (row.channel_group_id as number | null) ?? null,
      baseChannelId: (row.base_channel_id as number | null) ?? null,
      maxChannels: row.max_channels as number,
      enabled: row.enabled as number,
      createdAt: row.created_at as number,
    };
  }

  /** 检测并执行弹性频道扩容/收缩 */
  async tick(): Promise<Array<{ type: string; group: string; channelName: string }>> {
    const actions: Array<{ type: string; group: string; channelName: string }> = [];
    const groups = this.listGroups().filter((g) => g.enabled === 1);
    if (groups.length === 0) return actions;

    let channels;
    try {
      channels = await this.ts3.getChannels();
    } catch {
      return actions;
    }

    for (const group of groups) {
      const prefix = group.namePrefix;
      const members = channels.filter((c) => c.name.startsWith(prefix));
      const fullChannels = members.filter((c) => c.totalClients >= group.createThreshold);
      const emptyChannels = members
        .filter((c) => c.totalClients <= group.deleteThreshold)
        .sort((a, b) => a.order - b.order);

      // 扩容：存在满员频道则新建（无需全部满员）
      if (members.length > 0 && fullChannels.length > 0) {
        if (members.length < group.maxChannels) {
          const nextNum = this.nextNumber(prefix, members);
          const newName = `${prefix}${nextNum}`;
          const cid = await this.ts3.createChannel({
            name: newName,
            cpid: group.baseChannelId ?? undefined,
            password: group.password ?? undefined,
          });
          if (cid) {
            actions.push({ type: 'create', group: group.name, channelName: newName });
          }
        }
      } else if (members.length === 0) {
        const cid = await this.ts3.createChannel({
          name: `${prefix}1`,
          cpid: group.baseChannelId ?? undefined,
          password: group.password ?? undefined,
        });
        if (cid) {
          actions.push({ type: 'create', group: group.name, channelName: `${prefix}1` });
        }
      }

      // 收缩：删除空频道，但始终保留至少 1 个频道
      if (emptyChannels.length > 0) {
        const allEmpty = members.length > 0 && emptyChannels.length === members.length;
        const toDelete = allEmpty ? emptyChannels.slice(0, emptyChannels.length - 1) : emptyChannels;
        for (const ch of toDelete) {
          const ok = await this.ts3.deleteChannel(ch.cid);
          if (ok) {
            actions.push({ type: 'delete', group: group.name, channelName: ch.name });
          }
        }
      }
    }

    return actions;
  }

  private nextNumber(prefix: string, members: Array<{ name: string }>): number {
    let max = 0;
    for (const m of members) {
      const suffix = m.name.slice(prefix.length);
      const n = parseInt(suffix, 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return max + 1;
  }
}
