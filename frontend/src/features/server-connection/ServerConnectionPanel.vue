<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../../api';
import type { Ts3ConnectionInfo } from '../../types';

const connection = ref<Ts3ConnectionInfo | null>(null);
const form = ref({ host: '', queryPort: 10011, serverPort: 9987, username: '', password: '' });
const saving = ref(false);
const reconnecting = ref(false);
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let connectionCheckId = 0;

const RECONNECT_POLL_INTERVAL_MS = 1500;
const RECONNECT_POLL_ATTEMPTS = 20;

function showNotice(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3000);
}

async function refreshConnection(updateForm = false): Promise<Ts3ConnectionInfo> {
  const config = await api.getTs3Config();
  connection.value = config;
  if (updateForm) {
    form.value = {
      host: config.host,
      queryPort: config.queryPort,
      serverPort: config.serverPort,
      username: config.username,
      password: '',
    };
  }
  return config;
}

async function load(): Promise<void> {
  try {
    await refreshConnection(true);
  } catch (error) {
    showNotice((error as Error).message);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReconnect(): Promise<void> {
  const checkId = ++connectionCheckId;
  reconnecting.value = true;
  try {
    for (let attempt = 0; attempt < RECONNECT_POLL_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await wait(RECONNECT_POLL_INTERVAL_MS);
      if (checkId !== connectionCheckId) return;
      try {
        const config = await refreshConnection();
        if (config.connected) {
          showNotice('服务器配置已保存，TS3 已连接');
          return;
        }
      } catch {
        // 重连期间接口短暂不可用时继续等待，最终统一提示。
      }
    }
    if (checkId === connectionCheckId) {
      showNotice('配置已保存，但 TS3 在 30 秒内未连接，请检查 ServerQuery 参数和防火墙');
    }
  } finally {
    if (checkId === connectionCheckId) reconnecting.value = false;
  }
}

async function save(): Promise<void> {
  if (!form.value.host.trim() || !form.value.username.trim()) {
    showNotice('服务器地址和 ServerQuery 账号不能为空');
    return;
  }
  if (saving.value) return;
  saving.value = true;
  try {
    const result = await api.saveTs3Config({ ...form.value, host: form.value.host.trim(), username: form.value.username.trim() });
    connection.value = { ...(connection.value ?? {}), ...result.config, connected: false } as Ts3ConnectionInfo;
    showNotice('服务器配置已保存，正在重新连接');
    await waitForReconnect();
  } catch (error) {
    showNotice(`服务器配置保存失败：${(error as Error).message || '请求失败'}`);
  } finally {
    saving.value = false;
  }
}

onMounted(() => { void load(); });
onBeforeUnmount(() => {
  connectionCheckId += 1;
  if (noticeTimer) clearTimeout(noticeTimer);
});
</script>

<template>
  <div>
    <div v-if="notice" class="notice">{{ notice }}</div>
    <div v-if="connection" class="conn-status" :class="{ ok: connection.connected }">连接状态：{{ connection.connected ? '已连接' : reconnecting ? '重新连接中...' : '未连接' }}</div>
    <div class="field">
      <label>服务器地址（host）</label>
      <input v-model="form.host" class="input" placeholder="例如 150.158.129.222" />
    </div>
    <div class="field">
      <label>ServerQuery 端口</label>
      <input v-model.number="form.queryPort" class="input" type="number" min="1" max="65535" />
    </div>
    <div class="field">
      <label>语音端口</label>
      <input v-model.number="form.serverPort" class="input" type="number" min="1" max="65535" />
    </div>
    <div class="field">
      <label>ServerQuery 账号</label>
      <input v-model="form.username" class="input" placeholder="serveradmin" />
    </div>
    <div class="field">
      <label>ServerQuery 密码</label>
      <input v-model="form.password" class="input" type="password" placeholder="留空保持原密码" />
    </div>
    <p class="hint">保存后将立即使用新配置重新连接被监控的 TS3 服务器。公开显示地址不受影响。</p>
    <div class="modal-actions">
      <button class="btn primary" :disabled="saving" @click="save">{{ saving ? (reconnecting ? '连接检测中...' : '保存中...') : '保存并重连' }}</button>
    </div>
  </div>
</template>
