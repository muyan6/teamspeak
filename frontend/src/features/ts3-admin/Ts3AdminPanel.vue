<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from '../../api';
import type { AdminChannel, AdminClient, ChannelGroup, ServerGroup } from '../../types';

const subTab = ref<'channels' | 'clients'>('channels');
const channels = ref<AdminChannel[]>([]);
const clients = ref<AdminClient[]>([]);
const serverGroups = ref<ServerGroup[]>([]);
const channelGroups = ref<ChannelGroup[]>([]);
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
function showNotice(msg: string): void {
  notice.value = msg;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.value = '';
  }, 3000);
}

const chForm = ref({ name: '', cpid: 0, password: '' });
const editing = ref<{ cid: number; name: string; cpid: number; password: string; maxclients: number } | null>(null);

const moveSel = ref<Record<number, number>>({});
const assignSel = ref<Record<number, number>>({});
const cgSel = ref<Record<number, number>>({});

async function loadAll() {
  try {
    const [chs, cls, sgs, cgs] = await Promise.all([
      api.listChannels(),
      api.listClients(),
      api.getServerGroups(),
      api.listChannelGroups(),
    ]);
    channels.value = chs;
    clients.value = cls;
    serverGroups.value = sgs;
    channelGroups.value = cgs;
  } catch (e) {
    showNotice((e as Error).message);
  }
}

async function loadClients() {
  try {
    const [chs, cls] = await Promise.all([api.listChannels(), api.listClients()]);
    channels.value = chs;
    clients.value = cls;
  } catch (e) {
    showNotice((e as Error).message);
  }
}

async function createChannel() {
  if (!chForm.value.name.trim()) return;
  try {
    await api.createChannel({
      name: chForm.value.name.trim(),
      cpid: chForm.value.cpid || undefined,
      password: chForm.value.password || undefined,
    });
    chForm.value = { name: '', cpid: 0, password: '' };
    showNotice('频道已创建');
    await loadAll();
  } catch (err) {
    showNotice(`创建频道失败: ${(err as Error).message}`);
  }
}

async function removeChannel(cid: number) {
  if (!window.confirm(`确定删除频道 #${cid} 及其所有子频道？此操作不可撤销。`)) return;
  try {
    await api.deleteChannel(cid);
    showNotice('频道已删除');
    await loadAll();
  } catch (err) {
    showNotice(`删除频道失败: ${(err as Error).message}`);
  }
}

function startEdit(ch: AdminChannel) {
  editing.value = { cid: ch.cid, name: ch.name, cpid: ch.parentId, password: '', maxclients: 0 };
}

async function saveEdit() {
  if (!editing.value) return;
  const e = editing.value;
  try {
    await api.editChannel(e.cid, {
      name: e.name || undefined,
      cpid: e.cpid,
      password: e.password,
      maxclients: e.maxclients > 0 ? e.maxclients : undefined,
    });
    editing.value = null;
    showNotice('频道已更新');
    await loadAll();
  } catch (err) {
    showNotice(`更新频道失败: ${(err as Error).message}`);
  }
}

async function kick(clid: number) {
  const c = clients.value.find((x) => x.clid === clid);
  if (!window.confirm(`确定将「${c?.nickname ?? clid}」踢出服务器？`)) return;
  try {
    await api.kickClient(clid);
    showNotice('已踢出');
    await loadAll();
  } catch (err) {
    showNotice(`踢出失败: ${(err as Error).message}`);
  }
}

async function ban(c: AdminClient) {
  if (!window.confirm(`确定封禁用户「${c.nickname}」？`)) return;
  const input = window.prompt('封禁时长（秒，留空为永久）：');
  const time = input && input.trim() !== '' ? parseInt(input.trim(), 10) : undefined;
  try {
    await api.banClient(c.clid, c.uniqueIdentifier, undefined, Number.isFinite(time) ? time : undefined);
    showNotice('已封禁');
    await loadAll();
  } catch (err) {
    showNotice(`封禁失败: ${(err as Error).message}`);
  }
}

