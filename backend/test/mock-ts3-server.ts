import net from 'node:net';

interface MockClient {
  clid: number;
  cid: number;
  databaseId: number;
  nickname: string;
  uniqueIdentifier: string;
  servergroups: string;
  lastconnected: number;
}

interface MockChannel {
  cid: number;
  pid: number;
  name: string;
  totalClients: number;
  totalClientsFamily: number;
  order: number;
}

const WELCOME = 'TS3\nWelcome to the TeamSpeak 3 ServerQuery interface, type "help" for a list of commands and their syntax\n';

export class MockTs3Server {
  private server: net.Server | null = null;
  clients: MockClient[] = [];
  channels: MockChannel[] = [];
  serverName = 'Mock TS3 Server';
  maxClients = 32;
  selectedServer: { type: 'port' | 'sid'; value: number } | null = null;
  private nextClid = 100;
  private nextCid = 10;
  private nextDbId = 1000;

  constructor(private port = 10011) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        socket.write(WELCOME);
        socket.setEncoding('utf8');
        let buffer = '';

        socket.on('data', (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            const response = this.handleCommand(line);
            if (response !== null) {
              try {
                socket.write(response);
              } catch {
                socket.destroy();
              }
            }
          }
        });
        socket.on('error', () => {
          socket.destroy();
        });
      });
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  stop(): void {
    this.server?.close();
  }

  addClient(nickname: string, cid = 1, servergroups = '1'): MockClient {
    const dbId = this.nextDbId++;
    const client: MockClient = {
      clid: this.nextClid++,
      cid,
      databaseId: dbId,
      nickname,
      uniqueIdentifier: `uid_${dbId}`,
      servergroups,
      lastconnected: Math.floor(Date.now() / 1000) - 3600,
    };
    this.clients.push(client);
    this.updateChannelTotals();
    return client;
  }

  removeClient(nickname: string): void {
    this.clients = this.clients.filter((c) => c.nickname !== nickname);
    this.updateChannelTotals();
  }

  clearClients(): void {
    this.clients = [];
    this.updateChannelTotals();
  }

  addChannel(name: string, pid = 0, order = 0): MockChannel {
    const channel: MockChannel = {
      cid: this.nextCid++,
      pid,
      name,
      totalClients: 0,
      totalClientsFamily: 0,
      order,
    };
    this.channels.push(channel);
    this.updateChannelTotals();
    return channel;
  }

  private updateChannelTotals(): void {
    for (const ch of this.channels) {
      ch.totalClients = this.clients.filter((c) => c.cid === ch.cid).length;
      ch.totalClientsFamily = this.clients.filter((c) => c.cid === ch.cid).length;
    }
  }

  private handleCommand(line: string): string | null {
    const [cmd, ...args] = line.split(/\s+/);
    const params = new Map<string, string>();
    for (const arg of args) {
      const idx = arg.indexOf('=');
      if (idx === -1) continue;
      params.set(arg.slice(0, idx), arg.slice(idx + 1));
    }

    const ok = 'error id=0 msg=ok\n';
    switch (cmd) {
      case 'login':
        return ok;
      case 'use': {
        const sid = params.get('sid') || args.find((arg) => /^\d+$/.test(arg));
        const port = params.get('port');
        this.selectedServer = sid
          ? { type: 'sid', value: Number(sid) }
          : { type: 'port', value: Number(port) };
        return ok;
      }
      case 'version':
        return 'version=3.5.0 platform=linux build=12345\n' + ok;
      case 'whoami':
        return 'client_id=1 client_nickname=serveradmin\n' + ok;
      case 'serverinfo':
        return (
          `virtualserver_unique_identifier=mock_virtualserver virtualserver_name=${this.encode(this.serverName)} ` +
          `virtualserver_maxclients=${this.maxClients} virtualserver_clientsonline=${this.clients.length} ` +
          `virtualserver_queryclientsonline=0 virtualserver_uptime=3600 virtualserver_channelsonline=${this.channels.length}\n` +
          ok
        );
      case 'clientlist': {
        const rows = this.clients.map(
          (c) =>
            `clid=${c.clid} cid=${c.cid} client_database_id=${c.databaseId} client_nickname=${this.encode(c.nickname)} ` +
            `client_type=0 client_unique_identifier=${c.uniqueIdentifier} client_servergroups=${c.servergroups} ` +
            `client_lastconnected=${c.lastconnected} client_created=1000 client_idle_time=0`
        );
        return (rows.length ? rows.join('|') + '\n' : '') + ok;
      }
      case 'clientdblist': {
        const start = parseInt(params.get('start') || '0', 10);
        const duration = parseInt(params.get('duration') || '1000', 10);
        const rows = this.clients.slice(start, start + duration).map(
          (c) =>
            `count=${this.clients.length} cldbid=${c.databaseId} client_unique_identifier=${c.uniqueIdentifier} ` +
            `client_nickname=${this.encode(c.nickname)} client_created=1000 client_lastconnected=${c.lastconnected} ` +
            `client_totalconnections=1 client_description= client_lastip=127.0.0.1 client_login_name=`
        );
        return (rows.length ? rows.join('|') + '\n' : '') + ok;
      }
      case 'clientdbinfo': {
        const dbIds = (params.get('cldbid') || '').split(',').map((value) => parseInt(value, 10));
        const rows = this.clients.filter((c) => dbIds.includes(c.databaseId)).map(
          (c) =>
            `client_unique_identifier=${c.uniqueIdentifier} client_nickname=${this.encode(c.nickname)} ` +
            `client_database_id=${c.databaseId} client_created=1000 client_lastconnected=${c.lastconnected} ` +
            `client_totalconnections=1 client_lastip=127.0.0.1`
        );
        return (rows.length ? rows.join('|') + '\n' : '') + ok;
      }
      case 'channellist': {
        const rows = this.channels.map(
          (c) =>
            `cid=${c.cid} pid=${c.pid} channel_name=${this.encode(c.name)} total_clients=${c.totalClients} ` +
            `total_clients_family=${c.totalClientsFamily} channel_order=${c.order} channel_flag_permanent=1`
        );
        return (rows.length ? rows.join('|') + '\n' : '') + ok;
      }
      case 'servernotifyregister':
        return ok;
      case 'servergrouplist':
        return 'sgid=1 name=Guest|sgid=2 name=Admin|sgid=3 name=VIP\n' + ok;
      case 'channelcreate': {
        const name = params.get('channel_name') || 'new';
        const ch = this.addChannel(name, parseInt(params.get('cpid') || '0', 10));
        return `cid=${ch.cid}\n` + ok;
      }
      case 'channeldelete':
        return ok;
      case 'channelinfo':
        return `cid=${params.get('cid')} channel_name=test total_clients=0\n` + ok;
      case 'servergroupaddclient':
        return ok;
      case 'quit':
        return ok;
      case 'help':
      default:
        return 'error id=1024 msg=invalid parameter\n';
    }
  }

  private encode(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/\s/g, '\\s').replace(/\//g, '\\/');
  }
}
