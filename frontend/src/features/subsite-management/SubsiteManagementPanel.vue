<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import type { SubsiteConfig } from '../../types';

const form = ref<SubsiteConfig>({ slug: '', domain: '' });
const saving = ref(false);
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function showNotice(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3500);
}

async function load(): Promise<void> {
  try {
    form.value = await api.getSubsiteConfig();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  try {
    form.value = await api.saveSubsiteConfig({ ...form.value });
    showNotice('分站配置已保存，域名绑定已即时生效');
  } catch (error) {
    showNotice(`保存失败：${(error as Error).message || '请求失败'}`);
  } finally {
    saving.value = false;
  }
}

onMounted(() => { void load(); });
</script>

<template>
  <div>
    <div v-if="notice" class="notice">{{ notice }}</div>
    <div class="subsite-note">
      <strong>当前实例分站</strong>
      <span>这里管理当前这套 TS3 监控实例的身份和域名。不同服务器请使用独立实例、数据库和管理员密码。</span>
    </div>
    <div class="field">
      <label>分站标识</label>
      <input v-model="form.slug" class="input" placeholder="例如 server-a" maxlength="64" />
      <p class="hint">只允许小写字母、数字和连字符，用于健康检查和统计隔离。</p>
    </div>
    <div class="field">
      <label>允许访问域名</label>
      <input v-model="form.domain" class="input" placeholder="例如 a.example.com, voice.example.com" />
      <p class="hint">多个域名用英文逗号分隔；留空表示不限制域名。开发环境仍允许 localhost 和 127.0.0.1。</p>
    </div>
    <div class="modal-actions">
      <button class="btn primary" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存分站配置' }}</button>
    </div>
  </div>
</template>

<style scoped>
.subsite-note { display: grid; gap: 5px; margin-bottom: 20px; padding: 12px 14px; border-left: 3px solid var(--primary); background: rgba(255, 255, 255, 0.04); color: var(--text-dim); font-size: 13px; line-height: 1.6; }
.subsite-note strong { color: var(--text); font-size: 14px; }
</style>