async function move(clid: number) {
  const cid = moveSel.value[clid];
  if (!cid) return;
  const password = window.prompt('目标频道密码（无密码请留空）：');
  try {
    await api.moveClient(clid, cid, password && password.trim() !== '' ? password.trim() : undefined);
    showNotice('已移动');
    await loadAll();
  } catch (err) {
    showNotice(`移动失败: ${(err as Error).message}`);
  }
}

async function assign(clid: number) {
  const sgid = assignSel.value[clid];
  const c = clients.value.find((x) => x.clid === clid);
  if (!sgid || !c) return;
  try {
    await api.assignServerGroup(sgid, c.clientDatabaseId);
    showNotice('已分配权限');
    await loadAll();
  } catch (err) {
    showNotice(`分配权限失败: ${(err as Error).message}`);
  }
}

async function unassign(clid: number, sgid: number) {
  const c = clients.value.find((x) => x.clid === clid);
  if (!c) return;
  try {
    await api.removeServerGroup(sgid, c.clientDatabaseId);
    showNotice('已移除权限');
    await loadAll();
  } catch (err) {
    showNotice(`移除权限失败: ${(err as Error).message}`);
  }
}

async function assignCg(c: AdminClient) {
  const cgid = cgSel.value[c.clid];
  if (!cgid) return;
  try {
    await api.assignChannelGroup(cgid, c.channelId, c.clientDatabaseId);
    showNotice(`已授予「${c.nickname}」频道组`);
    await loadAll();
  } catch (err) {
    showNotice(`授予频道组失败: ${(err as Error).message}`);
  }
}

async function removeCg(c: AdminClient) {
  if (!window.confirm(`确定移除「${c.nickname}」在频道「${c.channelName}」的频道组？`)) return;
  try {
    await api.removeChannelGroup(c.channelId, c.clientDatabaseId);
    showNotice('已移除频道组');
    await loadAll();
  } catch (err) {
    showNotice(`移除频道组失败: ${(err as Error).message}`);
  }
}

function sgName(sgid: number): string {
  const g = serverGroups.value.find((x) => x.sgid === sgid);
  return g ? g.name : `SG${sgid}`;
}

function cgName(cgid: number): string {
  const g = channelGroups.value.find((x) => x.cgid === cgid);
  return g ? g.name : `CG${cgid}`;
}

