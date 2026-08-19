import { EventEmitter } from 'node:events';
import {
  TeamSpeak,
  TeamSpeakClient,
  ReasonIdentifier,
  ClientConnectEvent,
  ClientDisconnectEvent,
  ChannelCreateEvent,
  ChannelDeleteEvent,
} from 'ts3-nodejs-library';

export interface Ts3ConnectionConfig {
  host: string;
  queryPort: number;
  serverPort: number;
  username: string;
  password: string;
}

export function getTs3ServerKey(config: Pick<Ts3ConnectionConfig, 'host' | 'queryPort' | 'serverPort'>): string {
  const host = config.host.trim().toLowerCase();
  return `${host}:${config.queryPort}:${config.serverPort}`;
}

export interface OnlineClientData {
  clid: number;
  clientDatabaseId: number;
  uniqueIdentifier: string;
  nickname: string;
  serverGroupIds: number[];
  channelId: number;
  channelName: string;
  channelGroupId: number;
  connectedTime: number;
  clientType: number;
}

export interface ChannelData {
  cid: number;
  parentId: number;
  name: string;
  totalClients: number;
  totalClientsFamily: number;
  order: number;
}

export interface ServerStateData {
  name: string;
  clientsOnline: number;
  maxClients: number;
  uptime: number;
}

export interface ClientDatabaseData {
  clientDatabaseId: number;
  uniqueIdentifier: string;
  nickname: string;
  created: number;
  lastConnected: number;
  totalConnections: number;
}

export class Ts3ClientWrapper extends EventEmitter {
  private ts3: TeamSpeak | null = null;
  private connecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private stopped = false;
  connected = false;

  constructor(private config: Ts3ConnectionConfig) {
    super();
  }

  get query(): TeamSpeak | null {
    return this.ts3;
  }

