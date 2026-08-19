<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';

const tutorial = ref({ download: '', basic: '', advanced: '' });
const download = ref({ version: '3.6.2', officialUrl: '', mirrorUrl: '', translationUrl: '' });
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function showNotice(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3000);
}

async function load(): Promise<void> {
  try {
    const config = await api.getTutorialConfig();
    tutorial.value = {
      download: config.tutorial?.download ?? '',
      basic: config.tutorial?.basic ?? '',
      advanced: config.tutorial?.advanced ?? '',
    };
    download.value = {
      version: config.clientDownload?.version ?? '3.6.2',
      officialUrl: config.clientDownload?.officialUrl ?? '',
      mirrorUrl: config.clientDownload?.mirrorUrl ?? '',
      translationUrl: config.clientDownload?.translationUrl ?? '',
    };
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function save(): Promise<void> {
  try {
    await api.saveTutorialConfig({ tutorial: tutorial.value, clientDownload: download.value });
    showNotice('教程配置已保存');
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
    <div class="modal-actions"><button class="btn primary" @click="save">保存</button></div>
  </div>
</template>
