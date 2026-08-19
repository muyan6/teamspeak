<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { multiSubsiteApi } from './api';
import type { CreateManagedSubsiteInput, ManagedSubsite, MultiSubsiteSettings } from './types';

const subsites = ref<ManagedSubsite[]>([]);
const loading = ref(false);
const creating = ref(false);
const savingSettings = ref(false);
const notice = ref('');
const settings = ref<MultiSubsiteSettings>({ baseDomain: '' });
const form = ref<CreateManagedSubsiteInput>({
  displayName: '', slug: '', domain: '', ts3Host: '', queryPort: 10011, serverPort: 9987, username: 'serveradmin', password: '', publicHost: '', publicPort: 9987, adminPassword: '',
});

const canCreate = computed(() => Boolean(settings.value.baseDomain.trim() && form.value.displayName.trim() && form.value.slug.trim() && form.value.ts3Host.trim() && form.value.adminPassword));
const generatedDomain = computed(() => form.value.slug.trim().toLowerCase() ? `${form.value.slug.trim().toLowerCase()}.${settings.value.baseDomain.trim().toLowerCase()}` : `昵称.${settings.value.baseDomain.trim().toLowerCase() || 'example.com'}`);

function showNotice(message: string): void {
  notice.value = message;
  window.setTimeout(() => { if (notice.value === message) notice.value = ''; }, 4000);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [savedSettings, items] = await Promise.all([multiSubsiteApi.getSettings(), multiSubsiteApi.list()]);
    settings.value = savedSettings;
    subsites.value = items;
  }
  catch (error) { showNotice((error as Error).message); }
  finally { loading.value = false; }
}

async function saveSettings(): Promise<void> {
  if (!settings.value.baseDomain.trim() || savingSettings.value) return;
  savingSettings.value = true;
  try {
    settings.value = await multiSubsiteApi.saveSettings({ baseDomain: settings.value.baseDomain.trim().toLowerCase() });
    showNotice(`根域名已保存：${settings.value.baseDomain}`);
  } catch (error) { showNotice((error as Error).message); }
  finally { savingSettings.value = false; }
}

async function create(): Promise<void> {
  if (!canCreate.value || creating.value) return;
  creating.value = true;
  try {
    const created = await multiSubsiteApi.create({ ...form.value, slug: form.value.slug.trim().toLowerCase(), displayName: form.value.displayName.trim(), ts3Host: form.value.ts3Host.trim() });
    subsites.value.unshift(created);
    form.value = { displayName: '', slug: '', domain: '', ts3Host: '', queryPort: 10011, serverPort: 9987, username: 'serveradmin', password: '', publicHost: '', publicPort: 9987, adminPassword: '' };
    showNotice(`分站已创建：${created.domain}`);
  } catch (error) { showNotice((error as Error).message); }
  finally { creating.value = false; }
}

async function toggle(subsite: ManagedSubsite): Promise<void> {
  try {
    const updated = await multiSubsiteApi.setEnabled(subsite.id, !subsite.enabled);
    subsites.value = subsites.value.map((item) => item.id === updated.id ? updated : item);
    showNotice(updated.enabled ? '分站已启用' : '分站已停用，数据已保留');
  } catch (error) { showNotice((error as Error).message); }
}

onMounted(() => { void load(); });
</script>

