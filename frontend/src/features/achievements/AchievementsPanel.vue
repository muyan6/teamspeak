<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import type { AchievementLevel, ServerGroup, UnlockedAchievement } from '../../types';

const levels = ref<AchievementLevel[]>([]);
const unlocked = ref<UnlockedAchievement[]>([]);
const groups = ref<ServerGroup[]>([]);
const form = ref({ title: '', hours: 1, serverGroupId: 0 });
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function showNotice(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3000);
}

async function load(): Promise<void> {
  try {
    const [achievementLevels, unlockedAchievements, serverGroups] = await Promise.all([
      api.listAchievementLevels(),
      api.listUnlockedAchievements(),
      api.getServerGroups(),
    ]);
    levels.value = achievementLevels;
    unlocked.value = unlockedAchievements;
    groups.value = serverGroups;
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function add(): Promise<void> {
  if (!form.value.title.trim() || form.value.hours < 0 || !form.value.serverGroupId) return;
  try {
    await api.addAchievementLevel({ ...form.value, title: form.value.title.trim() });
    form.value = { title: '', hours: 1, serverGroupId: 0 };
    showNotice('在线时长成就已添加');
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function toggle(level: AchievementLevel): Promise<void> {
  try {
    await api.updateAchievementLevel(level.id, { ...level, enabled: level.enabled ? 0 : 1 });
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function remove(id: number): Promise<void> {
  try {
    await api.deleteAchievementLevel(id);
    showNotice('成就已删除');
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function runCheck(): Promise<void> {
  try {
    const result = await api.checkAchievements();
    const granted = result.results.filter((entry) => entry.granted).length;
    showNotice(granted ? `已授予 ${granted} 项成就` : '本轮没有新增成就');
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

function groupName(serverGroupId: number): string {
  return groups.value.find((group) => group.sgid === serverGroupId)?.name || `SG${serverGroupId}`;
}

onMounted(() => { void load(); });
</script>

<template>
  <div>
    <div v-if="notice" class="notice">{{ notice }}</div>
    <div class="modal-actions" style="margin-top: 0"><button class="btn sm" @click="runCheck">立即检测</button></div>
    <table class="tbl">
      <thead><tr><th>成就</th><th>在线时长</th><th>奖励服务器组</th><th>状态</th><th></th></tr></thead>
      <tbody>
        <tr v-for="level in levels" :key="level.id">
          <td>{{ level.title }}</td>
          <td>{{ level.hours }} 小时</td>
          <td>{{ groupName(level.serverGroupId) }}</td>
          <td><button class="btn sm" :class="{ primary: level.enabled }" @click="toggle(level)">{{ level.enabled ? '已启用' : '已停用' }}</button></td>
          <td style="text-align: right"><button class="btn sm danger" @click="remove(level.id)">删除</button></td>
        </tr>
        <tr class="tbl-form-row">
          <td><input v-model="form.title" class="input" placeholder="成就名称" /></td>
          <td><input v-model.number="form.hours" class="input" type="number" min="0" placeholder="小时" /></td>
          <td>
            <select v-model.number="form.serverGroupId" class="input">
              <option :value="0" disabled>选择服务器组</option>
              <option v-for="group in groups" :key="group.sgid" :value="group.sgid">{{ group.name }}</option>
            </select>
          </td>
          <td colspan="2" style="text-align: right"><button class="btn primary" @click="add">添加</button></td>
        </tr>
      </tbody>
    </table>
    <div class="history">
      <div class="section-title">最近已解锁</div>
      <div v-if="!unlocked.length" class="empty">暂无已解锁成就</div>
      <ul v-else class="history-list">
        <li v-for="entry in unlocked.slice(0, 10)" :key="`${entry.nickname}-${entry.title}`">
          <span>{{ entry.nickname }}</span><span>{{ entry.title }} · {{ entry.hours }} 小时</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.history { margin-top: 20px; }
.history-list { display: grid; gap: 8px; margin: 10px 0 0; padding: 0; list-style: none; }
.history-list li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; color: var(--text-dim); font-size: 13px; }
</style>
