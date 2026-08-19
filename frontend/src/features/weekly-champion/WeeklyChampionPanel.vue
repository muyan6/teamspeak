<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import type { ChampionConfig, ServerGroup } from '../../types';

const champion = ref<ChampionConfig | null>(null);
const groups = ref<ServerGroup[]>([]);
const form = ref({ enabled: 0, serverGroupId: 0, checkIntervalHours: 24 });
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function showNotice(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3000);
}

async function load(): Promise<void> {
  try {
    const [config, serverGroups] = await Promise.all([api.getChampionConfig(), api.getServerGroups()]);
    champion.value = config;
    groups.value = serverGroups;
    form.value = {
      enabled: config.enabled,
      serverGroupId: config.serverGroupId ?? 0,
      checkIntervalHours: config.checkIntervalHours,
    };
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function save(): Promise<void> {
  if (!form.value.serverGroupId || form.value.checkIntervalHours <= 0) {
    showNotice('请选择奖励服务器组，并填写有效检测间隔');
    return;
  }
  try {
    await api.saveChampionConfig(form.value);
    showNotice('周冠军配置已保存');
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function runCheck(): Promise<void> {
  try {
    const result = await api.checkChampion();
    showNotice(result.result ? `本周冠军：${result.result.nickname}` : '未检测到本周冠军');
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

onMounted(() => { void load(); });
</script>

<template>
  <div>
    <div v-if="notice" class="notice">{{ notice }}</div>
    <div class="field">
      <label>启用周冠军</label>
      <select v-model.number="form.enabled" class="input">
        <option :value="0">关闭</option>
        <option :value="1">启用</option>
      </select>
    </div>
    <div class="field">
      <label>奖励服务器组</label>
      <select v-model.number="form.serverGroupId" class="input">
        <option :value="0" disabled>选择服务器组</option>
        <option v-for="group in groups" :key="group.sgid" :value="group.sgid">{{ group.name }}</option>
      </select>
    </div>
    <div class="field">
      <label>检测间隔（小时）</label>
      <input v-model.number="form.checkIntervalHours" class="input" type="number" min="1" />
    </div>
    <div v-if="champion?.lastWinnerNickname" class="champion-last">上期冠军：{{ champion.lastWinnerNickname }}</div>
    <div class="modal-actions">
      <button class="btn sm" @click="runCheck">立即检测</button>
      <button class="btn primary" @click="save">保存配置</button>
    </div>
  </div>
</template>
