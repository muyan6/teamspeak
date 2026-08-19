import type { AppDatabase } from '../../db/database.js';
import { Ts3ClientWrapper } from '../../ts3/client.js';
import { CredentialCipher } from '../../services/auth.js';

export interface ElasticGroup {
  id: number;
  name: string;
  namePrefix: string;
  createThreshold: number;
  deleteThreshold: number;
  password: string | null;
  baseChannelId: number | null;
  maxChannels: number;
  enabled: number;
  createdAt: number;
}

export class ElasticChannelService {
  constructor(
    private db: AppDatabase,
    private ts3: Ts3ClientWrapper,
    private credentialCipher = CredentialCipher.forDatabase(':memory:')
  ) {
    this.migratePasswords();
  }

  listGroups(): ElasticGroup[] {
    return this.db
      .prepare(
        'SELECT * FROM elastic_groups ORDER BY id ASC'
      )
      .all<Record<string, unknown>>()
      .map((row) => this.toGroup(row));
  }

  addGroup(data: {
    name: string;
    namePrefix: string;
    createThreshold: number;
    deleteThreshold: number;
    password?: string;
    baseChannelId?: number | null;
    maxChannels?: number;
  }): ElasticGroup {
    const info = this.db
      .prepare(
        `INSERT INTO elastic_groups (name, name_prefix, create_threshold, delete_threshold, password, base_channel_id, max_channels, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        data.name,
        data.namePrefix,
        data.createThreshold,
        data.deleteThreshold,
        data.password ? this.credentialCipher.encrypt(data.password) : null,
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
    this.db.prepare('DELETE FROM elastic_managed_channels WHERE group_id = ?').run(id);
    return this.db.prepare('DELETE FROM elastic_groups WHERE id = ?').run(id).changes > 0;
  }

  private toGroup(row: Record<string, unknown>): ElasticGroup {
    return {
      id: row.id as number,
      name: row.name as string,
      namePrefix: row.name_prefix as string,
      createThreshold: row.create_threshold as number,
      deleteThreshold: row.delete_threshold as number,
      password: row.password ? this.credentialCipher.decrypt(String(row.password)) : null,
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
      const managedChannelIds = this.getManagedChannelIds(group.id);
      const existingIds = new Set(members.map((channel) => channel.cid));
      for (const channelId of managedChannelIds) {
        if (!existingIds.has(channelId)) this.forgetManagedChannel(group.id, channelId);
      }

      // 仅在满员且没有空闲频道时扩容，避免保留备用频道的下一轮被重复创建。
      const needsChannel = members.length === 0 || (fullChannels.length > 0 && emptyChannels.length === 0);
      if (needsChannel && members.length < group.maxChannels) {
        const nextNum = this.nextNumber(prefix, members);
        const newName = `${prefix}${nextNum}`;
        const cid = await this.ts3.createChannel({
          name: newName,
          cpid: group.baseChannelId ?? undefined,
          password: group.password ?? undefined,
        });
        if (cid) {
          this.rememberManagedChannel(group.id, cid);
          actions.push({ type: 'create', group: group.name, channelName: newName });
        }
      }

      // 只回收本服务创建的空频道；存在满员频道时保留一个备用空频道。
      const managedEmptyChannels = emptyChannels.filter((channel) => managedChannelIds.has(channel.cid));
      const standbyCount = fullChannels.length > 0 ? 1 : 0;
      const maxDeletable = Math.max(0, members.length - 1);
      const deletionCount = Math.min(
        maxDeletable,
        Math.max(0, managedEmptyChannels.length - standbyCount)
      );
      for (const ch of managedEmptyChannels.slice(0, deletionCount)) {
        const ok = await this.ts3.deleteChannel(ch.cid);
        if (ok) {
          this.forgetManagedChannel(group.id, ch.cid);
          actions.push({ type: 'delete', group: group.name, channelName: ch.name });
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

  private getManagedChannelIds(groupId: number): Set<number> {
    const rows = this.db.prepare('SELECT channel_id FROM elastic_managed_channels WHERE group_id = ?')
      .all<{ channel_id: number }>(groupId);
    return new Set(rows.map((row) => row.channel_id));
  }

  private rememberManagedChannel(groupId: number, channelId: number): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO elastic_managed_channels (group_id, channel_id, created_at) VALUES (?, ?, ?)'
    ).run(groupId, channelId, Date.now());
  }

  private forgetManagedChannel(groupId: number, channelId: number): void {
    this.db.prepare('DELETE FROM elastic_managed_channels WHERE group_id = ? AND channel_id = ?').run(groupId, channelId);
  }

  private migratePasswords(): void {
    const rows = this.db.prepare('SELECT id, password FROM elastic_groups WHERE password IS NOT NULL')
      .all<{ id: number; password: string }>();
    for (const row of rows) {
      if (!this.credentialCipher.isEncrypted(row.password)) {
        this.db.prepare('UPDATE elastic_groups SET password = ? WHERE id = ?')
          .run(this.credentialCipher.encrypt(row.password), row.id);
      }
    }
  }
}
