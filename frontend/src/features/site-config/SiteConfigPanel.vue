<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from '../../api';
import { toast } from '../../composables/useToast';

const site = ref({
  title: '',
  footerDescription: '',
  serverName: '',
  serverAddress: '',
  adminName: '',
  adminQq: '',
  excludedBotUids: '',
  tsManagerUrl: '',
  musicBotUrl: '',
  webClientUrl: '',
  steamBoxUrl: '',
});
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
    const config = await api.getSiteConfig();
    site.value = {
      title: config.title ?? '',
      footerDescription: config.footerDescription ?? '',
      serverName: config.serverName ?? '',
      serverAddress: config.serverAddress ?? '',
      adminName: config.adminName ?? '',
      adminQq: config.adminQq ?? config.adminSteam ?? '',
      excludedBotUids: config.excludedBotUids ?? '',
      tsManagerUrl: config.tsManagerUrl ?? '',
      musicBotUrl: config.musicBotUrl ?? '',
      webClientUrl: config.webClientUrl ?? '',
      steamBoxUrl: config.steamBoxUrl ?? '',
    };
  } catch (error) {
    showNotice(`加载站点配置失败：${(error as Error).message}`, 'error');
  }
}

async function save(): Promise<void> {
  // 后端每次保存都会执行 cleanupBotData()（全量机器人数据清理），
  // 连点「保存」会并发触发多次重复清理，这里加 in-flight 守卫。
  if (saving.value) return;
  saving.value = true;
  try {
    await api.saveSiteConfig({
      ...site.value,
      adminSteam: site.value.adminQq, // 兼容性同步
    });
    showNotice('站点配置保存成功', 'success');
  } catch (error) {
    showNotice(`站点配置保存失败：${(error as Error).message}`, 'error');
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
      <label>TS Manager Web 管理地址（配置后将在后台顶部展示快捷跳转入口）</label>
      <input v-model="site.tsManagerUrl" class="input" placeholder="例如：http://127.0.0.1:1234 或留空" />
    </div>
    <div class="field">
      <label>TSMusicBot Web 链接（WebUI 地址，配置后在后台顶部提供快捷跳转）</label>
      <input v-model="site.musicBotUrl" class="input" placeholder="例如：http://127.0.0.1:3000 或留空" />
    </div>
    <div class="field">
      <label>WebSpeak 网页端链接（网页语音地址，配置后在首页欢迎卡片与后台顶部展示快捷跳转）</label>
      <input v-model="site.webClientUrl" class="input" placeholder="例如：http://127.0.0.1:3040 或留空" />
    </div>
    <div class="field">
      <label>Steam 盒子链接（Web 链接，配置后在首页快捷按钮与后台顶部提供跳转）</label>
      <input v-model="site.steamBoxUrl" class="input" placeholder="例如：https://steam.myil.top 或留空" />
    </div>
    <div class="field">
      <label>管理员名称</label>
      <input v-model="site.adminName" class="input" placeholder="可留空" />
    </div>
    <div class="field">
      <label>管理员联系方式（支持 QQ号、17 位 SteamID64 或加好友链接）</label>
      <input v-model="site.adminQq" class="input" placeholder="例如：12345678、76561198000000000 或加好友链接" />
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
    <div class="modal-actions"><button class="btn primary" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button></div>
  </div>
</template>
