<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from '../../api';
import { toast } from '../../composables/useToast';

const tutorial = ref({ download: '', basic: '', advanced: '', music: '' });
const download = ref({ version: '3.6.2', officialUrl: '', mirrorUrl: '', translationUrl: '' });
const notice = ref('');
const noticeType = ref<'success' | 'error' | 'warning'>('success');
const saving = ref(false);
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
    const config = await api.getTutorialConfig();
    tutorial.value = {
      download: config.tutorial?.download ?? '',
      basic: config.tutorial?.basic ?? '',
      advanced: config.tutorial?.advanced ?? '',
      music: config.tutorial?.music ?? '',
    };
    download.value = {
      version: config.clientDownload?.version ?? '3.6.2',
      officialUrl: config.clientDownload?.officialUrl ?? '',
      mirrorUrl: config.clientDownload?.mirrorUrl ?? '',
      translationUrl: config.clientDownload?.translationUrl ?? '',
    };
  } catch (error) {
    showNotice(`加载教程配置失败：${(error as Error).message}`, 'error');
  }
}

async function save(): Promise<void> {
  if (saving.value) {
    showNotice('正在保存教程配置，请勿重复操作', 'warning');
    return;
  }
  saving.value = true;
  try {
    await api.saveTutorialConfig({
      tutorial: tutorial.value,
      clientDownload: download.value,
    });
    showNotice('教程配置保存成功', 'success');
  } catch (error) {
    showNotice(`教程配置保存失败：${(error as Error).message}`, 'error');
  } finally {
    saving.value = false;
  }
}

onMounted(() => { void load(); });
onUnmounted(() => {
  if (noticeTimer) clearTimeout(noticeTimer);
});
</script>

<template>
  <div>
    <div v-if="notice" :class="['notice', noticeType]">{{ notice }}</div>
    <div class="field">
      <label>下载教程（Markdown，留空使用默认教程）</label>
      <textarea v-model="tutorial.download" class="input" rows="8" placeholder="留空使用默认教程"></textarea>
    </div>
    <div class="field">
      <label>基础教程（Markdown，留空使用默认教程）</label>
      <textarea v-model="tutorial.basic" class="input" rows="8" placeholder="留空使用默认教程"></textarea>
    </div>
    <div class="field">
      <label>进阶教程（Markdown，留空使用默认教程）</label>
      <textarea v-model="tutorial.advanced" class="input" rows="8" placeholder="留空使用默认教程"></textarea>
    </div>
    <div class="field">
      <label>音乐教程（Markdown，留空使用默认教程）</label>
      <textarea v-model="tutorial.music" class="input" rows="8" placeholder="留空使用默认教程"></textarea>
    </div>
    <div class="field">
      <label>官方下载链接</label>
      <input v-model="download.officialUrl" class="input" placeholder="留空使用默认" />
    </div>
    <div class="field">
      <label>备用下载链接</label>
      <input v-model="download.mirrorUrl" class="input" placeholder="留空使用默认" />
    </div>
    <div class="field">
      <label>汉化包链接</label>
      <input v-model="download.translationUrl" class="input" placeholder="留空使用默认" />
    </div>
    <div class="modal-actions"><button class="btn primary" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button></div>
  </div>
</template>
