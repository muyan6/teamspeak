<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import type { ProfileData, UserSuggestion } from '../types';

const route = useRoute();
const router = useRouter();

const nickname = ref('');
const selectedUid = ref('');
const loading = ref(false);
const error = ref('');
const profile = ref<ProfileData | null>(null);
const suggestions = ref<UserSuggestion[]>([]);
const hoveredDay = ref<{ date: string; seconds: number } | null>(null);
const badgeFilter = ref<'all' | 'milestone' | 'behavior'>('all');
let suggestTimer: ReturnType<typeof setTimeout> | null = null;

interface HeatmapDay {
  date: string;
  seconds: number;
  level: number;
}

interface HeatmapWeek {
  days: HeatmapDay[];
  monthLabel?: string;
}

const heatmapWeeks = computed(() => {
  if (!profile.value) return [];
  const map = new Map<string, number>();
  for (const item of profile.value.activity_heatmap || []) {
    map.set(item.date, item.seconds);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dayOfWeek = today.getDay();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - (52 * 7 + dayOfWeek));

  const weeks: HeatmapWeek[] = [];
  let currentMonth = -1;
  const cursor = new Date(startDate);

  for (let w = 0; w <= 52; w++) {
    const days: HeatmapDay[] = [];
    let weekMonthLabel: string | undefined;

    for (let d = 0; d < 7; d++) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const dateNum = cursor.getDate();
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`;
      const seconds = map.get(dateStr) || 0;

      let level = 0;
      if (seconds > 0) {
        if (seconds < 3600) level = 1;
        else if (seconds < 3 * 3600) level = 2;
        else if (seconds < 6 * 3600) level = 3;
        else level = 4;
      }

      if (month !== currentMonth && dateNum <= 7) {
        currentMonth = month;
        weekMonthLabel = `${month + 1}月`;
      }

      days.push({
        date: dateStr,
        seconds,
        level,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    weeks.push({
      days,
      monthLabel: weekMonthLabel,
    });
  }

  return weeks;
});

const heatmapStats = computed(() => {
  if (!profile.value) return { activeDays: 0, totalHours: 0, maxDayHours: 0 };
  const list = profile.value.activity_heatmap || [];
  let totalSec = 0;
  let maxSec = 0;
  for (const item of list) {
    totalSec += item.seconds;
    if (item.seconds > maxSec) maxSec = item.seconds;
  }
  return {
    activeDays: list.filter((i) => i.seconds > 0).length,
    totalHours: Math.round((totalSec / 3600) * 10) / 10,
    maxDayHours: Math.round((maxSec / 3600) * 10) / 10,
  };
});

const filteredBadges = computed(() => {
  if (!profile.value || !profile.value.badges) return [];
  if (badgeFilter.value === 'all') return profile.value.badges;
  return profile.value.badges.filter((b) => b.category === badgeFilter.value);
});

const COLORS = [
  { bg: 'rgba(244,63,94,.16)', fg: '#fb7185' },
  { bg: 'rgba(251,191,36,.16)', fg: '#fbbf24' },
  { bg: 'rgba(16,185,129,.16)', fg: '#34d399' },
  { bg: 'rgba(56,189,248,.16)', fg: '#38bdf8' },
  { bg: 'rgba(168,85,247,.16)', fg: '#c084fc' },
  { bg: 'rgba(236,72,153,.16)', fg: '#f472b6' },
  { bg: 'rgba(251,146,60,.16)', fg: '#fb923c' },
  { bg: 'rgba(34,211,238,.16)', fg: '#22d3ee' },
];

function avatarLetter(): string {
  const n = profile.value?.nickname || '?';
  return n.slice(0, 1).toUpperCase();
}

function avatarStyle(): { background: string; color: string } {
  const n = profile.value?.nickname || '';
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  const c = COLORS[h % COLORS.length];
  return { background: c.bg, color: c.fg };
}

function fmtMinutes(m: number): string {
  if (!m || m < 0) return '0 分钟';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const rm = Math.floor(m % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} 天`);
  if (h > 0) parts.push(`${h} 小时`);
  if (rm > 0) parts.push(`${rm} 分`);
  return parts.join(' ') || '0 分钟';
}

function formatDate(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

async function search() {
  const name = nickname.value.trim();
  if (!name) return;
  loading.value = true;
  error.value = '';
  profile.value = null;
  suggestions.value = [];
  try {
    profile.value = await api.getUserStats(name, selectedUid.value || undefined);
    router.replace({ query: selectedUid.value ? { nickname: name, uid: selectedUid.value } : { nickname: name } });
  } catch (e) {
    error.value = (e as Error).message;
    try {
      const r = await api.suggestNicknames(name);
      suggestions.value = r.suggestions.filter((s) => s.uid !== selectedUid.value);
    } catch {
      suggestions.value = [];
    }
  } finally {
    loading.value = false;
  }
}

function selectSuggestion(suggestion: UserSuggestion) {
  nickname.value = suggestion.nickname;
  selectedUid.value = suggestion.uid;
  suggestions.value = [];
  void search();
}

function onInput() {
  selectedUid.value = '';
  if (suggestTimer) clearTimeout(suggestTimer);
  suggestTimer = setTimeout(async () => {
    const v = nickname.value.trim();
    if (!v) return;
    try {
      const r = await api.suggestNicknames(v);
      suggestions.value = r.suggestions;
    } catch {
      suggestions.value = [];
    }
  }, 250);
}

onMounted(() => {
  const q = String(route.query.nickname || '');
  const uid = String(route.query.uid || '');
  if (q) {
    nickname.value = q;
    selectedUid.value = uid;
    void search();
  }
});
</script>

<template>
  <div class="profile-page">
    <div class="profile-topbar">
      <button class="back-btn" @click="router.push('/')">← 返回首页</button>
      <span class="profile-brand">个人数据查询 · Profile</span>
    </div>

    <!-- 搜索区 -->
    <section class="card search-card">
      <div class="search-inner">
        <h2 class="search-title">查询你的专属数据</h2>
        <p class="search-sub">输入你的 TeamSpeak 昵称，查看个人统计信息</p>
        <div class="search-row">
          <div class="search-input-wrap">
            <span class="search-icon">⌕</span>
            <input
              v-model="nickname"
              class="input"
              placeholder="输入昵称..."
              @keyup.enter="search"
              @input="onInput"
            />
            <div v-if="suggestions.length > 0 && !profile" class="suggestions">
              <button v-for="s in suggestions" :key="s.uid" class="suggestion-item" @click="selectSuggestion(s)">
                <span>{{ s.nickname }}</span>
                <small>UID: {{ s.uid }}</small>
              </button>
            </div>
          </div>
          <button class="btn primary search-btn" :disabled="loading || !nickname.trim()" @click="search">
            {{ loading ? '查询中...' : '查询' }}
          </button>
        </div>
        <div v-if="error" class="error-box">{{ error }}</div>
      </div>
    </section>

    <!-- 结果区 -->
    <section v-if="profile" class="profile-result">
      <!-- 用户头部 -->
      <div class="card profile-hero">
        <div class="hero-main">
          <div class="hero-avatar" :style="avatarStyle()">{{ avatarLetter() }}</div>
          <div>
            <h2 class="hero-name">{{ profile.nickname }}</h2>
            <div class="hero-meta"><span class="hero-id">UID: {{ profile.uid }}</span></div>
          </div>
        </div>
        <div class="hero-stats">
          <div class="hero-stat">
            <div class="hs-val accent">{{ profile.total_time.hours }}h</div>
            <div class="hs-label">总在线时长</div>
          </div>
          <div class="hero-stat">
            <div class="hs-val amber">{{ profile.streak.current_streak }}天</div>
            <div class="hs-label">连续在线</div>
          </div>
          <div class="hero-stat">
            <div class="hs-val emerald">{{ profile.total_time.days }}天</div>
            <div class="hs-label">活跃天数</div>
          </div>
        </div>
      </div>

      <!-- 主网格 -->
      <div class="profile-grid">
        <!-- 连续在线 -->
        <div class="card span-4">
          <div class="card-head">
            <div class="card-icon amber">✧</div>
            <div>
              <h3>连续在线</h3>
              <span class="card-sub">Streak</span>
            </div>
          </div>
          <div class="streak-grid">
            <div class="streak-cell grad">
              <div class="st-val">{{ profile.streak.current_streak }}天</div>
              <div class="st-label">当前连续</div>
            </div>
            <div class="streak-cell">
              <div class="st-val">{{ profile.streak.max_streak }}天</div>
              <div class="st-label">历史最高</div>
            </div>
          </div>
          <div class="streak-last">最后在线: {{ profile.streak.last_online || '-' }}</div>
        </div>

        <!-- 常去频道 -->
        <div class="card span-4">
          <div class="card-head">
            <div class="card-icon cyan">#</div>
            <div>
              <h3>常去频道</h3>
              <span class="card-sub">Frequent Channels</span>
            </div>
          </div>
          <ul v-if="profile.frequent_channels.length" class="freq-list">
            <li v-for="ch in profile.frequent_channels" :key="ch.name" class="freq-item">
              <span class="freq-name">{{ ch.name }}</span>
              <span class="freq-time">{{ fmtMinutes(ch.minutes) }}</span>
            </li>
          </ul>
          <div v-else class="empty">暂无频道数据</div>
        </div>

        <!-- 用户信息 -->
        <div class="card span-4">
          <div class="card-head">
            <div class="card-icon neutral">i</div>
            <div>
              <h3>用户信息</h3>
              <span class="card-sub">User Info</span>
            </div>
          </div>
          <div class="info-groups">
            <div class="info-label">服务器组</div>
            <div v-if="(profile.server_groups || []).length" class="group-chips">
              <span v-for="g in profile.server_groups" :key="g" class="group-chip">{{ g }}</span>
            </div>
            <div v-else class="info-empty">暂无服务器组数据</div>
          </div>
          <div class="info-rows">
            <div class="info-row"><span>首次记录</span><span>{{ profile.total_time.first_seen || '-' }}</span></div>
            <div class="info-row"><span>最后记录</span><span>{{ profile.total_time.last_seen || '-' }}</span></div>
            <div class="info-row"><span>活跃天数</span><span>{{ profile.total_time.days }} 天</span></div>
            <div class="info-row"><span>总在线时长</span><span class="accent">{{ fmtMinutes(profile.total_time.minutes) }}</span></div>
          </div>
        </div>

        <!-- 羁绊好友 -->
        <div class="card span-12">
          <div class="card-head">
            <div class="card-icon pink">♥</div>
            <div>
              <h3>羁绊好友</h3>
              <span class="card-sub">Bond Friends</span>
            </div>
          </div>
          <ul v-if="profile.bond_friends.length" class="bond-list">
            <li v-for="(f, i) in profile.bond_friends" :key="f.dbid" class="bond-item">
              <div class="bond-left">
                <div class="bond-icon" :class="{ top: i < 3 }">♥</div>
                <div>
                  <div class="bond-name">{{ f.name }}</div>
                  <div class="bond-sub">最后相遇: {{ formatDate(f.last_meet) }}</div>
                </div>
              </div>
              <div class="bond-right">
                <div class="bond-hours">{{ f.hours }}h</div>
                <div class="bond-sub">羁绊时长</div>
              </div>
            </li>
          </ul>
          <div v-else class="empty">暂无羁绊好友数据</div>
        </div>

        <!-- 365 天在线活跃热力图 (GitHub 风格) -->
        <div class="card span-12 heatmap-card">
          <div class="card-head heatmap-header">
            <div style="display: flex; align-items: center; gap: 12px">
              <div class="card-icon emerald">
                <i class="ph-fill ph-calendar-check" style="font-size: 1.25rem"></i>
              </div>
              <div>
                <h3>年度活跃热力图</h3>
                <span class="card-sub">Activity Heatmap · 过去 365 天</span>
              </div>
            </div>
            <div class="heatmap-summary-stats">
              <div class="h-stat-pill">
                <span class="h-stat-num">{{ heatmapStats.activeDays }}</span>
                <span class="h-stat-label">活跃天数</span>
              </div>
              <div class="h-stat-pill">
                <span class="h-stat-num">{{ heatmapStats.totalHours }}h</span>
                <span class="h-stat-label">累计在线</span>
              </div>
              <div class="h-stat-pill">
                <span class="h-stat-num">{{ heatmapStats.maxDayHours }}h</span>
                <span class="h-stat-label">单日峰值</span>
              </div>
            </div>
          </div>

          <div class="heatmap-container">
            <div class="heatmap-scroll-area">
              <!-- Month labels -->
              <div class="heatmap-months-row">
                <div class="heatmap-weekday-placeholder"></div>
                <div class="heatmap-grid-months">
                  <div
                    v-for="(week, wIdx) in heatmapWeeks"
                    :key="'m-' + wIdx"
                    class="heatmap-month-col"
                  >
                    <span v-if="week.monthLabel" class="heatmap-month-label">{{ week.monthLabel }}</span>
                  </div>
                </div>
              </div>

              <!-- Main Grid with Weekday Labels -->
              <div class="heatmap-body-row">
                <div class="heatmap-weekdays-labels">
                  <span>周日</span>
                  <span>周二</span>
                  <span>周四</span>
                  <span>周六</span>
                </div>

                <div class="heatmap-grid-weeks">
                  <div
                    v-for="(week, wIdx) in heatmapWeeks"
                    :key="'w-' + wIdx"
                    class="heatmap-week-col"
                  >
                    <div
                      v-for="day in week.days"
                      :key="day.date"
                      class="heatmap-cell"
                      :class="'level-' + day.level"
                      @mouseenter="hoveredDay = day"
                      @mouseleave="hoveredDay = null"
                    >
                      <div class="heatmap-tooltip">
                        <span class="tooltip-date">{{ day.date }}</span>
                        <span class="tooltip-val">{{ day.seconds > 0 ? fmtMinutes(Math.round(day.seconds / 60)) : '未在线' }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Legend & Hover info footer -->
            <div class="heatmap-foot-row">
              <div class="heatmap-hover-info">
                <template v-if="hoveredDay">
                  <span class="hover-date">{{ hoveredDay.date }}:</span>
                  <span class="hover-hours">{{ hoveredDay.seconds > 0 ? fmtMinutes(Math.round(hoveredDay.seconds / 60)) : '未在线' }}</span>
                </template>
                <template v-else>
                  <span class="hover-placeholder">鼠标悬停查看单日详细在线记录</span>
                </template>
              </div>

              <div class="heatmap-legend">
                <span class="legend-text">少</span>
                <div class="heatmap-cell level-0"></div>
                <div class="heatmap-cell level-1"></div>
                <div class="heatmap-cell level-2"></div>
                <div class="heatmap-cell level-3"></div>
                <div class="heatmap-cell level-4"></div>
                <span class="legend-text">多</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 荣誉与徽章成就墙 -->
        <div class="card span-12 badges-card">
          <div class="card-head badges-header">
            <div style="display: flex; align-items: center; gap: 12px">
              <div class="card-icon amber">
                <i class="ph-fill ph-medal" style="font-size: 1.25rem"></i>
              </div>
              <div>
                <h3>荣誉与徽章墙</h3>
                <span class="card-sub">Badges & Achievements · {{ (profile.badges || []).filter(b => b.unlocked).length }} / {{ (profile.badges || []).length }} 已解锁</span>
              </div>
            </div>

            <!-- Filter tabs -->
            <div class="badge-filter-tabs">
              <button
                class="b-filter-btn"
                :class="{ active: badgeFilter === 'all' }"
                @click="badgeFilter = 'all'"
              >
                全部 ({{ (profile.badges || []).length }})
              </button>
              <button
                class="b-filter-btn"
                :class="{ active: badgeFilter === 'milestone' }"
                @click="badgeFilter = 'milestone'"
              >
                时长成就
              </button>
              <button
                class="b-filter-btn"
                :class="{ active: badgeFilter === 'behavior' }"
                @click="badgeFilter = 'behavior'"
              >
                趣味徽章
              </button>
            </div>
          </div>

          <div v-if="filteredBadges.length" class="badges-grid-list">
            <div
              v-for="b in filteredBadges"
              :key="b.id"
              class="badge-card-item"
              :class="{ 'is-unlocked': b.unlocked }"
            >
              <div class="badge-card-top">
                <div
                  class="badge-icon-box"
                  :style="b.unlocked ? { background: b.color + '22', color: b.color, borderColor: b.color + '55' } : {}"
                >
                  <i :class="['ph-fill', b.icon]"></i>
                </div>
                <span
                  class="badge-cat-tag"
                  :class="b.category === 'milestone' ? 'cat-milestone' : 'cat-behavior'"
                >
                  {{ b.category === 'milestone' ? '时长成就' : '趣味徽章' }}
                </span>
              </div>

              <div class="badge-card-main">
                <div class="badge-title-row">
                  <h4 class="badge-name">{{ b.name }}</h4>
                  <span v-if="b.unlocked" class="badge-status-unlocked">
                    <i class="ph-bold ph-check"></i> 已解锁
                  </span>
                  <span v-else class="badge-status-locked">
                    <i class="ph-bold ph-lock"></i> 进行中
                  </span>
                </div>
                <p class="badge-desc">{{ b.description }}</p>

                <!-- Progress bar if locked and has progress -->
                <div v-if="!b.unlocked && b.progress" class="badge-progress-wrap">
                  <div class="badge-progress-bar">
                    <div
                      class="badge-progress-fill"
                      :style="{ width: Math.min(100, Math.round((b.progress.current / b.progress.total) * 100)) + '%' }"
                    ></div>
                  </div>
                  <div class="badge-progress-text">
                    <span>达成进度</span>
                    <span>{{ b.progress.current }} / {{ b.progress.total }} {{ b.progress.unit }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty">暂无相关徽章数据</div>
        </div>
      </div>
    </section>

    <!-- 空状态 -->
    <section v-else-if="!loading && !error" class="empty-state">
      <div class="empty-icon">◌</div>
      <p>输入昵称查询个人数据</p>
    </section>
  </div>
</template>

<style scoped>
.profile-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.profile-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: 11px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.back-btn:hover {
  color: var(--text);
  border-color: var(--primary);
}

.profile-brand {
  font-size: 13px;
  color: var(--text-faint);
  font-weight: 600;
}

.search-card {
  padding: 22px;
}

.search-inner {
  max-width: 640px;
  margin: 0 auto;
  text-align: center;
}

.search-title {
  font-size: 20px;
  font-weight: 800;
  color: var(--text);
}

.search-sub {
  font-size: 13px;
  color: var(--text-faint);
  margin: 6px 0 18px;
}

.search-row {
  display: flex;
  gap: 10px;
}

.search-input-wrap {
  position: relative;
  flex: 1;
}

.search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 18px;
  color: var(--text-faint);
  pointer-events: none;
}

.search-input-wrap .input {
  padding-left: 40px;
  height: 46px;
}

.search-btn {
  flex-shrink: 0;
  padding: 0 28px;
}

.suggestions {
  position: absolute;
  left: 0;
  right: 0;
  top: 52px;
  background: var(--bg-card-solid);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  z-index: 20;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}

.suggestion-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  text-align: left;
  padding: 11px 16px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
}

.suggestion-item small {
  overflow: hidden;
  color: var(--text-faint);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion-item:hover {
  background: var(--bg-hover);
}

.error-box {
  margin-top: 14px;
  padding: 12px;
  border-radius: 11px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--red);
  font-size: 13px;
}

.profile-result {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 用户头部 */
.profile-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.hero-main {
  display: flex;
  align-items: center;
  gap: 16px;
}

.hero-avatar {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.3);
}

.hero-name {
  font-size: 24px;
  font-weight: 800;
  color: var(--text);
}

.hero-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}

.hero-id {
  font-size: 13px;
  color: var(--text-faint);
  overflow-wrap: anywhere;
}

.hero-stats {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  min-width: 300px;
}

.hero-stat {
  text-align: center;
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
}

.hs-val {
  font-size: 22px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.hs-label {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 4px;
}

.accent {
  color: var(--primary);
}

.amber {
  color: var(--amber);
}

.emerald {
  color: var(--green);
}

/* 主网格 */
.profile-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 20px;
}

.span-12 {
  grid-column: span 12;
}

.span-4 {
  grid-column: span 4;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.card-head h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.card-sub {
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.card-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.card-icon.amber {
  background: rgba(251, 191, 36, 0.15);
  color: var(--amber);
}

.card-icon.pink {
  background: rgba(236, 72, 153, 0.15);
  color: #f472b6;
}

.card-icon.cyan {
  background: rgba(34, 211, 238, 0.15);
  color: var(--cyan);
}

.card-icon.neutral {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-dim);
}

/* 连续在线 */
.streak-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.streak-cell {
  padding: 16px;
  border-radius: 12px;
  text-align: center;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
}

.streak-cell.grad {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.16), rgba(251, 146, 60, 0.1));
  border-color: rgba(251, 191, 36, 0.3);
}

