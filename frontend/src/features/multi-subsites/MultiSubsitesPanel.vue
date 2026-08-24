<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { multiSubsiteApi } from './api';
import { toast } from '../../composables/useToast';
import type { CreateManagedSubsiteInput, ManagedSubsite, MultiSubsiteSettings, UpdateManagedSubsiteInput } from './types';

const subsites = ref<ManagedSubsite[]>([]);
const loading = ref(false);
const creating = ref(false);
const savingSettings = ref(false);
const savingEdit = ref(false);
const resettingPassword = ref(false);
const deleting = ref(false);

const notice = ref('');
const noticeType = ref<'success' | 'error' | 'warning'>('success');
const settings = ref<MultiSubsiteSettings>({ baseDomain: '' });

const form = ref<CreateManagedSubsiteInput>({
  displayName: '', slug: '', domain: '', ts3Host: '', queryPort: 10011, serverPort: 9987, serverId: 0, username: 'serveradmin', password: '', publicHost: '', publicPort: 9987, adminPassword: '',
});

// 编辑分站
const editingSubsite = ref<ManagedSubsite | null>(null);
const editForm = ref<UpdateManagedSubsiteInput & { id: number }>({
  id: 0, displayName: '', domain: '', ts3Host: '', queryPort: 10011, serverPort: 9987, serverId: 0, username: 'serveradmin', password: '', publicHost: '', publicPort: 9987,
});

// 重置密码
const resettingSubsite = ref<ManagedSubsite | null>(null);
const newAdminPassword = ref('');

// 删除分站
const deletingSubsite = ref<ManagedSubsite | null>(null);
const purgeDatabase = ref(false);

const canCreate = computed(() => Boolean(settings.value.baseDomain.trim() && form.value.displayName.trim() && form.value.slug.trim() && form.value.ts3Host.trim() && form.value.adminPassword));
const generatedDomain = computed(() => form.value.slug.trim().toLowerCase() ? `${form.value.slug.trim().toLowerCase()}.${settings.value.baseDomain.trim().toLowerCase()}` : `昵称.${settings.value.baseDomain.trim().toLowerCase() || 'example.com'}`);

function showNotice(message: string, type: 'success' | 'error' | 'warning' = 'success'): void {
  notice.value = message;
  noticeType.value = type;
  if (type === 'success') toast.success(message);
  else if (type === 'error') toast.error(message);
  else toast.warning(message);

  window.setTimeout(() => { if (notice.value === message) notice.value = ''; }, 4000);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [savedSettings, items] = await Promise.all([multiSubsiteApi.getSettings(), multiSubsiteApi.list()]);
    settings.value = savedSettings;
    subsites.value = items;
  }
  catch (error) { showNotice(`加载分站列表失败：${(error as Error).message}`, 'error'); }
  finally { loading.value = false; }
}

async function saveSettings(): Promise<void> {
  const base = settings.value.baseDomain.trim().toLowerCase();
  if (!base) {
    showNotice('保存失败：请输入分站根域名', 'warning');
    return;
  }
  if (savingSettings.value) return;
  savingSettings.value = true;
  try {
    settings.value = await multiSubsiteApi.saveSettings({ baseDomain: base });
    showNotice(`分站根域名保存成功：${settings.value.baseDomain}`, 'success');
  } catch (error) { showNotice(`保存分站根域名失败：${(error as Error).message}`, 'error'); }
  finally { savingSettings.value = false; }
}

async function create(): Promise<void> {
  if (!canCreate.value) {
    showNotice('创建失败：请完整填写分站信息（昵称、子域名、TS3 地址和后台密码）', 'warning');
    return;
  }
  if (creating.value) return;
  creating.value = true;
  try {
    const created = await multiSubsiteApi.create({ ...form.value, slug: form.value.slug.trim().toLowerCase(), displayName: form.value.displayName.trim(), ts3Host: form.value.ts3Host.trim() });
    subsites.value.unshift(created);
    form.value = { displayName: '', slug: '', domain: '', ts3Host: '', queryPort: 10011, serverPort: 9987, serverId: 0, username: 'serveradmin', password: '', publicHost: '', publicPort: 9987, adminPassword: '' };
    showNotice(`分站创建成功：${created.domain}`, 'success');
  } catch (error) { showNotice(`创建分站失败：${(error as Error).message}`, 'error'); }
  finally { creating.value = false; }
}

