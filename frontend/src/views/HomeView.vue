<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { useDashboard } from '../composables/dashboard';
import type { RankEntry, TrendData } from '../types';
import { renderMarkdown } from '../utils';
import { useHomeModules } from '../features/home-modules/home-modules';

const { data, error } = useDashboard();
const { modules: visibleModules, load: loadHomeModules } = useHomeModules();
const OnlineStatsChart = defineAsyncComponent(() => import('../components/OnlineStatsChart.vue'));

const copied = ref(false);
const trendRange = ref<'week' | 'month'>('week');
const rankRange = ref<'week' | 'month'>('week');
const channelRange = ref<'week' | 'month'>('week');
const showTutorial = ref(false);
const tutorialTab = ref('download');
const showAllAchievementLevels = ref(false);

const trend = computed<TrendData>(() => {
  if (!data.value) return { labels: [], data: [] };
  return data.value.trends[trendRange.value];
});

const ranks = computed<RankEntry[]>(() => data.value?.ranks[rankRange.value] ?? []);
const channels = computed<RankEntry[]>(() => data.value?.channels[channelRange.value] ?? []);
const achievements = computed(() => data.value?.achievements ?? { featured: null, rankings: [], levels: [], unlockedCount: 0 });
const visibleAchievementLevels = computed(() =>
  showAllAchievementLevels.value ? achievements.value.levels : achievements.value.levels.slice(0, 3),
);

const tutorialSection = computed(() => {
  if (!data.value) return null;
  const sections = data.value.tutorial.sections;
  return sections.find((s) => s.key === tutorialTab.value) ?? sections[0] ?? null;
});
const tutorialHtml = computed(() => (tutorialSection.value ? renderMarkdown(tutorialSection.value.content) : ''));

function safeHttpUrl(value: string | undefined): string {
  const urlText = value?.trim() ?? '';
  if (!urlText) return '';
  try {
    const url = new URL(urlText);
    return url.protocol === 'http:' || url.protocol === 'https:' ? urlText : '';
  } catch {
    return '';
  }
}

const adminQqContact = computed(() => (data.value?.site.adminQq || data.value?.site.adminSteam || '').trim());
const adminQqLink = computed(() => {
  const c = adminQqContact.value;
  if (!c) return '';
  if (/^https?:\/\//i.test(c) || /^tencent:\/\//i.test(c) || /^mqqwpa:\/\//i.test(c)) return c;
  if (/^[1-9]\d{4,11}$/.test(c)) {
    return `tencent://message/?uin=${c}&Site=TeamSpeak&Menu=yes`;
  }
  return '';
});
const hasAdminQqContact = computed(() => Boolean(adminQqLink.value));
const clientDownloadUrl = computed(() => safeHttpUrl(data.value?.site.clientDownload));
const mirrorDownloadUrl = computed(() => safeHttpUrl(data.value?.site.mirrorDownload));
const translationDownloadUrl = computed(() => safeHttpUrl(data.value?.site.translationDownload));
const adminQqDisplay = computed(() => {
  const c = adminQqContact.value;
  if (!c) return 'QQ';
  if (/^https?:\/\//i.test(c)) return 'QQ 联系方式';
  return c.startsWith('QQ') ? c : `QQ: ${c}`;
});

async function copyText(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* clipboard fallback */
  }
}

function quickConnect() {
  if (data.value?.site.connectUrl) {
    window.open(data.value.site.connectUrl, '_blank');
  }
}

function formatRankTime(minutes: number): string {
  if (minutes >= 60) return (minutes / 60).toFixed(1) + 'h';
  return minutes + 'm';
}

function rankWidth(items: RankEntry[], item: RankEntry): string {
  const first = parseInt(items[0]?.value || '0', 10) || 0;
  const cur = parseInt(item.value, 10) || 0;
  if (first <= 0) return '2%';
  return `${Math.max(2, (cur / first) * 100)}%`;
}

function formatAchievementHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function elasticLoadPercent(totalChannels: number, maxChannels: number): number {
  if (maxChannels <= 0) return 0;
  return Math.min(100, Math.round((totalChannels / maxChannels) * 100));
}

function getElasticLoadClass(percent: number): string {
  if (percent >= 80) return 'fill-rose';
  if (percent >= 50) return 'fill-amber';
  return 'fill-emerald';
}

function getElasticLoadTextClass(percent: number): string {
  if (percent >= 80) return 'text-rose';
  if (percent >= 50) return 'text-amber';
  return 'text-emerald';
}

function hashCode(str: string): number {
  if (!str) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) || 1;
}

