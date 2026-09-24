<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import { toast } from '../../composables/useToast';
import type { AdminChannel, ElasticGroup } from '../../types';

const groups = ref<ElasticGroup[]>([]);
const channels = ref<AdminChannel[]>([]);
const form = ref({ name: '', namePrefix: '', baseChannelId: 0, createThreshold: 2, deleteThreshold: 0, maxChannels: 8 });
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
    const [groupList, channelList] = await Promise.all([
      api.listElasticGroups(),
      api.listChannels().catch(() => []),
    ]);
    groups.value = groupList;
    channels.value = channelList;
  } catch (error) {
    showNotice(`加载弹性频道列表失败：${(error as Error).message}`, 'error');
  }
}

function getChannelName(cid: number | null): string {
  if (!cid) return '根目录';
  const c = channels.value.find((item) => item.cid === cid);
  return c ? c.name : `#${cid}`;
}

async function add(): Promise<void> {
  const name = form.value.name.trim();
  const prefix = form.value.namePrefix.trim();
  if (!name || !prefix) {
    showNotice('添加失败：请填写频道组名称和频道前缀', 'warning');
    return;
  }
  if (!form.value.createThreshold || form.value.createThreshold < 1 || !form.value.maxChannels || form.value.maxChannels < 1) {
    showNotice('添加失败：满员阈值与最大频道数必须为大于 0 的有效数字', 'warning');
    return;
  }

  try {
    await api.addElasticGroup({
      ...form.value,
      name,
      namePrefix: prefix,
      baseChannelId: form.value.baseChannelId > 0 ? form.value.baseChannelId : null,
    });
    form.value = { name: '', namePrefix: '', baseChannelId: 0, createThreshold: 2, deleteThreshold: 0, maxChannels: 8 };
    showNotice(`弹性频道组「${name}」添加成功`, 'success');
    await load();
  } catch (error) {
    showNotice(`添加弹性频道组失败：${(error as Error).message}`, 'error');
  }
}

async function remove(id: number): Promise<void> {
  const target = groups.value.find((g) => g.id === id);
  const name = target ? target.name : `#${id}`;
  if (!window.confirm(`确定删除弹性频道组「${name}」？`)) return;

  try {
    await api.deleteElasticGroup(id);
    showNotice(`弹性频道组「${name}」删除成功`, 'success');
    await load();
  } catch (error) {
    showNotice(`删除弹性频道组失败：${(error as Error).message}`, 'error');
  }
}

onMounted(() => { void load(); });
</script>

<template>
  <div>
    <div v-if="notice" :class="['notice', noticeType]">{{ notice }}</div>
    <table class="tbl">
      <thead><tr><th>名称</th><th>前缀</th><th>父频道</th><th>满员阈值</th><th>最大频道</th><th></th></tr></thead>
      <tbody>
        <tr v-for="group in groups" :key="group.id">
          <td>{{ group.name }}</td>
          <td class="mono">{{ group.namePrefix }}</td>
          <td>{{ getChannelName(group.baseChannelId) }}</td>
          <td>{{ group.createThreshold }}</td>
          <td>{{ group.maxChannels }}</td>
          <td style="text-align: right"><button class="btn sm danger" @click="remove(group.id)">删除</button></td>
        </tr>
        <tr class="tbl-form-row">
          <td><input v-model="form.name" class="input" placeholder="名称" /></td>
          <td><input v-model="form.namePrefix" class="input" placeholder="频道前缀" /></td>
          <td>
            <select v-model.number="form.baseChannelId" class="input">
              <option :value="0">根目录（顶级）</option>
              <option v-for="c in channels" :key="c.cid" :value="c.cid">{{ c.name }}</option>
            </select>
          </td>
          <td><input v-model.number="form.createThreshold" class="input" type="number" min="1" placeholder="满员阈值" /></td>
          <td><input v-model.number="form.maxChannels" class="input" type="number" min="1" placeholder="最大频道" /></td>
          <td style="text-align: right"><button class="btn primary" @click="add">添加</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