async function toggle(subsite: ManagedSubsite): Promise<void> {
  try {
    const updated = await multiSubsiteApi.setEnabled(subsite.id, !subsite.enabled);
    subsites.value = subsites.value.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
    showNotice(updated.enabled ? `分站「${subsite.displayName}」已启用` : `分站「${subsite.displayName}」已停用，数据已保留`, 'success');
  } catch (error) { showNotice(`切换分站状态失败：${(error as Error).message}`, 'error'); }
}

function openEdit(subsite: ManagedSubsite): void {
  editingSubsite.value = subsite;
  editForm.value = {
    id: subsite.id,
    displayName: subsite.displayName,
    domain: subsite.domain,
    ts3Host: subsite.ts3Host,
    queryPort: subsite.queryPort,
    serverPort: subsite.serverPort,
    serverId: subsite.serverId,
    username: subsite.username,
    password: '',
    publicHost: subsite.publicHost,
    publicPort: subsite.publicPort,
  };
}

async function saveEdit(): Promise<void> {
  if (!editForm.value.displayName?.trim() || !editForm.value.ts3Host?.trim()) {
    showNotice('保存失败：分站昵称和 TS3 地址不能为空', 'warning');
    return;
  }
  savingEdit.value = true;
  try {
    const updated = await multiSubsiteApi.update(editForm.value.id, {
      ...editForm.value,
      displayName: editForm.value.displayName.trim(),
      ts3Host: editForm.value.ts3Host.trim(),
      domain: editForm.value.domain?.trim() || undefined,
    });
    subsites.value = subsites.value.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
    editingSubsite.value = null;
    showNotice(`分站「${updated.displayName}」配置已更新并重新连接`, 'success');
  } catch (error) {
    showNotice(`更新分站失败：${(error as Error).message}`, 'error');
  } finally {
    savingEdit.value = false;
  }
}

function openResetPassword(subsite: ManagedSubsite): void {
  resettingSubsite.value = subsite;
  newAdminPassword.value = '';
}

async function submitResetPassword(): Promise<void> {
  if (!newAdminPassword.value || newAdminPassword.value.length < 8) {
    showNotice('重置失败：新密码至少需要 8 个字符', 'warning');
    return;
  }
  resettingPassword.value = true;
  try {
    await multiSubsiteApi.resetPassword(resettingSubsite.value!.id, newAdminPassword.value);
    resettingSubsite.value = null;
    newAdminPassword.value = '';
    showNotice('分站后台管理密码已成功重置', 'success');
  } catch (error) {
    showNotice(`重置密码失败：${(error as Error).message}`, 'error');
  } finally {
    resettingPassword.value = false;
  }
}

function openDelete(subsite: ManagedSubsite): void {
  deletingSubsite.value = subsite;
  purgeDatabase.value = false;
}

async function confirmDelete(): Promise<void> {
  if (!deletingSubsite.value) return;
  deleting.value = true;
  try {
    const id = deletingSubsite.value.id;
    const name = deletingSubsite.value.displayName;
    await multiSubsiteApi.delete(id, purgeDatabase.value);
    subsites.value = subsites.value.filter((item) => item.id !== id);
    deletingSubsite.value = null;
    showNotice(`分站「${name}」已成功删除${purgeDatabase.value ? '（已清除数据库文件）' : '（数据已保留）'}`, 'success');
  } catch (error) {
    showNotice(`删除分站失败：${(error as Error).message}`, 'error');
  } finally {
    deleting.value = false;
  }
}

onMounted(() => { void load(); });
</script>