.st-val {
  font-size: 28px;
  font-weight: 900;
  color: var(--text);
}

.streak-cell.grad .st-val {
  color: var(--amber);
}

.st-label {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 4px;
}

.streak-last {
  margin-top: 12px;
  padding: 10px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.03);
  text-align: center;
  font-size: 12px;
  color: var(--text-faint);
}

/* 羁绊好友 */
.bond-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bond-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
}

.bond-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.bond-icon {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: rgba(236, 72, 153, 0.14);
  color: #f472b6;
  flex-shrink: 0;
}

.bond-icon.top {
  background: linear-gradient(135deg, #f472b6, #f43f5e);
  color: #fff;
}

.bond-name {
  font-weight: 700;
  font-size: 14px;
  color: var(--text);
}

.bond-sub {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 2px;
}

.bond-right {
  text-align: right;
  flex-shrink: 0;
}

.bond-hours {
  font-size: 16px;
  font-weight: 800;
  color: #f472b6;
  font-variant-numeric: tabular-nums;
}

/* 常去频道 */
.freq-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.freq-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
}

.freq-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.freq-time {
  font-size: 12px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  margin-left: 10px;
}

/* 用户信息 */
.info-groups {
  padding: 12px;
  border-radius: 11px;
  background: rgba(34, 211, 238, 0.06);
  border: 1px solid rgba(34, 211, 238, 0.18);
  margin-bottom: 14px;
}