function channelName(cid: number): string {
  const c = channels.value.find((x) => x.cid === cid);
  return c ? c.name : `#${cid}`;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  void loadAll();
  refreshTimer = setInterval(loadClients, 10000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <div>
    <div v-if="notice" class="notice">{{ notice }}</div>

    <div class="tabs" style="margin-bottom: 14px">
      <button class="btn sm" :class="{ primary: subTab === 'channels' }" @click="subTab = 'channels'">频道管理</button>
      <button class="btn sm" :class="{ primary: subTab === 'clients' }" @click="subTab = 'clients'">在线用户</button>
    </div>

    <!-- 频道管理 -->
    <div v-if="subTab === 'channels'">
      <div class="field">
        <label>创建频道</label>
        <div class="form-row">
          <input v-model="chForm.name" class="input" placeholder="频道名" />
          <select v-model.number="chForm.cpid" class="input">
            <option :value="0">根目录（无父频道）</option>
            <option v-for="c in channels" :key="c.cid" :value="c.cid">{{ c.name }}</option>
          </select>
          <input v-model="chForm.password" class="input" placeholder="密码(可选)" />
          <button class="btn primary" @click="createChannel">创建</button>
        </div>
      </div>

      <div v-if="editing" class="edit-panel">
        <div class="field">
          <label>编辑频道 #{{ editing.cid }}</label>
          <div class="form-row">
            <input v-model="editing.name" class="input" placeholder="频道名" />
            <select v-model.number="editing.cpid" class="input">
              <option :value="0">根目录（无父频道）</option>
              <option v-for="c in channels.filter((x) => x.cid !== editing!.cid)" :key="c.cid" :value="c.cid">{{ c.name }}</option>
            </select>
            <input v-model="editing.password" class="input" placeholder="新密码(可选)" />
            <input v-model.number="editing.maxclients" class="input" type="number" placeholder="人数上限(0不改)" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn sm" @click="editing = null">取消</button>
          <button class="btn primary" @click="saveEdit">保存</button>
        </div>
      </div>

      <table class="tbl">
        <thead><tr><th>频道名</th><th>在线</th><th>父频道</th><th style="text-align: right">操作</th></tr></thead>
        <tbody>
          <tr v-for="c in channels" :key="c.cid">
            <td>{{ c.name }}</td>
            <td>{{ c.totalClients }}</td>
            <td>{{ c.parentId === 0 ? '—' : channelName(c.parentId) }}</td>
            <td style="text-align: right">
              <button class="btn sm" @click="startEdit(c)">编辑</button>
              <button class="btn sm danger" @click="removeChannel(c.cid)">删除</button>
            </td>
          </tr>
          <tr v-if="channels.length === 0"><td colspan="4" class="mono" style="text-align: center">暂无频道</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 在线用户 -->
    <div v-else>
      <table class="tbl">
        <thead><tr><th>用户</th><th>频道</th><th>服务器组</th><th>频道权限</th><th style="text-align: right">操作</th></tr></thead>
        <tbody>
          <tr v-for="c in clients" :key="c.clid">
            <td>
              <div style="font-weight: 700">{{ c.nickname }}</div>
              <div class="mono" style="font-size: 10px; color: var(--text-faint)">DBID {{ c.clientDatabaseId }}</div>
            </td>
            <td>{{ c.channelName || '—' }}</td>
            <td>
              <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center">
                <span v-for="sgid in c.serverGroupIds" :key="sgid" class="badge group-badge" style="cursor: pointer" :title="`移除 ${sgName(sgid)}`" @click="unassign(c.clid, sgid)">
                  {{ sgName(sgid) }} ×
                </span>
                <select v-model.number="assignSel[c.clid]" class="input" style="width: 110px; padding: 2px 6px; font-size: 11px">
                  <option :value="0" disabled>+ 分配组</option>
                  <option v-for="g in serverGroups" :key="g.sgid" :value="g.sgid">{{ g.name }}</option>
                </select>
                <button class="btn sm" @click="assign(c.clid)">分配</button>
              </div>
            </td>
            <td>
              <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center">
                <span v-if="c.channelGroupId" class="badge group-badge" style="cursor: pointer" :title="`移除 ${cgName(c.channelGroupId)}`" @click="removeCg(c)">
                  {{ cgName(c.channelGroupId) }} ×
                </span>
                <select v-model.number="cgSel[c.clid]" class="input" style="width: 110px; padding: 2px 6px; font-size: 11px">
                  <option :value="0" disabled>+ 频道组</option>
                  <option v-for="g in channelGroups" :key="g.cgid" :value="g.cgid">{{ g.name }}</option>
                </select>
                <button class="btn sm" @click="assignCg(c)">授权</button>
              </div>
            </td>
            <td style="text-align: right">
              <select v-model.number="moveSel[c.clid]" class="input" style="width: 110px; padding: 2px 6px; font-size: 11px">
                <option :value="0" disabled>移动到…</option>
                <option v-for="ch in channels" :key="ch.cid" :value="ch.cid">{{ ch.name }}</option>
              </select>
              <button class="btn sm" @click="move(c.clid)">移动</button>
              <button class="btn sm danger" @click="kick(c.clid)">踢出</button>
              <button class="btn sm danger" @click="ban(c)">封禁</button>
            </td>
          </tr>
          <tr v-if="clients.length === 0"><td colspan="5" class="mono" style="text-align: center">当前无在线用户</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.edit-panel {
  padding: 12px;
  border-radius: 12px;
  background: var(--bg-hover);
  margin-bottom: 12px;
}
</style>
