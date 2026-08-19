<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useDashboard } from './composables/dashboard';

const { data, refresh } = useDashboard();
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const title = computed(() => data.value?.site.serverName || 'TS3 语音服务器');

onMounted(() => {
  void refresh();
  refreshTimer = setInterval(refresh, 15000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <div class="bg-blob blob-1"></div>
  <div class="bg-blob blob-2"></div>
  <div class="bg-blob blob-3"></div>

  <header class="site-header">
    <div class="header-left">
      <div class="header-logo"><img src="/logo.svg" alt="logo" /></div>
      <div class="header-titles">
        <h1 class="header-title">{{ title }}</h1>
        <div class="header-badges">
          <span class="badge badge-online">
            <span class="ping-dot"></span> {{ data ? 'Online' : '连接中' }}
          </span>
          <span class="badge badge-count">
            <span class="count-num">{{ data ? data.online_count : '—' }}</span> 在线
          </span>
        </div>
      </div>
    </div>
    <div class="header-right">
      <router-link class="header-action" to="/profile" title="查询在线数据">查我的数据</router-link>
      <a v-if="data?.site.adminName" class="header-link" :href="data?.site.adminSteam || '#'" target="_blank" rel="noopener">
        管理: {{ data.site.adminName }}
      </a>
      <router-link class="header-admin" to="/admin" title="后台管理">后台</router-link>
    </div>
  </header>

  <main>
    <router-view />
  </main>

  <footer>
    <span v-if="data">{{ data.site.title }} · {{ data.site.footerDescription }}</span>
    <span v-else>TS3 Monitor · TeamSpeak3 语音服务器</span>
  </footer>
</template>