.info-label {
  font-size: 11px;
  color: var(--text-faint);
  margin-bottom: 8px;
}

.group-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.group-chip {
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(34, 211, 238, 0.14);
  color: var(--cyan);
}

.info-empty {
  font-size: 12px;
  color: var(--text-faint);
}

.info-rows {
  display: flex;
  flex-direction: column;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-dim);
}

.info-row:last-child {
  border-bottom: none;
}

.info-row span:last-child {
  font-weight: 600;
  color: var(--text);
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 60px 0;
  color: var(--text-faint);
}

.empty-icon {
  font-size: 80px;
  color: var(--text-faint);
  opacity: 0.4;
  margin-bottom: 12px;
}

.empty {
  text-align: center;
  padding: 24px 0;
  color: var(--text-faint);
  font-size: 13px;
}

/* ========== Heatmap Card ========== */
.heatmap-card {
  padding: 20px;
}

.heatmap-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 20px;
}

.card-icon.emerald {
  background: rgba(16, 185, 129, 0.15);
  color: var(--green);
}

.heatmap-summary-stats {
  display: flex;
  align-items: center;
  gap: 10px;
}

.h-stat-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
}

.h-stat-num {
  font-size: 15px;
  font-weight: 800;
  color: var(--green);
  font-variant-numeric: tabular-nums;
}

