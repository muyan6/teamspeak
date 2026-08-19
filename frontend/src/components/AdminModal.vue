<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from 'vue';
import { api, authState } from '../api';

type AdminTab = 'elastic' | 'champion' | 'achievement' | 'server' | 'site' | 'tutorial' | 'ts3' | 'modules' | 'subsites';

const password = ref('');
const authed = authState;
const loginError = ref('');
const isPlatformAdmin = ref(false);
const activeTab = ref<AdminTab>('elastic');
const AchievementsPanel = defineAsyncComponent(() => import('../features/achievements/AchievementsPanel.vue'));
const ElasticChannelsPanel = defineAsyncComponent(() => import('../features/elastic-channels/ElasticChannelsPanel.vue'));
const HomeModulesPanel = defineAsyncComponent(() => import('../features/home-modules/HomeModulesPanel.vue'));
const ServerConnectionPanel = defineAsyncComponent(() => import('../features/server-connection/ServerConnectionPanel.vue'));
const SiteConfigPanel = defineAsyncComponent(() => import('../features/site-config/SiteConfigPanel.vue'));
const TutorialConfigPanel = defineAsyncComponent(() => import('../features/tutorial-config/TutorialConfigPanel.vue'));
const Ts3AdminPanel = defineAsyncComponent(() => import('../features/ts3-admin/Ts3AdminPanel.vue'));
const WeeklyChampionPanel = defineAsyncComponent(() => import('../features/weekly-champion/WeeklyChampionPanel.vue'));
const MultiSubsitesPanel = defineAsyncComponent(() => import('../features/multi-subsites/MultiSubsitesPanel.vue'));

async function login(): Promise<void> {
  loginError.value = '';
  try {
    await api.login(password.value);
  } catch (error) {
    loginError.value = (error as Error).message;
  }
}

function logout(): void {
  api.logout();
  password.value = '';
}

async function loadAdminScope(): Promise<void> {
  try {
    isPlatformAdmin.value = (await api.getHealth()).platform;
  } catch {
    isPlatformAdmin.value = false;
  }
}

onMounted(() => { void loadAdminScope(); });
</script>

<template>
  <section class="admin-page">
    <div class="admin-topbar">
      <router-link class="back-btn" to="/">← 返回首页</router-link>
      <span class="admin-brand">后台管理 · Admin</span>
    </div>

    <div class="card admin-surface">
      <div class="admin-page-heading">
        <div>
          <h2>后台管理</h2>
          <p>服务器与站点设置</p>
        </div>
        <button v-if="authed" class="btn sm" @click="logout">退出登录</button>
      </div>

      <div v-if="!authed" class="admin-login">
        <div class="field">
          <label>管理密码</label>
          <input v-model="password" type="password" class="input" placeholder="请输入管理密码" @keyup.enter="login" />
        </div>
        <div v-if="loginError" style="color: var(--red); font-size: 13px; margin-bottom: 12px">{{ loginError }}</div>
        <button class="btn primary" style="width: 100%" @click="login">登录</button>
      </div>

      <div v-else>
        <div class="tabs">
          <button class="btn sm" :class="{ primary: activeTab === 'elastic' }" @click="activeTab = 'elastic'">弹性频道</button>
          <button class="btn sm" :class="{ primary: activeTab === 'champion' }" @click="activeTab = 'champion'">周冠军</button>
          <button class="btn sm" :class="{ primary: activeTab === 'achievement' }" @click="activeTab = 'achievement'">成就管理</button>
          <button class="btn sm" :class="{ primary: activeTab === 'server' }" @click="activeTab = 'server'">服务器配置</button>
          <button class="btn sm" :class="{ primary: activeTab === 'ts3' }" @click="activeTab = 'ts3'">TS3 管理</button>
          <button class="btn sm" :class="{ primary: activeTab === 'site' }" @click="activeTab = 'site'">站点配置</button>
          <button class="btn sm" :class="{ primary: activeTab === 'tutorial' }" @click="activeTab = 'tutorial'">教程配置</button>
          <button class="btn sm" :class="{ primary: activeTab === 'modules' }" @click="activeTab = 'modules'">主页模块</button>
          <button v-if="isPlatformAdmin" class="btn sm" :class="{ primary: activeTab === 'subsites' }" @click="activeTab = 'subsites'">统一分站</button>
        </div>

        <div class="tab-panel">
          <ElasticChannelsPanel v-if="activeTab === 'elastic'" />
          <WeeklyChampionPanel v-else-if="activeTab === 'champion'" />
          <AchievementsPanel v-else-if="activeTab === 'achievement'" />
          <ServerConnectionPanel v-else-if="activeTab === 'server'" />
          <Ts3AdminPanel v-else-if="activeTab === 'ts3'" />
          <SiteConfigPanel v-else-if="activeTab === 'site'" />
          <TutorialConfigPanel v-else-if="activeTab === 'tutorial'" />
          <HomeModulesPanel v-else-if="activeTab === 'modules'" />
          <MultiSubsitesPanel v-else-if="activeTab === 'subsites' && isPlatformAdmin" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.admin-page { display: flex; flex-direction: column; gap: 20px; }
.admin-topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border: 1px solid var(--border); border-radius: 11px; background: var(--bg-hover); color: var(--text-dim); font-size: 13px; font-weight: 600; transition: all 0.15s; }
.back-btn:hover { color: var(--text); border-color: var(--primary); }
.admin-brand { color: var(--text-faint); font-size: 13px; font-weight: 600; }
.admin-surface { min-width: 0; padding: 24px; background: linear-gradient(145deg, rgba(30, 30, 34, 0.86), rgba(18, 18, 21, 0.7)); }
.admin-page-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.admin-page-heading h2 { margin: 0; color: var(--text); font-size: 20px; font-weight: 800; }
.admin-page-heading p { margin: 5px 0 0; color: var(--text-faint); font-size: 13px; }
.tab-panel { overflow-x: auto; }
.tabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(116px, 1fr)); gap: 8px; margin-bottom: 20px; padding: 6px; border: 1px solid var(--border); border-radius: 14px; background: rgba(9, 9, 11, 0.4); }
.tabs .btn { width: 100%; min-height: 38px; }

@media (max-width: 640px) {
  .admin-surface { padding: 16px; }
  .admin-page-heading { align-items: flex-start; }
  .tab-panel :deep(.tbl) { min-width: 640px; }
}
</style>
