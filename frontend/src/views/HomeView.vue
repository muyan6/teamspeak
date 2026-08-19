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

async function copyAddress() {
  if (!data.value) return;
  try {
    await navigator.clipboard.writeText(data.value.site.serverAddress);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* clipboard 不可用 */
  }
}

function quickConnect() {
  if (data.value) window.open(data.value.site.connectUrl, '_blank');
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

function rankNumClass(i: number): string {
  return i === 0 ? 'n1' : i === 1 ? 'n2' : i === 2 ? 'n3' : '';
}

function formatAchievementHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

onMounted(() => void loadHomeModules());
</script>

<template>
  <div v-if="error && !data" class="card" style="text-align: center; padding: 40px">
    <div style="font-size: 16px; color: var(--text-dim)">无法连接服务器数据</div>
    <div style="margin-top: 8px; font-size: 13px; color: var(--red)">{{ error }}</div>
    <router-link class="btn primary" style="margin-top: 16px" to="/admin">前往后台配置</router-link>
  </div>

  <template v-else-if="data">
    <div v-if="!data.connected" class="card" style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 16px">
      <div>
        <div style="font-weight: 600">尚未连接 TS3 服务器</div>
        <div style="font-size: 13px; color: var(--text-dim); margin-top: 4px">请前往后台填写服务器连接参数，保存后将自动连接并开始采集数据。</div>
      </div>
      <router-link class="btn primary" to="/admin">前往后台配置</router-link>
    </div>

    <div class="dashboard-grid">
    <!-- 左列 -->
    <div class="col-left">
      <!-- Connect Card -->
      <section v-if="visibleModules.connection" class="connect-card">
        <div class="connect-badge">Join Now</div>
        <h1 class="connect-title">
          欢迎来到 <span class="gradient-text">{{ data.site.serverName }}</span>
        </h1>
        <div class="connect-row">
          <span>服务器地址</span>
          <button class="connect-ip" @click="copyAddress" :title="'点击复制'">
            {{ data.site.serverAddress }} <span class="copy-hint">{{ copied ? '已复制' : '点击复制' }}</span>
          </button>
        </div>
        <div class="connect-admin" v-if="data.site.adminName">
          <span>需私人频道联系</span>
          <span style="color: var(--text); font-weight: 600">{{ data.site.adminName }}</span>
          <template v-if="data.site.adminSteam">
            <span>若不在请联系</span>
            <a :href="data.site.adminSteam" target="_blank" rel="noopener">QQ</a>
          </template>
        </div>
        <div class="connect-actions">
          <button class="connect-btn" @click="quickConnect">Quick Connect →</button>
        </div>
      </section>

      <!-- 流量趋势 -->
      <section v-if="visibleModules.trend" class="card chart-card">
        <div class="section-head">
          <div class="chart-title-group">
            <div class="section-icon" style="background: linear-gradient(135deg, rgba(244,63,94,.25), rgba(236,72,153,.18)); color: var(--primary)">◔</div>
            <div>
              <div class="section-title" style="margin-bottom: 2px">流量趋势</div>
              <div class="sub" style="font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .6px">Online Statistics</div>
            </div>
          </div>
          <div class="seg">
            <button :class="{ active: trendRange === 'week', rose: trendRange === 'week' }" @click="trendRange = 'week'">本周</button>
            <button :class="{ active: trendRange === 'month', rose: trendRange === 'month' }" @click="trendRange = 'month'">本月</button>
          </div>
        </div>
        <OnlineStatsChart :trend="trend" />
      </section>

      <!-- 活跃榜 + 热门频道 -->
      <div v-if="visibleModules.userRanks || visibleModules.channelRanks" class="grid grid-2">
        <section v-if="visibleModules.userRanks" class="card">
          <div class="section-title" style="justify-content: space-between">
            <span style="display: flex; align-items: center; gap: 10px">
              <span class="section-icon" style="background: rgba(251,191,36,.15); color: var(--amber)">★</span>
              <span>活跃榜 <span class="sub">Top Users</span></span>
            </span>
            <div class="seg">
              <button :class="{ active: rankRange === 'week', amber: rankRange === 'week' }" @click="rankRange = 'week'">本周</button>
              <button :class="{ active: rankRange === 'month', amber: rankRange === 'month' }" @click="rankRange = 'month'">本月</button>
            </div>
          </div>
          <div v-if="ranks.length === 0" class="empty">No Data Available</div>
          <ul v-else class="rank-list">
            <li v-for="(u, i) in ranks" :key="u.name + i" class="rank-item amber">
              <div class="rank-bar" :style="{ width: rankWidth(ranks, u) }"></div>
              <div class="rank-inner">
                <div class="rank-left">
                  <span class="rank-num" :class="rankNumClass(i)">{{ i + 1 }}</span>
                  <span class="rank-name">{{ u.name }}</span>
                </div>
                <span class="rank-value" :class="{ dim: i > 2 }">{{ formatRankTime(parseInt(u.value, 10) || 0) }}</span>
              </div>
            </li>
          </ul>
        </section>

        <section v-if="visibleModules.channelRanks" class="card">
          <div class="section-title" style="justify-content: space-between">
            <span style="display: flex; align-items: center; gap: 10px">
              <span class="section-icon" style="background: rgba(56,189,248,.15); color: var(--sky)">#</span>
              <span>热门频道 <span class="sub">Top Channels</span></span>
            </span>
            <div class="seg">
              <button :class="{ active: channelRange === 'week', sky: channelRange === 'week' }" @click="channelRange = 'week'">本周</button>
              <button :class="{ active: channelRange === 'month', sky: channelRange === 'month' }" @click="channelRange = 'month'">本月</button>
            </div>
          </div>
          <div v-if="channels.length === 0" class="empty">No Data Available</div>
          <ul v-else class="rank-list">
            <li v-for="(c, i) in channels" :key="c.name + i" class="rank-item sky">
              <div class="rank-bar" :style="{ width: rankWidth(channels, c) }"></div>
              <div class="rank-inner">
                <div class="rank-left">
                  <span class="rank-num" :class="rankNumClass(i)">{{ i + 1 }}</span>
                  <span class="rank-name">{{ c.name }}</span>
                </div>
                <span class="rank-value" :class="{ dim: i > 2 }">{{ formatRankTime(parseInt(c.value, 10) || 0) }}</span>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <!-- 荣誉殿堂 -->
      <section v-if="visibleModules.achievements" class="card honor-card">
        <div class="section-title honor-title-row">
          <span style="display: flex; align-items: center; gap: 10px">
            <span class="section-icon" style="background: rgba(251,191,36,.15); color: var(--amber)">♛</span>
            <span>荣誉殿堂 <span class="sub">Hall of Fame</span></span>
          </span>
        </div>
        <div v-if="achievements.featured || achievements.rankings.length || achievements.levels.length" class="honor-layout">
          <div class="honor-main-column">
            <div class="honor-champion">
              <span class="honor-crown" aria-hidden="true">♛</span>
              <span class="honor-champion-icon" aria-hidden="true">♛</span>
              <div class="honor-champion-content">
                <span class="honor-kicker"><i></i>最高荣誉</span>
                <template v-if="achievements.featured">
                  <strong>{{ achievements.featured.nickname }}</strong>
                  <span class="honor-featured-title">{{ achievements.featured.title }}</span>
                  <span class="honor-featured-hours">累计 {{ formatAchievementHours(achievements.featured.hours) }} 小时达成</span>
                </template>
                <span v-else class="honor-placeholder">等待第一位成员点亮最高荣誉</span>
              </div>
            </div>

            <div class="honor-rankings">
              <div class="honor-subhead honor-rankings-head">
                <span><b aria-hidden="true">♨</b>连续在线排行榜</span>
                <small>{{ achievements.rankings.length }} 人</small>
              </div>
              <div v-if="achievements.rankings.length" class="honor-ranking-list">
                <div
                  v-for="(member, index) in achievements.rankings.slice(0, 3)"
                  :key="member.nickname + index"
                  class="honor-ranking"
                  :class="{ 'is-first': index === 0 }"
                >
                  <div class="honor-ranking-meta">
                    <span class="honor-rank">#{{ index + 1 }}</span>
                    <span class="honor-rank-icon" aria-hidden="true">{{ index === 0 ? '♨' : '●' }}</span>
                  </div>
                  <strong>{{ member.nickname }}</strong>
                  <span class="honor-ranking-hours"><b>{{ member.days }}</b><small>天</small></span>
                </div>
              </div>
              <span v-else class="honor-placeholder">暂无累计时长记录</span>
            </div>
          </div>

          <div class="honor-levels">
            <div class="honor-subhead honor-levels-head"><span>时长成就</span><small>{{ achievements.levels.length }}级</small></div>
            <div v-if="achievements.levels.length" class="honor-level-list">
              <div
                v-for="(level, index) in visibleAchievementLevels"
                :key="level.id"
                class="honor-level"
                :class="{ 'is-top-level': index === 0 }"
              >
                <span class="honor-level-index">{{ index < 3 ? '' : index + 1 }}</span>
                <div>
                  <strong>{{ level.title }}</strong>
                  <small>累计 {{ formatAchievementHours(level.hours) }} 小时</small>
                </div>
                <span>{{ level.unlockedCount }} 人</span>
              </div>
            </div>
            <span v-else class="honor-placeholder">后台添加成就后将在此展示</span>
            <button
              v-if="achievements.levels.length > 3"
              type="button"
              class="honor-level-toggle"
              :aria-expanded="showAllAchievementLevels"
              @click="showAllAchievementLevels = !showAllAchievementLevels"
            >
              {{ showAllAchievementLevels ? '收起等级' : `还有 ${achievements.levels.length - 3} 个等级` }}
              <span aria-hidden="true">{{ showAllAchievementLevels ? '⌃' : '⌄' }}</span>
            </button>
          </div>
        </div>
        <div v-else class="empty">暂无荣誉数据</div>
      </section>

      <!-- 弹性频道 -->
      <section v-if="visibleModules.elasticChannels && data.elastic_channels.groups.length > 0" class="card">
        <div class="section-title">
          <span class="section-icon" style="background: rgba(34,211,238,.15); color: var(--cyan)">◈</span>
          <span>弹性频道 <span class="sub">Elastic Channels</span></span>
        </div>
        <div class="elastic-grid">
          <div v-for="g in data.elastic_channels.groups" :key="g.group.id" class="elastic-group">
            <div class="elastic-head">
              <span class="elastic-name">{{ g.group.name }}</span>
              <span class="elastic-stat">{{ g.totalOnline }} 在线 · {{ g.totalChannels }} 频道</span>
            </div>
            <div class="elastic-channels">
              <span v-for="c in g.channels" :key="c.cid" class="elastic-channel">
                {{ c.name }} <em>{{ c.online }}人</em>
              </span>
              <span v-if="g.channels.length === 0" class="elastic-empty">暂无频道</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 右列 -->
    <div class="col-right">
      <!-- 客户端下载 -->
      <section v-if="visibleModules.downloads" class="download-card-hero">
        <h3>需要客户端？</h3>
        <p class="dl-sub">推荐使用 v3.6.2 稳定版</p>
        <a class="download-main" :href="data.site.clientDownload" target="_blank" rel="noopener">
          <div>
            <div class="dl-name">Windows 64-bit</div>
            <div class="dl-tag">官方下载</div>
          </div>
          <span style="color: var(--primary); font-size: 18px">→</span>
        </a>
        <div class="download-links">
          <a :href="data.site.mirrorDownload" target="_blank" rel="noopener">备用下载</a>
          <span class="dl-sep">|</span>
          <a class="translation" :href="data.site.translationDownload" target="_blank" rel="noopener">汉化包</a>
          <template v-if="data.tutorial.enabled">
            <span class="dl-sep">|</span>
            <a class="tutorial-link" href="#" @click.prevent="showTutorial = true">使用教程</a>
          </template>
        </div>
      </section>

      <!-- 实时在线 -->
      <section v-if="visibleModules.realtime" class="card">
        <div class="section-title" style="justify-content: space-between">
          <span style="display: flex; align-items: center; gap: 10px">
            <span class="section-icon" style="background: rgba(16,185,129,.15); color: var(--green)">●</span>
            <span>实时在线 <span class="sub">Live Monitor</span></span>
          </span>
          <span class="badge live-badge">{{ data.realtime_list.length }}</span>
        </div>
        <div v-if="data.realtime_list.length === 0" class="empty">静谧时刻，等待第一位用户上线...</div>
        <div v-else class="realtime-list">
          <div v-for="(c, i) in data.realtime_list" :key="c.nickname + i" class="realtime-item">
            <span class="realtime-avatar">{{ c.nickname.charAt(0).toUpperCase() }}</span>
            <div style="min-width: 0; flex: 1">
              <div class="realtime-name">{{ c.nickname }}</div>
              <div class="realtime-channel">{{ c.channel || '默认频道' }}</div>
            </div>
            <div class="realtime-groups">
              <span v-for="g in c.groups" :key="g" class="badge group-badge">{{ g }}</span>
            </div>
          </div>
        </div>
        <div class="live-foot">
          <span class="live-dot"></span> 实时更新中
        </div>
      </section>
    </div>

    <!-- 使用教程弹窗 -->
    <Teleport to="body">
      <div v-if="showTutorial" class="modal-overlay" @click.self="showTutorial = false">
        <div class="modal tutorial-modal">
          <div class="tutorial-head">
            <div class="tutorial-title-group">
              <div class="tutorial-icon">?</div>
              <div>
                <h3>{{ data.tutorial.title }}</h3>
                <p class="tutorial-sub">TeamSpeak Guide</p>
              </div>
            </div>
            <button class="modal-close" @click="showTutorial = false" title="关闭">×</button>
          </div>
          <div class="tutorial-tabs">
            <button
              v-for="s in data.tutorial.sections"
              :key="s.key"
              class="tutorial-tab"
              :class="{ active: tutorialTab === s.key }"
              @click="tutorialTab = s.key"
            >{{ s.title }}</button>
          </div>
          <div class="tutorial-body markdown" v-html="tutorialHtml"></div>
          <div class="tutorial-foot">
            <span class="tutorial-updated">更新时间：{{ data.tutorial.updatedAt }}</span>
            <button class="btn green" @click="showTutorial = false">我知道了</button>
          </div>
        </div>
      </div>
    </Teleport>
    </div>
  </template>
</template>