.h-stat-label {
  font-size: 10px;
  color: var(--text-faint);
  margin-top: 2px;
}

.heatmap-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.heatmap-scroll-area {
  overflow-x: auto;
  padding-bottom: 8px;
}

.heatmap-months-row {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
  min-width: 760px;
}

.heatmap-weekday-placeholder {
  width: 32px;
  flex-shrink: 0;
}

.heatmap-grid-months {
  display: flex;
  gap: 3px;
  flex: 1;
}

.heatmap-month-col {
  width: 12px;
  font-size: 10px;
  color: var(--text-faint);
  position: relative;
}

.heatmap-month-label {
  position: absolute;
  left: 0;
  top: 0;
  white-space: nowrap;
  font-weight: 600;
}

.heatmap-body-row {
  display: flex;
  min-width: 760px;
}

.heatmap-weekdays-labels {
  width: 32px;
  flex-shrink: 0;
  display: grid;
  grid-template-rows: repeat(7, 12px);
  gap: 3px;
  font-size: 9px;
  color: var(--text-faint);
  line-height: 12px;
}

.heatmap-weekdays-labels span:nth-child(1) { grid-row: 1; }
.heatmap-weekdays-labels span:nth-child(2) { grid-row: 3; }
.heatmap-weekdays-labels span:nth-child(3) { grid-row: 5; }
.heatmap-weekdays-labels span:nth-child(4) { grid-row: 7; }