  getConfig(): Ts3ConnectionConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<Ts3ConnectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.stop();
    void this.start();
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ts3) {
      try {
        this.ts3.removeAllListeners();
        void this.ts3.quit();
      } catch {
        /* ignore */
      }
      this.ts3 = null;
    }
    this.connected = false;
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.stopped) return;
    if (!this.config.host) return;
    this.connecting = true;
    try {
      const ts3 = new TeamSpeak({
        host: this.config.host,
        queryport: this.config.queryPort,
        serverport: this.config.serverPort,
        username: this.config.username,
        password: this.config.password,
        autoConnect: false,
        readyTimeout: 10000,
      });

      ts3.on('ready', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');
      });

      ts3.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
        void this.scheduleReconnect();
      });

      ts3.on('error', (err: Error) => {
        this.emit('error', err);
      });

      ts3.on('clientconnect', (evt: ClientConnectEvent) => {
        this.emit('clientconnect', evt.client);
      });

      ts3.on('clientdisconnect', (evt: ClientDisconnectEvent) => {
        if (evt.client) this.emit('clientdisconnect', evt.client);
      });

      ts3.on('channelcreate', (evt: ChannelCreateEvent) => {
        this.emit('channelcreate', evt.channel);
      });

      ts3.on('channeldelete', (evt: ChannelDeleteEvent) => {
        this.emit('channeldelete', evt.cid);
      });

      await ts3.connect();
      this.ts3 = ts3;
    } catch (err) {
      this.emit('error', err as Error);
      this.connected = false;
      await this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private requireTs3(): TeamSpeak {
    if (!this.ts3) throw new Error('TS3 未连接');
    return this.ts3;
  }

  async getServerState(): Promise<ServerStateData | null> {
    try {
      const info = await this.requireTs3().serverInfo();
      return {
        name: info.virtualserverName,
        clientsOnline: Number(info.virtualserverClientsonline),
        maxClients: Number(info.virtualserverMaxclients),
        uptime: Number(info.virtualserverUptime),
      };
    } catch {
      return null;
    }
  }

  async getClients(): Promise<OnlineClientData[]> {
    const clients = await this.requireTs3().clientList();
    const channels = await this.requireTs3().channelList();
    const channelNames = new Map<number, string>();
    for (const ch of channels) channelNames.set(parseInt(ch.cid, 10), ch.name);

    const regular = clients.filter((c) => c.type === 0);
    const clids = regular.map((c) => parseInt(c.clid, 10));
    const channelGroupByDbid = new Map<number, number>();
    try {
      if (clids.length > 0) {
        const infos = await this.requireTs3().clientInfo(clids.map(String));
        for (const info of infos) {
          channelGroupByDbid.set(
            Number(info.clientDatabaseId),
            parseInt(info.clientChannelGroupId, 10) || 0
          );
        }
      }
    } catch {
      /* ignore */
    }

    return regular.map((c) => ({
      clid: parseInt(c.clid, 10),
      clientDatabaseId: parseInt(c.databaseId, 10),
      uniqueIdentifier: c.uniqueIdentifier,
      nickname: c.nickname,
      serverGroupIds: (c.servergroups || []).map((n) => parseInt(n, 10)),
      channelId: parseInt(c.cid, 10),
      channelName: channelNames.get(parseInt(c.cid, 10)) || '',
      channelGroupId: channelGroupByDbid.get(parseInt(c.databaseId, 10)) ?? 0,
      connectedTime: c.lastconnected,
      clientType: c.type,
    }));
  }

  async getChannels(): Promise<ChannelData[]> {
    const channels = await this.requireTs3().channelList();
    return channels.map((c) => ({
      cid: parseInt(c.cid, 10),
      parentId: parseInt(c.pid, 10),
      name: c.name,
      totalClients: c.totalClients,
      totalClientsFamily: c.totalClientsFamily,
      order: c.order,
    }));
  }

  async getServerGroups(): Promise<Array<{ sgid: number; name: string }>> {
    const groups = await this.requireTs3().serverGroupList();
    return groups
      .filter((g) => g.type === 1)
      .map((g) => ({ sgid: parseInt(g.sgid, 10), name: g.name }));
  }

  async getChannelGroups(): Promise<Array<{ cgid: number; name: string }>> {
    const groups = await this.requireTs3().channelGroupList();
    return groups
      .filter((g) => g.type === 1)
      .map((g) => ({ cgid: parseInt(g.cgid, 10), name: g.name }));
  }

  async getServerGroupsByClientDbId(dbId: number): Promise<Array<{ sgid: number; name: string }>> {
    try {
      const groups = await this.requireTs3().serverGroupsByClientId(String(dbId));
      return groups.map((g) => ({ sgid: parseInt(g.sgid, 10), name: g.name }));
    } catch {
      return [];
    }
  }

  async getClientDbInfo(dbId: number): Promise<{
    clientDatabaseId: number;
    uniqueIdentifier: string;
    created: number;
    lastConnected: number;
    totalConnections: number;
    nickname: string;
  } | null> {
    try {
      const infos = await this.requireTs3().clientDbInfo(String(dbId));
      const info = infos[0];
      if (!info) return null;
      return {
        clientDatabaseId: Number(info.clientDatabaseId),
        uniqueIdentifier: info.clientUniqueIdentifier,
        created: info.clientCreated,
        lastConnected: info.clientLastconnected,
        totalConnections: info.clientTotalconnections,
        nickname: info.clientNickname,
      };
    } catch {
      return null;
    }
  }

  async getClientDbList(pageSize = 200): Promise<ClientDatabaseData[]> {
    try {
      const query = this.requireTs3();
      const clients: ClientDatabaseData[] = [];
      let start = 0;
      let total = Number.POSITIVE_INFINITY;

      while (start < total) {
        const rows = await query.clientDbList(start, pageSize, true);
        if (rows.length === 0) break;
        total = Number(rows[0].count || start + rows.length);
        for (const row of rows) {
          const clientDatabaseId = Number(row.cldbid);
          if (!clientDatabaseId || !row.clientUniqueIdentifier || row.clientUniqueIdentifier === 'ServerQuery') continue;
          clients.push({
            clientDatabaseId,
            uniqueIdentifier: row.clientUniqueIdentifier,
            nickname: row.clientNickname,
            created: Number(row.clientCreated || 0),
            lastConnected: Number(row.clientLastconnected || 0),
            totalConnections: Number(row.clientTotalconnections || 0),
          });
        }
        start += rows.length;
        if (rows.length < pageSize) break;
      }

      return clients;
    } catch {
      return [];
    }
  }

  async setClientChannelGroup(cgid: number, cid: number, clientDatabaseId: number): Promise<boolean> {
    try {
      await this.requireTs3().setClientChannelGroup(String(cgid), String(cid), String(clientDatabaseId));
      return true;
    } catch (err) {
      this.emit('error', err as Error);
      return false;
    }
  }

  async addClientToServerGroup(sgid: number, clientDatabaseId: number): Promise<boolean> {
    try {
      await this.requireTs3().serverGroupAddClient(String(clientDatabaseId), String(sgid));
      return true;
    } catch (err) {
      this.emit('error', err as Error);
      return false;
    }
  }

  async getClientByUniqueId(uid: string): Promise<TeamSpeakClient | null> {
    try {
      const client = await this.requireTs3().getClientByUid(uid);
      return client ?? null;
    } catch {
      return null;
    }
  }

  async getClientByDbId(cldbid: number): Promise<TeamSpeakClient | null> {
    try {
      const client = await this.requireTs3().getClientByDbid(String(cldbid));
      return client ?? null;
    } catch {
      return null;
    }
  }

  async createChannel(props: {
    name: string;
    cpid?: number;
    password?: string;
  }): Promise<number | null> {
    try {
      const channel = await this.requireTs3().channelCreate(props.name, {
        cpid: props.cpid ? String(props.cpid) : undefined,
        channel_password: props.password,
        channel_flag_permanent: true,
        channel_codec: 4,
        channel_codec_quality: 10,
      });
      return parseInt(channel.cid, 10);
    } catch (err) {
      this.emit('error', err as Error);
      return null;
    }
  }

  async deleteChannel(cid: number): Promise<boolean> {
    try {
      await this.requireTs3().channelDelete(String(cid), true);
      return true;
    } catch (err) {
      this.emit('error', err as Error);
      return false;
    }
  }

  async getChannel(cid: number): Promise<{ name: string; totalClients: number } | null> {
    try {
      const channel = await this.requireTs3().getChannelById(String(cid));
      return channel ? { name: channel.name, totalClients: channel.totalClients } : null;
    } catch {
      return null;
    }
  }

  async editChannel(cid: number, props: {
    name?: string;
    cpid?: number;
    password?: string;
    maxclients?: number;
  }): Promise<boolean> {
    try {
      await this.requireTs3().channelEdit(String(cid), {
        channelName: props.name,
        cpid: props.cpid !== undefined ? String(props.cpid) : undefined,
        channelPassword: props.password,
        channelMaxclients: props.maxclients,
      });
      return true;
    } catch (err) {
      this.emit('error', err as Error);
      return false;
    }
  }

  async moveChannel(cid: number, cpid: number): Promise<boolean> {
    try {
      await this.requireTs3().channelMove(String(cid), String(cpid));
      return true;
    } catch (err) {
      this.emit('error', err as Error);
      return false;
    }
  }

  async kickClient(clid: number, reason?: string): Promise<boolean> {
    try {
      await this.requireTs3().clientKick(String(clid), ReasonIdentifier.KICK_SERVER, reason || 'Kicked by admin');
      return true;
    } catch (err) {
      this.emit('error', err as Error);
      return false;
    }
  }

  async moveClient(clid: number, cid: number, password?: string): Promise<boolean> {
    try {
      await this.requireTs3().clientMove(String(clid), String(cid), password);
      return true;
    } catch (err) {
      this.emit('error', err as Error);
      return false;
    }
  }

  async banClientByUid(uid: string, reason?: string, timeSec?: number): Promise<boolean> {
    try {
      await this.requireTs3().ban({ uid, banreason: reason || 'Banned by admin', time: timeSec });
      return true;
    } catch (err) {
      this.emit('error', err as Error);
      return false;
    }
  }

  async removeClientFromServerGroup(sgid: number, clientDatabaseId: number): Promise<boolean> {
    try {
      await this.requireTs3().serverGroupDelClient(String(clientDatabaseId), String(sgid));
      return true;
    } catch (err) {
      this.emit('error', err as Error);
      return false;
    }
  }
}
