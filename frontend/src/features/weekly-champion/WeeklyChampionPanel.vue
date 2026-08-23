<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import { toast } from '../../composables/useToast';
import type { ChampionConfig, ServerGroup } from '../../types';

const champion = ref<ChampionConfig | null>(null);
const groups = ref<ServerGroup[]>([]);
const form = ref({ enabled: 0, serverGroupId: 0, checkIntervalHours: 24 });
const notice = ref('');
const noticeType = ref<'success' | 'error' | 'warning'>('success');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function showNotice(message: string, type: 'success' | 'error' | 'warning' = 'success'): void {
  notice.value = message;
  noticeType.value = type;
  if (type === 'success') toast.success(message);
  else if (type === 'error') toast.error(message);
  else toast.warning(message);

  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3500);
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
    showNotice(`加载周冠军配置失败：${(error as Error).message}`, 'error');
  }
}

async function save(): Promise<void> {
  if (form.value.enabled === 1 && (!form.value.serverGroupId || form.value.serverGroupId <= 0)) {
    showNotice('保存失败：启用周冠军时必须选择奖励服务器组', 'warning');
    return;
  }
  if (form.value.checkIntervalHours <= 0) {
    showNotice('保存失败：请填写有效的检测周期（大于 0 小时）', 'warning');
    return;
  }
  try {
    await api.saveChampionConfig(form.value);
    showNotice('周冠军配置保存成功', 'success');
    await load();
  } catch (error) {
    showNotice(`保存周冠军配置失败：${(error as Error).message}`, 'error');
  }
}

async function runCheck(): Promise<void> {
  try {
    const result = await api.checkChampion();
    const msg = result.result ? `检测完成，本周冠军：${result.result.nickname}` : '检测完成，未检测到符合条件的本周冠军';
    showNotice(msg, 'success');
    await load();
  } catch (error) {
    showNotice(`检测周冠军失败：${(error as Error).message}`, 'error');
  }
}

onMounted(() => { void load(); });
</script>

<template>
  <div>
    <div v-if="notice" :class="['notice', noticeType]">{{ notice }}</div>
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
