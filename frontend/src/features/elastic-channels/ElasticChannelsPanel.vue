<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import type { ElasticGroup } from '../../types';

const groups = ref<ElasticGroup[]>([]);
const form = ref({ name: '', namePrefix: '', createThreshold: 2, deleteThreshold: 0, maxChannels: 8 });
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function showNotice(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3000);
}

async function load(): Promise<void> {
  try {
    groups.value = await api.listElasticGroups();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function add(): Promise<void> {
  if (!form.value.name.trim() || !form.value.namePrefix.trim()) return;
  try {
    await api.addElasticGroup({ ...form.value, name: form.value.name.trim(), namePrefix: form.value.namePrefix.trim() });
    form.value = { name: '', namePrefix: '', createThreshold: 2, deleteThreshold: 0, maxChannels: 8 };
    showNotice('弹性频道组已添加');
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function remove(id: number): Promise<void> {
  try {
    await api.deleteElasticGroup(id);
    showNotice('弹性频道组已删除');
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
    <table class="tbl">
      <thead><tr><th>名称</th><th>前缀</th><th>满员阈值</th><th>最大频道</th><th></th></tr></thead>
      <tbody>
        <tr v-for="group in groups" :key="group.id">
          <td>{{ group.name }}</td>
          <td class="mono">{{ group.namePrefix }}</td>
          <td>{{ group.createThreshold }}</td>
          <td>{{ group.maxChannels }}</td>
          <td style="text-align: right"><button class="btn sm danger" @click="remove(group.id)">删除</button></td>
        </tr>
        <tr class="tbl-form-row">
          <td><input v-model="form.name" class="input" placeholder="名称" /></td>
          <td><input v-model="form.namePrefix" class="input" placeholder="频道前缀" /></td>
          <td><input v-model.number="form.createThreshold" class="input" type="number" min="1" placeholder="满员阈值" /></td>
          <td><input v-model.number="form.maxChannels" class="input" type="number" min="1" placeholder="最大频道" /></td>
          <td style="text-align: right"><button class="btn primary" @click="add">添加</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