.heatmap-grid-weeks {
  display: flex;
  gap: 3px;
  flex: 1;
}

.heatmap-week-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.heatmap-cell {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  position: relative;
  transition: all 0.15s ease;
  cursor: pointer;
}

.heatmap-cell.level-0 {
  background: rgba(255, 255, 255, 0.05);
}

.heatmap-cell.level-1 {
  background: rgba(16, 185, 129, 0.35);
}

.heatmap-cell.level-2 {
  background: rgba(16, 185, 129, 0.6);
}

.heatmap-cell.level-3 {
  background: rgba(16, 185, 129, 0.85);
}

.heatmap-cell.level-4 {
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
}

.heatmap-cell:hover {
  transform: scale(1.3);
  z-index: 10;
}

.heatmap-tooltip {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: #171717;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 4px 8px;
  display: none;
  flex-direction: column;
  align-items: center;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  z-index: 20;
}

.heatmap-cell:hover .heatmap-tooltip {
  display: flex;
}

.tooltip-date {
  font-size: 10px;
  color: var(--text-faint);
}

.tooltip-val {
  font-size: 11px;
  font-weight: 700;
  color: var(--green);
}

.heatmap-foot-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.heatmap-hover-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hover-date {
  color: var(--text-dim);
  font-weight: 600;
}