const USER_ICONS = [
  'ph-fill ph-headset',
  'ph-fill ph-game-controller',
  'ph-fill ph-alien',
  'ph-fill ph-robot',
  'ph-fill ph-crown',
  'ph-fill ph-cat',
  'ph-fill ph-dog',
  'ph-fill ph-flame',
  'ph-fill ph-lightning',
  'ph-fill ph-snowflake',
  'ph-fill ph-sun',
  'ph-fill ph-moon-stars',
  'ph-fill ph-star-four',
  'ph-fill ph-diamond',
  'ph-fill ph-rocket',
  'ph-fill ph-trophy',
  'ph-fill ph-heart',
];

function getUserIcon(name: string): string {
  return USER_ICONS[hashCode(name) % USER_ICONS.length];
}

const ACHIEVEMENT_ICONS = [
  'ph-fill ph-crown',
  'ph-fill ph-star-four',
  'ph-fill ph-medal',
  'ph-fill ph-diamond',
  'ph-fill ph-trophy',
  'ph-fill ph-shield-chevron',
  'ph-fill ph-sparkle',
];

function getAchievementIcon(idx: number): string {
  return ACHIEVEMENT_ICONS[idx % ACHIEVEMENT_ICONS.length];
}

onMounted(() => void loadHomeModules());
</script>

