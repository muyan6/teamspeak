import { ref, type Ref } from 'vue';
import { api } from '../api';
import type { DashboardData } from '../types';

const data = ref<DashboardData | null>(null);
const error = ref('');
const isWsConnected = ref(false);
let ws: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let refreshPromise: Promise<void> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function doRefresh(): Promise<void> {
  try {
    data.value = await api.getData();
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    refreshPromise = null;
  }
}

async function refresh(immediate = false): Promise<void> {
  if (immediate) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (!refreshPromise) {
      refreshPromise = doRefresh();
    }
    return refreshPromise;
  }

  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (!refreshPromise) {
      refreshPromise = doRefresh();
    }
  }, 300);
}

function connectWebSocket(): void {
  if (typeof window === 'undefined' || ws) return;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  try {
    ws = new WebSocket(wsUrl);
  } catch {
    isWsConnected.value = false;
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    isWsConnected.value = true;
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as { event: string; data: unknown };
      if (msg.event === 'online-update') {
        const payload = msg.data as { online?: number; maxClients?: number } | undefined;
        if (data.value && payload && typeof payload.online === 'number') {
          data.value.online_count = payload.online;
          if (typeof payload.maxClients === 'number') {
            data.value.max_clients = payload.maxClients;
          }
        }
      } else if (msg.event === 'clients-changed') {
        const jitter = Math.floor(Math.random() * 800);
        setTimeout(() => {
          void refresh(false);
        }, jitter);
      }
    } catch {
      /* 忽略非 JSON 消息 */
    }
  };
  ws.onclose = () => {
    ws = null;
    isWsConnected.value = false;
    scheduleReconnect();
  };
  ws.onerror = () => {
    isWsConnected.value = false;
    ws?.close();
  };
}

function scheduleReconnect(): void {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, 5000);
}

// 模块加载时即建立 WebSocket 连接（单例，仅连接一次）
if (typeof window !== 'undefined') {
  connectWebSocket();
}

export function useDashboard(): {
  data: Ref<DashboardData | null>;
  error: Ref<string>;
  refresh: (immediate?: boolean) => Promise<void>;
  isWsConnected: Ref<boolean>;
} {
  return { data, error, refresh, isWsConnected };
}