<template>
  <section class="subsites-panel">
    <div v-if="notice" :class="['notice', noticeType]">{{ notice }}</div>
    <div class="platform-note">
      <strong>统一分站管理</strong>
      <span>新分站拥有独立数据库、TS3 连接和后台密码。访问生效前，请将泛解析 DNS 与反向代理指向本服务。</span>
    </div>

    <!-- 根域名配置 -->
    <div class="domain-setting">
      <div class="field">
        <label>分站根域名</label>
        <input v-model="settings.baseDomain" class="input" placeholder="例如 example.com" @keyup.enter="saveSettings" />
        <p class="hint">保存后，创建 alpha 分站会生成 alpha.example.com。</p>
      </div>
      <button class="btn primary" :disabled="savingSettings || !settings.baseDomain.trim()" @click="saveSettings">
        {{ savingSettings ? '保存中...' : '保存根域名' }}
      </button>
    </div>

    <!-- 创建新分站 -->
    <div class="provision-grid">
      <div class="field"><label>分站昵称</label><input v-model="form.displayName" class="input" placeholder="例如 Alpha 语音" /></div>
      <div class="field"><label>子域名</label><input v-model="form.slug" class="input" placeholder="例如 alpha" /><p class="hint">将生成 {{ generatedDomain }}</p></div>
      <div class="field"><label>TS3 ServerQuery 地址</label><input v-model="form.ts3Host" class="input" placeholder="例如 127.0.0.1" /></div>
      <div class="field"><label>ServerQuery 端口</label><input v-model.number="form.queryPort" class="input" type="number" min="1" max="65535" /></div>
      <div class="field"><label>语音端口</label><input v-model.number="form.serverPort" class="input" type="number" min="1" max="65535" /></div>
      <div class="field"><label>虚拟服务器 ID（可选）</label><input v-model.number="form.serverId" class="input" type="number" min="0" step="1" /></div>
      <div class="field"><label>ServerQuery 账号</label><input v-model="form.username" class="input" /></div>
      <div class="field"><label>ServerQuery 密码</label><input v-model="form.password" class="input" type="password" /></div>
      <div class="field"><label>分站后台密码</label><input v-model="form.adminPassword" class="input" type="password" placeholder="至少 8 个字符" /></div>
    </div>
    <div class="modal-actions">
      <button class="btn primary" :disabled="creating || !canCreate" @click="create">
        {{ creating ? '创建中...' : '创建分站' }}
      </button>
    </div>

    <!-- 已创建分站列表 -->
    <div class="subsite-list-head">
      <h3>已创建分站</h3>
      <button class="btn sm" :disabled="loading" @click="load">刷新</button>
    </div>
    <div v-if="loading" class="hint">正在读取分站...</div>
    <div v-else-if="!subsites.length" class="empty">尚未创建分站</div>
    <div v-else class="subsite-list">
      <article v-for="subsite in subsites" :key="subsite.id" class="subsite-row">
        <div class="subsite-main">
          <div class="subsite-title-row">
            <strong>{{ subsite.displayName }}</strong>
            <span class="subsite-badge slug-badge">{{ subsite.slug }}</span>
          </div>
          <a :href="subsite.url" target="_blank" rel="noopener">{{ subsite.domain }}</a>
          <small>{{ subsite.ts3Host }}:{{ subsite.serverPort }} (ID: {{ subsite.serverId }})</small>
        </div>

        <div class="subsite-status-col">
          <div
            class="subsite-state"
            :class="{ ok: subsite.connected && subsite.enabled, disabled: !subsite.enabled, err: !subsite.connected && subsite.enabled }"
            :title="subsite.lastError || ''"
          >
            <i class="dot"></i>
            <span>{{ !subsite.enabled ? '已停用' : subsite.connected ? '已连接' : '连接异常' }}</span>
          </div>
          <small v-if="!subsite.connected && subsite.enabled && subsite.lastError" class="error-hint" :title="subsite.lastError">
            {{ subsite.lastError }}
          </small>
        </div>

        <div class="subsite-actions">
          <button class="btn sm" :class="{ primary: !subsite.enabled }" @click="toggle(subsite)">
            {{ subsite.enabled ? '停用' : '启用' }}
          </button>
          <button class="btn sm" @click="openEdit(subsite)">编辑</button>
          <button class="btn sm" @click="openResetPassword(subsite)">重置密码</button>
          <button class="btn sm danger" @click="openDelete(subsite)">删除</button>
        </div>
      </article>
    </div>

    <!-- 编辑分站弹窗 -->
    <div v-if="editingSubsite" class="subsite-modal-mask" @click.self="editingSubsite = null">
      <div class="subsite-modal">
        <h3>编辑分站 · {{ editingSubsite.slug }}</h3>
        <div class="provision-grid">
          <div class="field"><label>分站昵称</label><input v-model="editForm.displayName" class="input" /></div>
          <div class="field"><label>绑定访问域名</label><input v-model="editForm.domain" class="input" placeholder="留空使用默认子域名" /></div>
          <div class="field"><label>TS3 ServerQuery 地址</label><input v-model="editForm.ts3Host" class="input" /></div>
          <div class="field"><label>ServerQuery 端口</label><input v-model.number="editForm.queryPort" class="input" type="number" /></div>
          <div class="field"><label>语音端口</label><input v-model.number="editForm.serverPort" class="input" type="number" /></div>
          <div class="field"><label>虚拟服务器 ID</label><input v-model.number="editForm.serverId" class="input" type="number" min="0" /></div>
          <div class="field"><label>ServerQuery 账号</label><input v-model="editForm.username" class="input" /></div>
          <div class="field"><label>ServerQuery 密码</label><input v-model="editForm.password" class="input" type="password" placeholder="留空保持原密码" /></div>
        </div>
        <div class="modal-buttons">
          <button class="btn sm" @click="editingSubsite = null">取消</button>
          <button class="btn sm primary" :disabled="savingEdit" @click="saveEdit">{{ savingEdit ? '保存中...' : '保存更改' }}</button>
        </div>
      </div>
    </div>

    <!-- 重置密码弹窗 -->
    <div v-if="resettingSubsite" class="subsite-modal-mask" @click.self="resettingSubsite = null">
      <div class="subsite-modal small-modal">
        <h3>重置分站密码 · {{ resettingSubsite.displayName }}</h3>
        <p class="modal-desc">为分站 <code>{{ resettingSubsite.domain }}</code> 设置新的后台管理员密码。</p>
        <div class="field">
          <label>新后台管理密码</label>
          <input v-model="newAdminPassword" class="input" type="password" placeholder="至少 8 个字符" @keyup.enter="submitResetPassword" />
        </div>
        <div class="modal-buttons">
          <button class="btn sm" @click="resettingSubsite = null">取消</button>
          <button class="btn sm primary" :disabled="resettingPassword || newAdminPassword.length < 8" @click="submitResetPassword">
            {{ resettingPassword ? '重置中...' : '确认重置' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="deletingSubsite" class="subsite-modal-mask" @click.self="deletingSubsite = null">
      <div class="subsite-modal small-modal">
        <h3 style="color: var(--red)">确认删除分站？</h3>
        <p class="modal-desc">您正在删除分站 <strong>「{{ deletingSubsite.displayName }}」</strong> ({{ deletingSubsite.domain }})。删除后该分站将停止运行并从总站注销。</p>
        <label class="purge-check">
          <input v-model="purgeDatabase" type="checkbox" />
          <span>同时物理删除本地数据库文件（<code>{{ deletingSubsite.slug }}.db</code>）</span>
        </label>
        <div class="modal-buttons">
          <button class="btn sm" @click="deletingSubsite = null">取消</button>
          <button class="btn sm danger" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? '删除中...' : '彻底删除' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.subsites-panel { display: grid; gap: 16px; }
.platform-note { display: grid; gap: 5px; padding: 13px 14px; border-left: 3px solid var(--sky); background: rgba(56, 189, 248, .08); color: var(--text-dim); font-size: 13px; line-height: 1.55; }
.platform-note strong { color: var(--text); }
.domain-setting { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 12px; padding: 14px; border: 1px solid var(--border); background: rgba(255,255,255,.025); }
.provision-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.subsite-list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 6px; border-top: 1px solid var(--border); }
.subsite-list-head h3 { font-size: 15px; margin: 0; }
.subsite-list { display: grid; gap: 8px; }
.subsite-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.8fr) auto; align-items: center; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: rgba(255,255,255,.025); }
.subsite-main { display: grid; gap: 4px; min-width: 0; }
.subsite-title-row { display: flex; align-items: center; gap: 8px; }
.subsite-title-row strong { font-size: 15px; color: var(--text); }
.subsite-badge { padding: 2px 6px; font-size: 11px; border-radius: 4px; font-family: monospace; background: rgba(255,255,255,0.06); color: var(--text-dim); }
.subsite-main a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--primary); text-decoration: none; }
.subsite-main a:hover { text-decoration: underline; }
.subsite-main small { color: var(--text-faint); font-size: 12px; }
.subsite-status-col { display: grid; gap: 2px; }
.subsite-state { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--amber); }
.subsite-state .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.subsite-state.ok { color: var(--green); }
.subsite-state.disabled { color: var(--text-faint); }
.subsite-state.err { color: var(--red); }
.error-hint { color: var(--red); font-size: 11px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.subsite-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.empty { padding: 22px; border: 1px dashed var(--border); color: var(--text-faint); text-align: center; font-size: 13px; }

/* 模态框 */
.subsite-modal-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; }
.subsite-modal { width: 100%; max-width: 640px; background: #18181b; border: 1px solid var(--border); border-radius: 12px; padding: 22px; display: grid; gap: 16px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
.subsite-modal.small-modal { max-width: 440px; }
.subsite-modal h3 { margin: 0; font-size: 17px; color: var(--text); }
.modal-desc { margin: 0; font-size: 13px; color: var(--text-dim); line-height: 1.5; }
.modal-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.purge-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-dim); cursor: pointer; }
.purge-check input { cursor: pointer; }

@media (max-width: 768px) {
  .domain-setting, .provision-grid { grid-template-columns: minmax(0, 1fr); }
  .subsite-row { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .subsite-actions { width: 100%; }
}
</style>
