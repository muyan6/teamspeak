import { ref, type Ref } from 'vue';
import { api } from '../api';
import type { DashboardData } from '../types';

const data = ref<DashboardData | null>(null);
const error = ref('');
const isWsConnected = ref(false);
let ws: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsFailures = 0;
const WS_MAX_FAILURES = 6;
let refreshPromise: Promise<void> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRefresh = false;
const jitterTimers = new Set<ReturnType<typeof setTimeout>>();

async function doRefresh(): Promise<void> {
  try {
    data.value = await api.getData();
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    refreshPromise = null;
    if (pendingRefresh) {
      pendingRefresh = false;
      void refresh(false);
    }
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
    // 旧实现直接丢弃这次刷新（`if (!refreshPromise)` 无 else），导致高频推送时
    // 数据可能长时间停在旧值。这里改为「记住待刷新」，等当前请求结束后补一次。
    if (refreshPromise) {
      pendingRefresh = true;
      return;
    }
    refreshPromise = doRefresh();
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
    wsFailures = 0;
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
        // 高频推送时逐个 setTimeout 会持续堆积；这里登记句柄以便在重连/关闭时统一清理。
        const jitter = Math.floor(Math.random() * 800);
        const timer = setTimeout(() => {
          jitterTimers.delete(timer);
          void refresh(false);
        }, jitter);
        jitterTimers.add(timer);
      }
    } catch {
      /* 忽略非 JSON 消息 */
    }
  };
  ws.onclose = () => {
    ws = null;
    isWsConnected.value = false;
    for (const timer of jitterTimers) clearTimeout(timer);
    jitterTimers.clear();
    scheduleReconnect();
  };
  ws.onerror = () => {
    isWsConnected.value = false;
    ws?.close();
  };
}

const WS_RECONNECT_BASE_MS = 5000;
const WS_RECONNECT_MAX_MS = 60000;

function scheduleReconnect(): void {
  if (wsReconnectTimer) return;
  // 固定 5 秒重试会在反向代理未转发 /ws 时变成永不停歇的请求风暴
  // （多标签页再放大 N 倍）。这里改为指数退避并在达到上限后停止重连，
  // 由 App.vue 的 HTTP 轮询继续兜底刷新。
  if (wsFailures >= WS_MAX_FAILURES) return;
  const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** wsFailures, WS_RECONNECT_MAX_MS);
  wsFailures += 1;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, delay);
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
