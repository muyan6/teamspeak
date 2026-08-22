<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';

const site = ref({
  title: '',
  footerDescription: '',
  serverName: '',
  serverAddress: '',
  adminName: '',
  adminQq: '',
  excludedBotUids: '',
});
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function showNotice(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3000);
}

async function load(): Promise<void> {
  try {
    const config = await api.getSiteConfig();
    site.value = {
      title: config.title ?? '',
      footerDescription: config.footerDescription ?? '',
      serverName: config.serverName ?? '',
      serverAddress: config.serverAddress ?? '',
      adminName: config.adminName ?? '',
      adminQq: config.adminQq ?? config.adminSteam ?? '',
      excludedBotUids: config.excludedBotUids ?? '',
    };
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function save(): Promise<void> {
  try {
    await api.saveSiteConfig({
      ...site.value,
      adminSteam: site.value.adminQq, // 兼容性同步
    });
    showNotice('站点配置已保存');
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
      <label>站点名称</label>
      <input v-model="site.title" class="input" placeholder="例如：Voice" />
    </div>
    <div class="field">
      <label>页脚描述</label>
      <input v-model="site.footerDescription" class="input" placeholder="例如：TeamSpeak3 语音服务器" />
    </div>
    <div class="field">
      <label>欢迎语服务器名称</label>
      <input v-model="site.serverName" class="input" placeholder="例如：偏居一隅" />
    </div>
    <div class="field">
      <label>对外服务器地址</label>
      <input v-model="site.serverAddress" class="input" placeholder="例如：996" />
    </div>
    <div class="field">
      <label>管理员名称</label>
      <input v-model="site.adminName" class="input" placeholder="可留空" />
    </div>
    <div class="field">
      <label>管理员 QQ (QQ号或加好友链接)</label>
      <input v-model="site.adminQq" class="input" placeholder="例如：12345678 或 QQ加好友链接" />
    </div>
    <div class="field">
      <label>排除机器人 UID (多个 UID 可用逗号、分号或换行分隔)</label>
      <textarea
        v-model="site.excludedBotUids"
        class="input"
        rows="3"
        placeholder="例如：LAGEsRxRDiUge8unI5aK/S77C28=, JcFykcZk6oyuE0AbyNsy5+/JPho="
      ></textarea>
      <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; line-height: 1.4;">
        配置后将自动在在线时长统计、排行榜、荣誉殿堂及活跃分析中排除这些机器人。
      </div>
    </div>
    <div class="modal-actions"><button class="btn primary" @click="save">保存</button></div>
  </div>
</template>
