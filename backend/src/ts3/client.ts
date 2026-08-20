import { EventEmitter } from 'node:events';
import {
  TeamSpeak,
  QueryProtocol,
  TeamSpeakClient,
  ReasonIdentifier,
} from 'ts3-nodejs-library';

export interface Ts3ConnectionConfig {
  host: string;
  queryPort: number;
  serverPort: number;
  serverId?: number;
  username: string;
  password: string;
}

export function getTs3ServerKey(config: Pick<Ts3ConnectionConfig, 'host' | 'queryPort' | 'serverPort' | 'serverId'>): string {
  const host = config.host.trim().toLowerCase();
  return Number.isInteger(config.serverId) && (config.serverId as number) > 0
    ? `${host}:${config.queryPort}:sid:${config.serverId}`
    : `${host}:${config.queryPort}:${config.serverPort}`;
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
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private connectionVersion = 0;
  private connectingVersion: number | null = null;
  private stopped = false;
  connected = false;
  lastError: string | null = null;

  private static readonly QUERY_TIMEOUT_MS = 10000;

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
    this.stopped = false;
    this.lastError = null;
    void this.connect();
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.connectionVersion += 1;
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
    const version = this.connectionVersion;
    if (this.connectingVersion === version || this.stopped) return;
    if (!this.config.host) return;
    this.connectingVersion = version;
    const isCurrentConnection = (): boolean => !this.stopped && version === this.connectionVersion;
    let connection: TeamSpeak | null = null;
    try {
      // TeamSpeak.connect() resolves only after ServerQuery has logged in and selected the virtual server.
      // Runtime event subscriptions must be registered afterwards, otherwise this library queues them before login.
      const useServerId = Number.isInteger(this.config.serverId) && (this.config.serverId as number) > 0;
      connection = await TeamSpeak.connect({
        host: this.config.host,
        queryport: this.config.queryPort,
        serverport: useServerId ? undefined : this.config.serverPort,
        username: this.config.username,
        password: this.config.password,
        protocol: QueryProtocol.RAW,
        readyTimeout: 10000,
      });
      if (useServerId) await connection.useBySid(String(this.config.serverId));
      const ts3 = connection;

      if (!isCurrentConnection()) {
        void ts3.quit();
        return;
      }

      let terminated = false;
      const terminate = (error?: Error): void => {
        if (terminated || !isCurrentConnection()) return;
        terminated = true;
        if (!isCurrentConnection()) return;
        this.connected = false;
        if (this.ts3 === ts3) this.ts3 = null;
        if (this.connectingVersion === version) this.connectingVersion = null;
        if (error) {
          this.lastError = error.message;
          if (this.listenerCount('error') > 0) this.emit('error', error);
        }
        this.emit('disconnected');
        void this.scheduleReconnect(version);
      };

      ts3.on('close', () => terminate());
      ts3.on('error', (err: Error) => terminate(err));

      this.ts3 = ts3;
      this.connected = true;
      this.lastError = null;
      this.reconnectAttempts = 0;
      this.emit('connected');
    } catch (err) {
      if (connection) {
        try {
          connection.removeAllListeners();
          void connection.quit();
        } catch {
          /* ignore */
        }
      }
      if (!isCurrentConnection()) return;
      this.lastError = (err as Error).message;
      if (this.listenerCount('error') > 0) this.emit('error', err as Error);
      this.connected = false;
      void this.scheduleReconnect(version);
    } finally {
      if (this.connectingVersion === version) this.connectingVersion = null;
    }
  }

  private async scheduleReconnect(version: number): Promise<void> {
    if (this.stopped || version !== this.connectionVersion || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (version === this.connectionVersion && !this.stopped) void this.connect();
    }, delay);
  }

  private requireTs3(): TeamSpeak {
    if (!this.ts3) throw new Error('TS3 未连接');
    return this.ts3;
  }

  private reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.lastError = normalized.message;
    if (this.listenerCount('error') > 0) this.emit('error', normalized);
  }

  private async executeQuery<T>(operation: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('TS3 查询响应超时')), Ts3ClientWrapper.QUERY_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      if ((error as Error).message === 'TS3 查询响应超时') this.handleQueryTimeout(error as Error);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private handleQueryTimeout(error: Error): void {
    const ts3 = this.ts3;
    if (!ts3 || !this.connected) return;
    this.ts3 = null;
    this.connected = false;
    this.lastError = error.message;
    try {
      ts3.removeAllListeners();
      void ts3.quit();
    } catch {
      /* ignore */
    }
    if (this.listenerCount('error') > 0) this.emit('error', error);
    this.emit('disconnected');
    void this.scheduleReconnect(this.connectionVersion);
  }

  async getServerState(): Promise<ServerStateData | null> {
    try {
      const info = await this.executeQuery(() => this.requireTs3().serverInfo());
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
    const clients = await this.executeQuery(() => this.requireTs3().clientList());
    const channels = await this.executeQuery(() => this.requireTs3().channelList());
    const channelNames = new Map<number, string>();
    for (const ch of channels) channelNames.set(parseInt(ch.cid, 10), ch.name);

    const regular = clients.filter((c) => c.type === 0);
    const clids = regular.map((c) => parseInt(c.clid, 10));
    const channelGroupByDbid = new Map<number, number>();
    try {
      if (clids.length > 0) {
        const infos = await this.executeQuery(() => this.requireTs3().clientInfo(clids.map(String)));
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
    const channels = await this.executeQuery(() => this.requireTs3().channelList());
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
    const groups = await this.executeQuery(() => this.requireTs3().serverGroupList());
    return groups
      .filter((g) => g.type === 1)
      .map((g) => ({ sgid: parseInt(g.sgid, 10), name: g.name }));
  }

  async getChannelGroups(): Promise<Array<{ cgid: number; name: string }>> {
    const groups = await this.executeQuery(() => this.requireTs3().channelGroupList());
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

  async getDefaultChannelGroupId(): Promise<number> {
    try {
      const info = await this.executeQuery(() => this.requireTs3().serverInfo());
      return Number(info.virtualserverDefaultChannelGroup) || 8;
    } catch {
      return 8;
    }
  }

  async setClientChannelGroup(cgid: number, cid: number, clientDatabaseId: number): Promise<boolean> {
    try {
      let targetCgid = cgid;
      if (!targetCgid || targetCgid <= 0) {
        targetCgid = await this.getDefaultChannelGroupId();
      }
      await this.requireTs3().setClientChannelGroup(String(targetCgid), String(cid), String(clientDatabaseId));
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async addClientToServerGroup(sgid: number, clientDatabaseId: number): Promise<boolean> {
    try {
      await this.requireTs3().serverGroupAddClient(String(clientDatabaseId), String(sgid));
      return true;
    } catch (err) {
      const errObj = err as { id?: number | string; message?: string };
      if (errObj && (String(errObj.id) === '516' || /duplicate|already member/i.test(String(errObj.message)))) {
        return true;
      }
      this.reportError(err);
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
      this.reportError(err);
      return null;
    }
  }

  async deleteChannel(cid: number): Promise<boolean> {
    try {
      await this.requireTs3().channelDelete(String(cid), true);
      return true;
    } catch (err) {
      this.reportError(err);
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
      const query = this.requireTs3();
      if (props.cpid !== undefined) {
        await query.channelMove(String(cid), String(props.cpid));
      }
      await query.channelEdit(String(cid), {
        channelName: props.name,
        channelPassword: props.password !== undefined ? props.password : undefined,
        channelMaxclients: props.maxclients,
      });
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async moveChannel(cid: number, cpid: number): Promise<boolean> {
    try {
      await this.requireTs3().channelMove(String(cid), String(cpid));
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async kickClient(clid: number, reason?: string): Promise<boolean> {
    try {
      await this.requireTs3().clientKick(String(clid), ReasonIdentifier.KICK_SERVER, reason || 'Kicked by admin');
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async moveClient(clid: number, cid: number, password?: string): Promise<boolean> {
    try {
      await this.requireTs3().clientMove(String(clid), String(cid), password);
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async banClientByUid(uid: string, reason?: string, timeSec?: number): Promise<boolean> {
    try {
      await this.requireTs3().ban({ uid, banreason: reason || 'Banned by admin', time: timeSec });
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async removeClientFromServerGroup(sgid: number, clientDatabaseId: number): Promise<boolean> {
    try {
      await this.requireTs3().serverGroupDelClient(String(clientDatabaseId), String(sgid));
      return true;
    } catch (err) {
      const errObj = err as { id?: number | string; message?: string };
      if (errObj && (String(errObj.id) === '517' || /not member|empty result/i.test(String(errObj.message)))) {
        return true;
      }
      this.reportError(err);
      return false;
    }
  }
}