<template>
  <section class="subsites-panel">
    <div v-if="notice" class="notice">{{ notice }}</div>
    <div class="platform-note"><strong>统一分站管理</strong><span>新分站拥有独立数据库、TS3 连接和后台密码。访问生效前，请将泛解析 DNS 与反向代理指向本服务。</span></div>
    <div class="domain-setting">
      <div class="field"><label>分站根域名</label><input v-model="settings.baseDomain" class="input" placeholder="例如 example.com" @keyup.enter="saveSettings" /><p class="hint">保存后，创建 alpha 分站会生成 alpha.example.com。</p></div>
      <button class="btn primary" :disabled="savingSettings || !settings.baseDomain.trim()" @click="saveSettings">{{ savingSettings ? '保存中...' : '保存根域名' }}</button>
    </div>
    <div class="provision-grid">
      <div class="field"><label>分站昵称</label><input v-model="form.displayName" class="input" placeholder="例如 Alpha 语音" /></div>
      <div class="field"><label>子域名</label><input v-model="form.slug" class="input" placeholder="例如 alpha" /><p class="hint">将生成 {{ generatedDomain }}</p></div>
      <div class="field"><label>TS3 ServerQuery 地址</label><input v-model="form.ts3Host" class="input" placeholder="例如 127.0.0.1" /></div>
      <div class="field"><label>ServerQuery 端口</label><input v-model.number="form.queryPort" class="input" type="number" min="1" max="65535" /></div>
      <div class="field"><label>语音端口</label><input v-model.number="form.serverPort" class="input" type="number" min="1" max="65535" /></div>
      <div class="field"><label>ServerQuery 账号</label><input v-model="form.username" class="input" /></div>
      <div class="field"><label>ServerQuery 密码</label><input v-model="form.password" class="input" type="password" /></div>
      <div class="field"><label>分站后台密码</label><input v-model="form.adminPassword" class="input" type="password" placeholder="至少 8 个字符" /></div>
    </div>
    <div class="modal-actions"><button class="btn primary" :disabled="creating || !canCreate" @click="create">{{ creating ? '创建中...' : '创建分站' }}</button></div>
    <div class="subsite-list-head"><h3>已创建分站</h3><button class="btn sm" :disabled="loading" @click="load">刷新</button></div>
    <div v-if="loading" class="hint">正在读取分站...</div>
    <div v-else-if="!subsites.length" class="empty">尚未创建分站</div>
    <div v-else class="subsite-list">
      <article v-for="subsite in subsites" :key="subsite.id" class="subsite-row">
        <div class="subsite-main"><strong>{{ subsite.displayName }}</strong><a :href="subsite.url" target="_blank" rel="noopener">{{ subsite.domain }}</a><small>{{ subsite.ts3Host }}:{{ subsite.serverPort }}</small></div>
        <div class="subsite-state" :class="{ ok: subsite.connected, disabled: !subsite.enabled }">{{ !subsite.enabled ? '已停用' : subsite.connected ? '已连接' : '连接中' }}</div>
        <button class="btn sm" @click="toggle(subsite)">{{ subsite.enabled ? '停用' : '启用' }}</button>
      </article>
    </div>
  </section>
</template>

<style scoped>
.subsites-panel { display: grid; gap: 16px; }.platform-note { display: grid; gap: 5px; padding: 13px 14px; border-left: 3px solid var(--sky); background: rgba(56, 189, 248, .08); color: var(--text-dim); font-size: 13px; line-height: 1.55; }.platform-note strong { color: var(--text); }.domain-setting { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 12px; padding: 14px; border: 1px solid var(--border); background: rgba(255,255,255,.025); }.provision-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }.subsite-list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 6px; border-top: 1px solid var(--border); }.subsite-list-head h3 { font-size: 15px; }.subsite-list { display: grid; gap: 8px; }.subsite-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--border); background: rgba(255,255,255,.025); }.subsite-main { display: grid; gap: 3px; min-width: 0; }.subsite-main strong { font-size: 14px; }.subsite-main a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.subsite-main small { color: var(--text-faint); font-size: 12px; }.subsite-state { color: var(--amber); font-size: 12px; font-weight: 700; white-space: nowrap; }.subsite-state.ok { color: var(--green); }.subsite-state.disabled { color: var(--text-faint); }.empty { padding: 22px; border: 1px dashed var(--border); color: var(--text-faint); text-align: center; font-size: 13px; } @media (max-width: 640px) { .domain-setting, .provision-grid { grid-template-columns: minmax(0, 1fr); }.subsite-row { grid-template-columns: minmax(0, 1fr) auto; }.subsite-state { grid-column: 1; }.subsite-row .btn { grid-column: 2; grid-row: 1 / span 2; } }
</style>