.hover-hours {
  color: var(--green);
  font-weight: 700;
}

.hover-placeholder {
  color: var(--text-faint);
  font-size: 11px;
}

.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-text {
  font-size: 10px;
  color: var(--text-faint);
  margin: 0 2px;
}

/* ========== Badges Wall ========== */
.badges-card {
  padding: 20px;
}

.badges-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 20px;
}

.badge-filter-tabs {
  display: flex;
  gap: 6px;
  background: rgba(255, 255, 255, 0.03);
  padding: 3px;
  border-radius: 9px;
  border: 1px solid var(--border);
}

.b-filter-btn {
  padding: 5px 12px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.b-filter-btn:hover {
  color: var(--text);
}

.b-filter-btn.active {
  background: rgba(251, 191, 36, 0.15);
  color: var(--amber);
}

.badges-grid-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.badge-card-item {
  padding: 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  gap: 12px;
  opacity: 0.65;
}

.badge-card-item.is-unlocked {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.12);
  opacity: 1;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.badge-card-item.is-unlocked:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
}

.badge-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.badge-icon-box {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-faint);
  border: 1px solid var(--border);
}

.badge-cat-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  text-transform: uppercase;
}

.cat-milestone {
  background: rgba(251, 191, 36, 0.12);
  color: var(--amber);
}

.cat-behavior {
  background: rgba(129, 140, 248, 0.12);
  color: #818cf8;
}

.badge-card-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.badge-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.badge-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.badge-status-unlocked {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--green);
}

.badge-status-locked {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-faint);
}

.badge-desc {
  font-size: 12px;
  color: var(--text-faint);
  line-height: 1.4;
}

.badge-progress-wrap {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.badge-progress-bar {
  height: 5px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.badge-progress-fill {
  height: 100%;
  background: var(--amber);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.badge-progress-text {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-faint);
}

@media (max-width: 900px) {
  .span-12,
  .span-4 {
    grid-column: span 12;
  }
}
</style>
