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
  <div class="noise-bg"></div>
  <div class="bg-blob bg-blob-tl"></div>
  <div class="bg-blob bg-blob-br"></div>

  <div class="page-container">
    <header class="site-header">
      <div class="header-left">
        <div class="header-logo-wrap">
          <img src="/logo.svg" alt="Logo" class="header-logo" />
        </div>
        <div class="header-title-box">
          <h1 class="header-server-name">{{ title }}</h1>
          <div class="header-badges">
            <div class="badge-online-pill">
              <span class="realtime-pulse-box">
                <span class="realtime-pulse-ping"></span>
                <span class="realtime-pulse-dot"></span>
              </span>
              {{ data ? 'Online' : '连接中' }}
            </div>
            <div class="badge-count-pill" :title="'当前在线人数'">
              <i class="ph-fill ph-users"></i>
              <span style="font-family: ui-monospace, monospace">{{ data ? data.online_count : 0 }}</span>
              <span>在线</span>
            </div>
          </div>
        </div>
      </div>

      <div class="header-right">
        <router-link class="header-profile-btn" to="/profile" title="查询我的在线数据">
          <div class="header-profile-icon">
            <i class="ph-fill ph-magnifying-glass-plus"></i>
          </div>
          <span>查我的数据</span>
        </router-link>
        <router-link class="header-admin-btn" to="/admin" title="后台管理系统">
          <div class="header-admin-icon">
            <i class="ph-fill ph-gear-six"></i>
          </div>
          <span>后台</span>
        </router-link>
      </div>
    </header>

    <main>
      <router-view />
    </main>

    <footer class="site-footer">
      <div class="footer-pill">
        <span>© 2026</span>
        <i class="ph-fill ph-heart" style="color: #ec4899"></i>
        <span>{{ data?.site.title || 'Voice' }}</span>
        <span v-if="data?.site.footerDescription">· {{ data.site.footerDescription }}</span>
      </div>
    </footer>
  </div>
</template>
