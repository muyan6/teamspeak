import { EventEmitter } from 'node:events';
import { io, type Socket } from 'socket.io-client';

export interface Ts3ManagerConfig {
  url: string;
  host: string;
  queryPort: number;
  serverId: number;
  username: string;
  password: string;
}

export interface ServerInfoData {
  name: string;
  clientsOnline: number;
  maxClients: number;
  uptime: number;
  version: string;
  platform: string;
  channelsOnline: number;
}

export interface RealtimeClient {
  clid: number;
  cldbid: number;
  nickname: string;
  channelId: number;
  channelName: string;
  groups: string[];
  clientType: number;
}

export interface ChannelInfo {
  cid: number;
  pid: number;
  name: string;
  totalClients: number;
  order: number;
}

export interface ClientDbEntry {
  cldbid: number;
  nickname: string;
  uniqueIdentifier: string;
  totalConnections: number;
  lastConnected: number;
  created: number;
}

type ExecResult = Array<Record<string, string | number | boolean>>;

export class Ts3ManagerClient extends EventEmitter {
  private socket: Socket | null = null;
  private token = '';
  private connecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  connected = false;

  constructor(private config: Ts3ManagerConfig) {
    super();
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
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.connected = false;
  }

  private connect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.connecting || this.stopped) {
        resolve();
        return;
      }
      this.connecting = true;

      const socket = io(this.config.url, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 10000,
      });
      this.socket = socket;

      const fail = (err?: Error): void => {
        this.connecting = false;
        this.connected = false;
        if (err) this.emit('error', err);
        try {
          socket.removeAllListeners();
          socket.close();
        } catch {
          /* ignore */
        }
        this.socket = null;
        void this.scheduleReconnect();
        resolve();
      };

      socket.on('connect_error', (err: Error) => fail(err));
      socket.on('connect_timeout', () => fail(new Error('连接面板超时')));

      socket.on('connect', () => {
        socket.emit(
          'teamspeak-connect',
          {
            host: this.config.host,
            queryport: this.config.queryPort,
            protocol: 'raw',
            username: this.config.username,
            password: this.config.password,
          },
          (resp: { token?: string; error?: string }) => {
            if (!resp || !resp.token) {
              fail(new Error(resp?.error || '面板登录失败'));
              return;
            }
            this.token = resp.token;
            void this.selectServer().then(() => {
              this.connecting = false;
              this.connected = true;
              this.emit('connected');
              resolve();
            }).catch((e: Error) => fail(e));
          }
        );
      });
    });
  }

  private async selectServer(): Promise<void> {
    if (this.config.serverId > 0) {
      await this.execute('use', { sid: this.config.serverId });
    }
  }

  private scheduleReconnect(): Promise<void> {
    if (this.stopped || this.reconnectTimer) return Promise.resolve();
    return new Promise((resolve) => {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.connect().then(resolve);
      }, 5000);
    });
  }

  execute(command: string, params: Record<string, unknown> = {}, options: string[] = []): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket || !socket.connected) {
        reject(new Error('面板未连接'));
        return;
      }
      socket.emit('teamspeak-execute', { command, params, options }, (resp: ExecResult & { error?: string }) => {
        if (resp && (resp as { error?: string }).error) {
          reject(new Error((resp as { error?: string }).error as string));
          return;
        }
        resolve((resp ?? []) as ExecResult);
      });
    });
  }

  // 获取服务器信息
  async getServerInfo(): Promise<ServerInfoData | null> {
    const rows = await this.execute('serverinfo');
    if (!rows || rows.length === 0) return null;
    const s = rows[0];
    return {
      name: String(s.virtualserverName ?? ''),
      clientsOnline: Number(s.virtualserverClientsonline ?? 0),
      maxClients: Number(s.virtualserverMaxclients ?? 0),
      uptime: Number(s.virtualserverUptime ?? 0),
      version: String(s.virtualserverVersion ?? ''),
      platform: String(s.virtualserverPlatform ?? ''),
      channelsOnline: Number(s.virtualserverChannelsonline ?? 0),
    };
  }

  // 获取实时在线客户端列表
  async getRealtimeClients(channels: ChannelInfo[]): Promise<RealtimeClient[]> {
    const rows = await this.execute('clientlist', {}, ['-voice', '-away']);
    const channelMap = new Map(channels.map((c) => [c.cid, c.name]));
    const result: RealtimeClient[] = [];
    for (const c of rows) {
      const cldbid = Number(c.clientDatabaseId ?? 0);
      const cid = Number(c.cid ?? 0);
      let groups: string[] = [];
      if (cldbid > 0) {
        try {
          const sg = await this.execute('servergroupsbyclientid', { cldbid });
          groups = sg.map((g) => String(g.name ?? ''));
        } catch {
          groups = [];
        }
      }
      result.push({
        clid: Number(c.clid ?? 0),
        cldbid,
        nickname: String(c.clientNickname ?? ''),
        channelId: cid,
        channelName: channelMap.get(cid) ?? '',
        groups,
        clientType: Number(c.clientType ?? 0),
      });
    }
    return result;
  }

  // 获取频道列表
  async getChannels(): Promise<ChannelInfo[]> {
    const rows = await this.execute('channellist');
    return rows.map((c) => ({
      cid: Number(c.cid ?? 0),
      pid: Number(c.pid ?? 0),
      name: String(c.channelName ?? ''),
      totalClients: Number(c.totalClients ?? 0),
      order: Number(c.channelOrder ?? 0),
    }));
  }

  // 获取客户端数据库（历史累计）
  async getClientDbList(): Promise<ClientDbEntry[]> {
    const rows = await this.execute('clientdblist', { start: 0, duration: 200 });
    return rows
      .filter((c) => String(c.clientUniqueIdentifier ?? '') !== 'ServerQuery')
      .map((c) => ({
        cldbid: Number(c.cldbid ?? 0),
        nickname: String(c.clientNickname ?? ''),
        uniqueIdentifier: String(c.clientUniqueIdentifier ?? ''),
        totalConnections: Number(c.clientTotalconnections ?? 0),
        lastConnected: Number(c.clientLastconnected ?? 0),
        created: Number(c.clientCreated ?? 0),
      }));
  }

  // 获取服务器组映射
  async getServerGroups(): Promise<Map<number, string>> {
    const rows = await this.execute('servergrouplist');
    const map = new Map<number, string>();
    for (const g of rows) {
      map.set(Number(g.sgid ?? 0), String(g.name ?? ''));
    }
    return map;
  }
}
