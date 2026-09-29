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

export interface Ts3Snapshot {
  state: ServerStateData | null;
  clients: OnlineClientData[];
  channels: ChannelData[];
}

export class Ts3ClientWrapper extends EventEmitter {
  private ts3: TeamSpeak | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private connectionVersion = 0;
  private connectingVersion: number | null = null;
  private stopped = false;
  private snapshotCache: { version: number; expiresAt: number; value: Ts3Snapshot } | null = null;
  private snapshotInFlight: { version: number; promise: Promise<Ts3Snapshot> } | null = null;
  private readonly dbInfoCache = new Map<number, { expiresAt: number; value: ClientDatabaseData }>();
  private groupCache: { expiresAt: number; value: Array<{ sgid: number; name: string }> } | null = null;
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

  getGeneration(): number {
    return this.connectionVersion;
  }

  invalidateSnapshot(): void {
    this.snapshotCache = null;
  }

  private invalidateConnectionCaches(): void {
    this.snapshotCache = null;
    this.snapshotInFlight = null;
    this.dbInfoCache.clear();
    this.groupCache = null;
  }

  private async closeConnection(connection: TeamSpeak, force = false): Promise<void> {
    connection.removeAllListeners();
    // 库仍可能异步发出 error；清理后也必须保留监听器。
    connection.on?.('error', () => undefined);
    let timer: NodeJS.Timeout | undefined;
    try {
      if (!force) {
        await Promise.race([
          Promise.resolve().then(() => connection.quit()),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, 500); timer.unref(); }),
        ]);
      }
    } catch {
      // quit 是 Promise，同步 try/catch 捕获不到其拒绝。
    } finally {
      if (timer) clearTimeout(timer);
      try { connection.forceQuit?.(); } catch { /* 已关闭 */ }
    }
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
    this.invalidateConnectionCaches();
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ts3) {
      void this.closeConnection(this.ts3);
      this.ts3 = null;
    }
    this.connected = false;
  }

  private async connect(): Promise<void> {
    const version = this.connectionVersion;
    if (this.connectingVersion === version || this.stopped || this.connected) return;
    if (!this.config.host) return;
    this.connectingVersion = version;
    const isCurrentConnection = (): boolean => !this.stopped && version === this.connectionVersion;
    let connection: TeamSpeak | null = null;
    try {
      // TeamSpeak.connect() resolves only after ServerQuery has logged in and selected the virtual server.
      // Runtime event subscriptions must be registered afterwards, otherwise this library queues them before login.
      const useServerId = Number.isInteger(this.config.serverId) && (this.config.serverId as number) > 0;
      connection = await TeamSpeak.connect({
        host: this.config.host.replace(/^\[|\]$/g, ''),
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
        void this.closeConnection(ts3);
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
        this.connectionVersion += 1;
        this.invalidateConnectionCaches();
        void this.closeConnection(ts3, true);
        if (error) {
          this.lastError = error.message;
          if (this.listenerCount('error') > 0) this.emit('error', error);
        }
        this.emit('disconnected');
        void this.scheduleReconnect(this.connectionVersion);
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
        void this.closeConnection(connection);
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
    const version = this.connectionVersion;
    let timer: NodeJS.Timeout | null = null;
    try {
      const value = await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('TS3 查询响应超时')), Ts3ClientWrapper.QUERY_TIMEOUT_MS);
        }),
      ]);
      if (version !== this.connectionVersion || this.stopped) throw new Error('TS3 连接已切换，已丢弃旧查询');
      return value;
    } catch (error) {
      if (version === this.connectionVersion && (error as Error).message === 'TS3 查询响应超时') this.handleQueryTimeout(error as Error);
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
    this.connectionVersion += 1;
    this.invalidateConnectionCaches();
    void this.closeConnection(ts3, true);
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

  async getSnapshot(force = false): Promise<Ts3Snapshot> {
    const version = this.connectionVersion;
    if (!force && this.snapshotCache?.version === version && this.snapshotCache.expiresAt > Date.now()) return this.snapshotCache.value;
    if (this.snapshotInFlight?.version === version) return this.snapshotInFlight.promise;
    const promise = (async (): Promise<Ts3Snapshot> => {
      const state = await this.getServerState();
      if (!state) return { state: null, clients: [], channels: [] };
      const channels = await this.getChannels();
      const clients = await this.getClients(channels);
      if (version !== this.connectionVersion || this.stopped) throw new Error('TS3 快照已过期');
      const value = { state, clients, channels };
      this.snapshotCache = { version, expiresAt: Date.now() + 10_000, value };
      return value;
    })().finally(() => {
      if (this.snapshotInFlight?.promise === promise) this.snapshotInFlight = null;
    });
    this.snapshotInFlight = { version, promise };
    return promise;
  }

  async getClients(knownChannels?: ChannelData[]): Promise<OnlineClientData[]> {
    const clients = await this.executeQuery(() => this.requireTs3().clientList());
    const channels = knownChannels ?? await this.getChannels();
    const channelNames = new Map<number, string>();
    for (const ch of channels) channelNames.set(ch.cid, ch.name);

    const regular = clients.filter((c) => c.type === 0);

    return regular.map((c) => ({
      clid: parseInt(c.clid, 10),
      clientDatabaseId: parseInt(c.databaseId, 10),
      uniqueIdentifier: c.uniqueIdentifier,
      nickname: c.nickname,
      serverGroupIds: (c.servergroups || []).map((n) => parseInt(n, 10)),
      channelId: parseInt(c.cid, 10),
      channelName: channelNames.get(parseInt(c.cid, 10)) || '',
      channelGroupId: parseInt(c.channelGroupId, 10) || 0,
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
    if (this.groupCache && this.groupCache.expiresAt > Date.now()) return this.groupCache.value;
    const version = this.connectionVersion;
    const groups = await this.executeQuery(() => this.requireTs3().serverGroupList());
    const value = groups
      .filter((g) => g.type === 1)
      .map((g) => ({ sgid: parseInt(g.sgid, 10), name: g.name }));
    if (version === this.connectionVersion) this.groupCache = { value, expiresAt: Date.now() + 300_000 };
    return value;
  }

  async getChannelGroups(): Promise<Array<{ cgid: number; name: string }>> {
    const groups = await this.executeQuery(() => this.requireTs3().channelGroupList());
    return groups
      .filter((g) => g.type === 1)
      .map((g) => ({ cgid: parseInt(g.cgid, 10), name: g.name }));
  }

  async getServerGroupsByClientDbId(dbId: number): Promise<Array<{ sgid: number; name: string }>> {
    try {
      const groups = await this.executeQuery(() => this.requireTs3().serverGroupsByClientId(String(dbId)));
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
    const cached = this.dbInfoCache.get(dbId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const infos = await this.executeQuery(() => this.requireTs3().clientDbInfo(String(dbId)));
      const info = infos[0];
      if (!info) return null;
      const value = {
        clientDatabaseId: Number(info.clientDatabaseId),
        uniqueIdentifier: info.clientUniqueIdentifier,
        created: info.clientCreated,
        lastConnected: info.clientLastconnected,
        totalConnections: info.clientTotalconnections,
        nickname: info.clientNickname,
      };
      if (this.dbInfoCache.size >= 10_000) this.dbInfoCache.delete(this.dbInfoCache.keys().next().value!);
      this.dbInfoCache.set(dbId, { value, expiresAt: Date.now() + 60_000 });
      return value;
    } catch {
      return null;
    }
  }

  async getClientDbList(pageSize = 200): Promise<ClientDatabaseData[]> {
    try {
      const clients: ClientDatabaseData[] = [];
      let start = 0;
      // 以「本页返回条数 < pageSize」作为唯一可靠的终止条件，并加页数硬上限。
      //
      // 旧实现用 `rows[0].count` 推算总量，一旦该字段缺失或语义变化（不同 TS3
      // 版本/库的返回可能不同），循环会提前退出，导致成员库同步不完整。
      // 硬上限同时避免异常响应造成死循环。
      const MAX_PAGES = 200;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const rows = await this.executeQuery(() => this.requireTs3().clientDbList(start, pageSize, true));
        if (rows.length === 0) break;
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

  async findClientDb(pattern: string, isUid = false, maxResults = 10): Promise<ClientDatabaseData[]> {
    try {
      const trimmed = pattern.trim();
      if (!trimmed) return [];
      const matches = await this.executeQuery(() => this.requireTs3().clientDbFind(trimmed, isUid));
      if (!Array.isArray(matches) || matches.length === 0) return [];

      const limited = matches.slice(0, maxResults);
      const results: ClientDatabaseData[] = [];
      for (const match of limited) {
        const cldbid = Number(match.cldbid);
        if (!cldbid) continue;
        const info = await this.getClientDbInfo(cldbid);
        if (info && info.uniqueIdentifier && info.uniqueIdentifier !== 'ServerQuery') {
          results.push(info);
        }
      }
      return results;
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
      await this.executeQuery(() => this.requireTs3().setClientChannelGroup(String(targetCgid), String(cid), String(clientDatabaseId)));
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async addClientToServerGroup(sgid: number, clientDatabaseId: number): Promise<boolean> {
    try {
      await this.executeQuery(() => this.requireTs3().serverGroupAddClient(String(clientDatabaseId), String(sgid)));
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
      const client = await this.executeQuery(() => this.requireTs3().getClientByUid(uid));
      return client ?? null;
    } catch {
      return null;
    }
  }

  async getClientByDbId(cldbid: number): Promise<TeamSpeakClient | null> {
    try {
      const client = await this.executeQuery(() => this.requireTs3().getClientByDbid(String(cldbid)));
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
      const channel = await this.executeQuery(() => this.requireTs3().channelCreate(props.name, {
        cpid: props.cpid ? String(props.cpid) : undefined,
        channel_password: props.password,
        channel_flag_permanent: true,
        channel_codec: 4,
        channel_codec_quality: 10,
      }));
      return parseInt(channel.cid, 10);
    } catch (err) {
      this.reportError(err);
      return null;
    }
  }

  async deleteChannel(cid: number): Promise<boolean> {
    try {
      await this.executeQuery(() => this.requireTs3().channelDelete(String(cid), true));
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async getChannel(cid: number): Promise<{ name: string; totalClients: number; totalClientsFamily?: number } | null> {
    try {
      const channel = await this.executeQuery(() => this.requireTs3().getChannelById(String(cid)));
      return channel ? {
        name: channel.name,
        totalClients: channel.totalClients,
        totalClientsFamily: channel.totalClientsFamily !== undefined ? Number(channel.totalClientsFamily) : undefined,
      } : null;
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
      if (props.cpid !== undefined) {
        await this.executeQuery(() => this.requireTs3().channelMove(String(cid), String(props.cpid)));
      }
      const channelProps: Record<string, unknown> = {
        channelName: props.name,
        channelPassword: props.password !== undefined ? props.password : undefined,
      };
      if (props.maxclients !== undefined) {
        if (props.maxclients === 0) {
          channelProps.channelFlagMaxclientsUnlimited = true;
        } else if (props.maxclients > 0) {
          channelProps.channelFlagMaxclientsUnlimited = false;
          channelProps.channelMaxclients = props.maxclients;
        }
      }
      await this.executeQuery(() => this.requireTs3().channelEdit(String(cid), channelProps as any));
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async moveChannel(cid: number, cpid: number): Promise<boolean> {
    try {
      await this.executeQuery(() => this.requireTs3().channelMove(String(cid), String(cpid)));
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async kickClient(clid: number, reason?: string): Promise<boolean> {
    try {
      await this.executeQuery(() => this.requireTs3().clientKick(String(clid), ReasonIdentifier.KICK_SERVER, reason || 'Kicked by admin'));
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async moveClient(clid: number, cid: number, password?: string): Promise<boolean> {
    try {
      await this.executeQuery(() => this.requireTs3().clientMove(String(clid), String(cid), password));
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async banClientByUid(uid: string, reason?: string, timeSec?: number): Promise<boolean> {
    try {
      await this.executeQuery(() => this.requireTs3().ban({ uid, banreason: reason || 'Banned by admin', time: timeSec }));
      return true;
    } catch (err) {
      this.reportError(err);
      return false;
    }
  }

  async removeClientFromServerGroup(sgid: number, clientDatabaseId: number): Promise<boolean> {
    try {
      await this.executeQuery(() => this.requireTs3().serverGroupDelClient(String(clientDatabaseId), String(sgid)));
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