<template>
  <div v-if="error && !data" class="glass-card" style="text-align: center; padding: 40px">
    <div style="font-size: 16px; color: var(--text-dim)">无法连接服务器数据</div>
    <div style="margin-top: 8px; font-size: 13px; color: var(--red)">{{ error }}</div>
    <router-link class="btn primary" style="margin-top: 16px" to="/admin">前往后台配置</router-link>
  </div>

  <template v-else-if="data">
    <div v-if="!data.connected" class="glass-card" style="margin-bottom: 1.5rem; padding: 1.25rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem">
      <div>
        <div style="font-weight: 700; color: #ffffff">尚未连接 TS3 服务器</div>
        <div style="font-size: 13px; color: var(--text-dim); margin-top: 4px">请前往后台填写服务器连接参数，保存后将自动连接并开始采集数据。</div>
      </div>
      <router-link class="btn primary" to="/admin">前往后台配置</router-link>
    </div>

    <!-- Top Actions Grid (8 cols + 4 cols) -->
    <section class="top-actions-grid">
      <!-- Connect Card (8 cols) -->
      <div v-if="visibleModules.connection" class="connect-card-col glass-card connect-card-hero">
        <div class="connect-card-bg-gradient"></div>
        <svg class="connect-card-watermark" viewBox="0 0 640 512" fill="currentColor">
          <path d="M192 64h256c70.7 0 128 57.3 128 128v0c0 70.7-57.3 128-128 128c-40.3 0-76.9-18.7-100.7-48H292.7c-23.8 29.3-60.4 48-100.7 48c-70.7 0-128-57.3-128-128v0C64 121.3 121.3 64 192 64zM152 176c-13.3 0-24 10.7-24 24s10.7 24 24 24s24-10.7 24-24s-10.7-24-24-24zm48-24c0 8.8-7.2 16-16 16s-16-7.2-16-16s7.2-16 16-16s16 7.2 16 16zm248 24c-13.3 0-24 10.7-24 24s10.7 24 24 24s24-10.7 24-24s-10.7-24-24-24zm-16-40c-8.8 0-16 7.2-16 16s7.2 16 16 16s16-7.2 16-16s-7.2-16-16-16zm-160 32a16 16 0 1 0 0-32 16 16 0 1 0 0 32zm80-16a16 16 0 1 0 -32 0 16 16 0 1 0 32 0z"/>
        </svg>

        <div class="connect-card-content">
          <div>
            <div class="connect-badge-pill">
              <i class="ph-bold ph-broadcast"></i> Join Now
            </div>
            <h2 class="connect-heading">
              欢迎来到 <span class="gradient-title-text">{{ data.site.serverName || 'TeamSpeak 3' }}</span>
            </h2>
            <div class="connect-meta-row">
              <span>服务器地址</span>
              <button class="copy-ip-pill" @click="copyText(data.site.serverAddress)">
                <span>{{ data.site.serverAddress }}</span>
                <span class="copy-tooltip">{{ copied ? '已复制！' : '点击复制' }}</span>
              </button>
              <template v-if="data.site.globalServer">
                <span class="sublink-sep">|</span>
                <i class="ph-bold ph-globe text-xs"></i>
                <span>国际入口</span>
                <button class="copy-ip-pill" @click="copyText(data.site.globalServer)">
                  <span>{{ data.site.globalServer }}</span>
                  <span class="copy-tooltip">{{ copied ? '已复制！' : '点击复制' }}</span>
                </button>
              </template>
            </div>
            <div class="connect-admin-row" v-if="data.site.adminName || hasAdminQqContact">
              <template v-if="data.site.adminName">
                <i class="ph-bold ph-user-gear"></i>
                <span>需私人频道联系 <span class="connect-admin-highlight">{{ data.site.adminName }}</span></span>
              </template>
              <template v-if="hasAdminQqContact">
                <span v-if="data.site.adminName" class="sublink-sep">|</span>
                <span class="sublink-item">
                  <i class="ph-bold ph-chat-circle-dots"></i> 若不在请联系
                  <a :href="adminQqLink" target="_blank" rel="noopener" class="connect-admin-highlight">{{ adminQqDisplay }}</a>
                </span>
              </template>
            </div>
          </div>

          <button class="quick-connect-btn" @click="quickConnect">
            <i class="ph-bold ph-plug quick-connect-icon"></i>
            <div>
              <div class="quick-connect-kicker">Quick Connect</div>
              <div class="quick-connect-title">Connect</div>
            </div>
          </button>
        </div>
      </div>

      <!-- Download Card (4 cols) -->
      <div v-if="visibleModules.downloads" class="download-card-col glass-card download-card-hero">
        <i class="ph-duotone ph-download-simple download-card-watermark"></i>
        <div>
          <h3 class="download-card-title">
            <i class="ph-duotone ph-windows-logo" style="color: #38bdf8; font-size: 1.25rem"></i> 需要客户端？
          </h3>
          <p class="download-card-subtitle">推荐使用 v3.6.2 稳定版</p>
        </div>

        <a v-if="clientDownloadUrl" class="download-main-btn" :href="clientDownloadUrl" target="_blank" rel="noopener">
          <div style="display: flex; align-items: center; gap: 0.625rem">
            <div class="download-icon-box">
              <i class="ph-bold ph-download-simple"></i>
            </div>
            <div>
              <div class="download-name">Windows 64-bit</div>
              <div class="download-tag">官方下载</div>
            </div>
          </div>
          <i class="ph-bold ph-arrow-right download-arrow"></i>
        </a>
        <div v-else class="download-main-btn" aria-disabled="true">
          <div style="display: flex; align-items: center; gap: 0.625rem">
            <div class="download-icon-box">
              <i class="ph-bold ph-download-simple"></i>
            </div>
            <div>
              <div class="download-name">暂未配置下载</div>
              <div class="download-tag">请联系管理员</div>
            </div>
          </div>
        </div>

        <div class="download-sublinks">
          <a v-if="mirrorDownloadUrl" class="sublink-item" :href="mirrorDownloadUrl" target="_blank" rel="noopener">
            <i class="ph-bold ph-cloud-arrow-down"></i> 备用下载
          </a>
          <span v-if="mirrorDownloadUrl && translationDownloadUrl" class="sublink-sep">|</span>
          <a v-if="translationDownloadUrl" class="sublink-item translation" :href="translationDownloadUrl" target="_blank" rel="noopener">
            <i class="ph-bold ph-translate"></i> 汉化包
          </a>
          <template v-if="data.tutorial.enabled">
            <span v-if="mirrorDownloadUrl || translationDownloadUrl" class="sublink-sep">|</span>
            <button class="sublink-item guide" style="background: none; border: none; font-size: inherit; font-family: inherit" @click="showTutorial = true">
              <i class="ph-bold ph-book-open"></i> 使用教程
            </button>
          </template>
        </div>
      </div>
    </section>

    <!-- Main Dashboard 12-Column Grid (8 cols + 4 cols) -->
    <main class="main-dashboard-grid">
      <!-- Left Column (8 cols) -->
      <div class="main-left-col">
        <!-- 流量趋势 -->
        <section v-if="visibleModules.trend" class="glass-card chart-card-box">
          <div class="section-header-row">
            <div class="section-title-group">
              <div class="section-icon-box section-icon-gold">
                <i class="ph-fill ph-chart-line-up"></i>
              </div>
              <div>
                <h3 class="section-title-text">流量趋势</h3>
                <p class="section-subtitle-text">Online Statistics</p>
              </div>
            </div>
            <div class="seg-pill-switcher">
              <button
                class="seg-btn"
                :class="{ active: trendRange === 'week', gold: trendRange === 'week' }"
                @click="trendRange = 'week'"
              >
                本周
              </button>
              <button
                class="seg-btn"
                :class="{ active: trendRange === 'month', gold: trendRange === 'month' }"
                @click="trendRange = 'month'"
              >
                本月
              </button>
            </div>
          </div>
          <OnlineStatsChart :trend="trend" />
        </section>

        <!-- 活跃榜 + 热门频道 (2 Cols) -->
        <div v-if="visibleModules.userRanks || visibleModules.channelRanks" class="ranks-grid-row">
          <!-- 活跃榜 (Top Users) -->
          <section v-if="visibleModules.userRanks" class="glass-card rank-card-box">
            <div class="rank-card-header">
              <div class="section-title-group">
                <div class="section-icon-box" style="background: rgba(251, 191, 36, 0.15); color: #fbbf24">
                  <i class="ph-fill ph-crown"></i>
                </div>
                <div>
                  <h3 class="section-title-text">活跃榜</h3>
                  <p class="section-subtitle-text">Top Users</p>
                </div>
              </div>
              <div class="seg-pill-switcher">
                <button
                  class="seg-btn"
                  :class="{ active: rankRange === 'week', amber: rankRange === 'week' }"
                  @click="rankRange = 'week'"
                >
                  本周
                </button>
                <button
                  class="seg-btn"
                  :class="{ active: rankRange === 'month', amber: rankRange === 'month' }"
                  @click="rankRange = 'month'"
                >
                  本月
                </button>
              </div>
            </div>

            <div v-if="ranks.length === 0" class="empty-box">
              <i class="ph-duotone ph-tray empty-icon"></i>
              <span>暂无数据</span>
            </div>
            <ul v-else class="rank-list-scroll">
              <li v-for="(u, i) in ranks.slice(0, 7)" :key="u.name + i" class="rank-item-row">
                <div class="rank-progress-bg rank-progress-amber" :style="{ width: rankWidth(ranks, u) }"></div>
                <div class="rank-item-content">
                  <div class="rank-user-info">
                    <div class="rank-badge-icon">
                      <i v-if="i === 0" class="ph-fill ph-crown" style="color: #fbbf24; font-size: 1.125rem; filter: drop-shadow(0 0 6px rgba(251, 191, 36, 0.6))"></i>
                      <i v-else-if="i === 1" class="ph-fill ph-medal" style="color: #94a3b8; font-size: 0.9375rem"></i>
                      <i v-else-if="i === 2" class="ph-fill ph-medal" style="color: #d97706; font-size: 0.9375rem"></i>
                      <span v-else class="rank-index-num">{{ i + 1 }}</span>
                    </div>
                    <span class="rank-name-text">{{ u.name }}</span>
                    <div v-if="u.badges && u.badges.length" class="rank-user-badges">
                      <span
                        v-for="b in u.badges.slice(0, 3)"
                        :key="b.id"
                        class="rank-badge-pill"
                        :style="{ color: b.color, borderColor: b.color + '40', background: b.color + '15' }"
                        :title="`${b.name} · ${b.description}`"
                      >
                        <i :class="['ph-fill', b.icon]"></i>
                        <span class="badge-pill-name">{{ b.name }}</span>
                      </span>
                    </div>
                  </div>
                  <span
                    class="rank-duration-text"
                    :class="i === 0 ? 'top-amber' : (i === 1 ? 'top-silver' : (i === 2 ? 'top-bronze' : ''))"
                  >
                    {{ formatRankTime(parseInt(u.value, 10) || 0) }}
                  </span>
                </div>
              </li>
            </ul>
          </section>

          <!-- 热门频道 (Top Channels) -->
          <section v-if="visibleModules.channelRanks" class="glass-card rank-card-box">
            <div class="rank-card-header">
              <div class="section-title-group">
                <div class="section-icon-box" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8">
                  <i class="ph-fill ph-fire"></i>
                </div>
                <div>
                  <h3 class="section-title-text">热门频道</h3>
                  <p class="section-subtitle-text">Top Channels</p>
                </div>
              </div>
              <div class="seg-pill-switcher">
                <button
                  class="seg-btn"
                  :class="{ active: channelRange === 'week', sky: channelRange === 'week' }"
                  @click="channelRange = 'week'"
                >
                  本周
                </button>
                <button
                  class="seg-btn"
                  :class="{ active: channelRange === 'month', sky: channelRange === 'month' }"
                  @click="channelRange = 'month'"
                >
                  本月
                </button>
              </div>
            </div>

            <div v-if="channels.length === 0" class="empty-box">
              <i class="ph-duotone ph-tray empty-icon"></i>
              <span>暂无数据</span>
            </div>
            <ul v-else class="rank-list-scroll">
              <li v-for="(c, i) in channels.slice(0, 7)" :key="c.name + i" class="rank-item-row">
                <div class="rank-progress-bg rank-progress-sky" :style="{ width: rankWidth(channels, c) }"></div>
                <div class="rank-item-content">
                  <div class="rank-user-info">
                    <div class="rank-badge-icon">
                      <i v-if="i === 0" class="ph-fill ph-fire" style="color: #38bdf8; font-size: 1.125rem; filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.6))"></i>
                      <i v-else-if="i === 1" class="ph-fill ph-fire" style="color: #7dd3fc; font-size: 0.9375rem"></i>
                      <i v-else-if="i === 2" class="ph-fill ph-fire" style="color: #bae6fd; font-size: 0.9375rem"></i>
                      <span v-else class="rank-index-num">{{ i + 1 }}</span>
                    </div>
                    <span class="rank-name-text">{{ c.name }}</span>
                    <span v-if="i === 0" class="rank-hot-tag">Hot</span>
                  </div>
                  <span class="rank-duration-text" :class="i === 0 ? 'top-sky' : ''">
                    {{ formatRankTime(parseInt(c.value, 10) || 0) }}
                  </span>
                </div>
              </li>
            </ul>
          </section>
        </div>

        <!-- 荣誉殿堂 (Hall of Fame) -->
        <section v-if="visibleModules.achievements" class="glass-card hall-of-fame-card">
          <div class="section-header-row" style="margin-bottom: 1.25rem">
            <div class="section-title-group">
              <i class="ph-fill ph-trophy" style="font-size: 1.75rem; color: #fbbf24; filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.4))"></i>
              <div>
                <h3 class="section-title-text">荣誉殿堂</h3>
                <p class="section-subtitle-text">Hall of Fame</p>
              </div>
            </div>
          </div>

          <div v-if="achievements.featured || achievements.rankings.length || achievements.levels.length" class="hall-grid-inner">
            <!-- Left Sub-col (7 cols) -->
            <div class="hall-left-col">
              <!-- 1. 周冠军 / 最高荣誉 卡片 -->
              <div class="champion-hero-card">
                <i class="ph-fill ph-crown champion-crown-watermark"></i>
                <div class="champion-trophy-box">
                  <i class="ph-fill ph-trophy"></i>
                </div>
                <div class="champion-info-box">
                  <div class="champion-kicker-row">
                    <span class="champion-kicker-dot"></span>
                    <span class="champion-kicker-text">全服最高荣誉勋位</span>
                  </div>
                  <div class="champion-user-name">
                    {{ achievements.featured ? achievements.featured.nickname : '虚位以待' }}
                  </div>
                  <div class="champion-group-badge">
                    <i class="ph-bold ph-map-pin" style="font-size: 0.6875rem"></i>
                    <span>{{ achievements.featured ? achievements.featured.title : '全服统计' }}</span>
                  </div>
                </div>
              </div>

              <!-- 2. 连续在线 (Streak Challenge) -->
              <div>
                <div class="streak-section-header">
                  <div style="display: flex; align-items: center; gap: 0.5rem">
                    <i class="ph-fill ph-flame" style="color: #fb923c; font-size: 1.125rem"></i>
                    <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em">连续在线</span>
                  </div>
                  <span class="badge-count-pill" style="font-size: 0.625rem">{{ achievements.rankings.length }}人</span>
                </div>

                <div class="streak-cards-flex">
                  <template v-if="achievements.rankings.length">
                    <div
                      v-for="(member, index) in achievements.rankings.slice(0, 3)"
                      :key="member.nickname + index"
                      class="streak-card-item"
                      :class="{ 'is-top': index === 0 }"
                    >
                      <div class="streak-card-top-row">
                        <span class="streak-rank-num" :class="{ 'is-top': index === 0 }">#{{ index + 1 }}</span>
                        <i v-if="index === 0" class="ph-fill ph-flame" style="color: #fb923c; font-size: 1.125rem"></i>
                        <i v-else class="ph-fill ph-user" style="color: #737373; font-size: 0.875rem"></i>
                      </div>
                      <div>
                        <div class="streak-user-nickname">{{ member.nickname }}</div>
                        <div class="streak-val-row">
                          <span class="streak-val-num" :class="{ 'is-top': index === 0 }">{{ member.days }}</span>
                          <span class="streak-val-unit">天</span>
                        </div>
                      </div>
                    </div>
                  </template>
                  <div v-else class="empty-box" style="width: 100%; padding: 1.5rem">
                    <span style="font-size: 0.75rem">暂无连续在线数据</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Right Sub-col: 时长成就等级列表 (5 cols) -->
            <div class="hall-right-col achievements-list-col">
              <div class="streak-section-header">
                <div style="display: flex; align-items: center; gap: 0.5rem">
                  <i class="ph-fill ph-medal" style="color: #fbbf24; font-size: 1.125rem"></i>
                  <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em">时长成就</span>
                </div>
                <span class="badge-count-pill" style="font-size: 0.625rem">{{ achievements.levels.length }}级</span>
              </div>

              <div class="achievements-items-wrap">
                <template v-if="achievements.levels.length">
                  <div
                    v-for="(level, index) in visibleAchievementLevels"
                    :key="level.id"
                    class="achievement-level-card"
                    :class="{ 'is-top': index === 0 }"
                  >
                    <div
                      class="achievement-badge-box"
                      :style="{
                        background: index === 0 ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                        color: index === 0 ? '#fbbf24' : '#d4d4d4'
                      }"
                    >
                      <i :class="getAchievementIcon(index)"></i>
                    </div>
                    <div style="flex: 1; min-width: 0">
                      <div class="achievement-title-text">{{ level.title }}</div>
                      <div style="font-size: 0.6875rem; color: var(--text-faint)">累计 {{ formatAchievementHours(level.hours) }} 小时</div>
                    </div>
                    <span class="achievement-count-text">{{ level.unlockedCount }}人</span>
                  </div>
                </template>
                <div v-else class="empty-box" style="padding: 1.5rem">
                  <span style="font-size: 0.75rem">暂无成就配置</span>
                </div>
              </div>

              <button
                v-if="achievements.levels.length > 3"
                type="button"
                class="expand-levels-btn"
                @click="showAllAchievementLevels = !showAllAchievementLevels"
              >
                <span>{{ showAllAchievementLevels ? '收起等级' : `还有 ${achievements.levels.length - 3} 个等级` }}</span>
                <i :class="showAllAchievementLevels ? 'ph-bold ph-caret-up' : 'ph-bold ph-caret-down'"></i>
              </button>
            </div>
          </div>
          <div v-else class="empty-box">
            <i class="ph-duotone ph-trophy empty-icon"></i>
            <span>暂无荣誉数据</span>
          </div>
        </section>

        <!-- 弹性频道 (Elastic Channels) -->
        <section v-if="visibleModules.elasticChannels && data.elastic_channels.groups.length > 0" class="glass-card elastic-channels-card">
          <div class="section-header-row">
            <div class="section-title-group">
              <i class="ph-fill ph-pulse" style="font-size: 1.75rem; color: #22d3ee; filter: drop-shadow(0 0 8px rgba(34, 211, 238, 0.4))"></i>
              <div>
                <div style="display: flex; align-items: center; gap: 0.5rem">
                  <h3 class="section-title-text">弹性频道</h3>
                  <span class="realtime-group-chip">动态扩容</span>
                </div>
                <p class="section-subtitle-text">Elastic Channels</p>
              </div>
            </div>
          </div>

          <div class="elastic-groups-list">
            <div v-for="g in data.elastic_channels.groups" :key="g.group.id" class="elastic-group-box">
              <div class="elastic-group-head">
                <div class="elastic-group-title-row">
                  <div class="elastic-folder-box">
                    <i class="ph-fill ph-folder-open"></i>
                  </div>
                  <div>
                    <h4 class="elastic-parent-name">{{ g.group.name }}</h4>
                    <p class="elastic-prefix-text">
                      前缀: <span style="font-family: ui-monospace, monospace; color: #22d3ee; font-weight: 700">{{ g.group.namePrefix }}</span>
                    </p>
                  </div>
                </div>

                <div class="elastic-load-bar-wrap">
                  <div class="elastic-track">
                    <div
                      class="elastic-fill"
                      :class="getElasticLoadClass(elasticLoadPercent(g.totalChannels, g.group.maxChannels))"
                      :style="{ width: `${elasticLoadPercent(g.totalChannels, g.group.maxChannels)}%` }"
                    ></div>
                  </div>
                  <span
                    class="elastic-percent-text"
                    :class="getElasticLoadTextClass(elasticLoadPercent(g.totalChannels, g.group.maxChannels))"
                  >
                    {{ elasticLoadPercent(g.totalChannels, g.group.maxChannels) }}%
                  </span>
                </div>
              </div>

              <!-- 4-metric statistics grid -->
              <div class="elastic-metrics-grid">
                <div class="elastic-metric-cell">
                  <div class="elastic-metric-val">{{ g.totalChannels }}</div>
                  <div class="elastic-metric-lbl">频道数</div>
                </div>
                <div class="elastic-metric-cell">
                  <div class="elastic-metric-val is-cyan">{{ g.totalOnline }}</div>
                  <div class="elastic-metric-lbl">在线用户</div>
                </div>
                <div class="elastic-metric-cell">
                  <div class="elastic-metric-val">{{ g.group.maxChannels }}</div>
                  <div class="elastic-metric-lbl">频道上限</div>
                </div>
                <div class="elastic-metric-cell">
                  <div class="elastic-metric-val is-amber">{{ g.group.createThreshold }}</div>
                  <div class="elastic-metric-lbl">扩容阈值</div>
                </div>
              </div>

              <!-- Sub-channels tags -->
              <div class="elastic-subchannels-wrap">
                <span v-for="c in g.channels" :key="c.cid" class="subchannel-chip">
                  <i class="ph-fill ph-hash"></i>
                  <span>{{ c.name }}</span>
                  <span style="color: var(--text-faint)">({{ c.online }})</span>
                </span>
                <span v-if="g.channels.length === 0" class="subchannel-chip" style="color: var(--text-faint)">
                  暂无活跃子频道
                </span>
              </div>
            </div>

            <!-- Summary Bar -->
            <div class="elastic-summary-card">
              <div class="elastic-summary-left">
                <i class="ph-fill ph-chart-pie"></i>
                <span>总体负载</span>
              </div>
              <div class="elastic-summary-right">
                <span style="color: var(--text-dim)">频道组: <b style="color: #ffffff">{{ data.elastic_channels.groups.length }}</b></span>
                <span style="color: var(--text-dim)">总频道: <b style="color: #ffffff">{{ data.elastic_channels.overallChannels }}</b></span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Right Column: Realtime Live Monitor (4 cols) -->
      <aside class="main-right-col">
        <div v-if="visibleModules.realtime" class="glass-card realtime-monitor-card">
          <!-- Header -->
          <div class="realtime-header">
            <div class="section-title-group">
              <div class="section-icon-box" style="background: rgba(16, 185, 129, 0.15); color: #10b981">
                <i class="ph-fill ph-users-three"></i>
              </div>
              <div>
                <div style="display: flex; align-items: center; gap: 0.5rem">
                  <h3 class="section-title-text">实时在线</h3>
                  <span class="realtime-pulse-box">
                    <span class="realtime-pulse-ping"></span>
                    <span class="realtime-pulse-dot"></span>
                  </span>
                </div>
                <p class="section-subtitle-text">Live Monitor</p>
              </div>
            </div>
            <div class="badge-online-pill">
              <i class="ph-fill ph-users"></i>
              <span style="font-family: ui-monospace, monospace">{{ data.realtime_list.length }}</span>
            </div>
          </div>

          <!-- User list -->
          <div v-if="data.realtime_list.length === 0" class="empty-box" style="padding: 4rem 1rem">
            <i class="ph-duotone ph-moon-stars empty-icon"></i>
            <p style="font-weight: 700; color: #d4d4d4; font-size: 0.875rem">静谧时刻</p>
            <p style="font-size: 0.75rem; color: var(--text-faint); margin-top: 0.25rem">等待第一位用户上线...</p>
          </div>
          <div v-else class="realtime-list-scroll">
            <div v-for="(c, i) in data.realtime_list" :key="c.nickname + i" class="realtime-user-card">
              <div class="realtime-avatar-box">
                <i :class="getUserIcon(c.nickname)"></i>
              </div>
              <div class="realtime-user-details">
                <div class="realtime-user-row">
                  <span class="realtime-nickname">{{ c.nickname }}</span>
                  <span v-for="g in c.groups.slice(0, 1)" :key="g" class="realtime-group-chip">#{{ g }}</span>
                </div>
                <div class="realtime-channel-name">{{ c.channel || '默认频道' }}</div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="realtime-footer">
            <div style="display: flex; align-items: center; gap: 0.375rem">
              <i class="ph-fill ph-clock"></i>
              <span>实时更新中</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.375rem; color: #10b981; font-weight: 700">
              <span class="realtime-pulse-box">
                <span class="realtime-pulse-ping"></span>
                <span class="realtime-pulse-dot"></span>
              </span>
              <span>Live</span>
            </div>
          </div>
        </div>
      </aside>
    </main>

    <!-- 使用教程弹窗 -->
    <Teleport to="body">
      <div v-if="showTutorial" class="modal-backdrop-wrap" @click.self="showTutorial = false">
        <div class="modal-dialog-box">
          <div class="modal-head-row">
            <div class="modal-title-left">
              <div class="section-icon-box" style="background: rgba(16, 185, 129, 0.15); color: #10b981">
                <i class="ph-fill ph-book-open"></i>
              </div>
              <div>
                <h3 style="font-size: 1.125rem; font-weight: 800; color: #ffffff">{{ data.tutorial.title || '使用教程' }}</h3>
                <p class="section-subtitle-text">TeamSpeak Guide</p>
              </div>
            </div>
            <button class="modal-close-x" @click="showTutorial = false" title="关闭">
              <i class="ph-bold ph-x"></i>
            </button>
          </div>
          <div class="modal-tabs-row">
            <button
              v-for="s in data.tutorial.sections"
              :key="s.key"
              class="modal-tab-btn"
              :class="{ active: tutorialTab === s.key }"
              @click="tutorialTab = s.key"
            >
              {{ s.title }}
            </button>
          </div>
          <div class="modal-body-scroll" v-html="tutorialHtml"></div>
          <div class="modal-foot-row">
            <span style="font-size: 0.75rem; color: var(--text-faint)" v-if="data.tutorial.updatedAt">
              更新时间：{{ data.tutorial.updatedAt }}
            </span>
            <button class="btn green" @click="showTutorial = false">我知道了</button>
          </div>
        </div>
      </div>
    </Teleport>
  </template>
</template>
