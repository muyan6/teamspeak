<script setup lang="ts">
import { onMounted, ref } from 'vue';
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
let suggestTimer: ReturnType<typeof setTimeout> | null = null;

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
            <li v-for="(f, i) in profile.bond_friends" :key="f.name" class="bond-item">
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

@media (max-width: 900px) {
  .span-12,
  .span-4 {
    grid-column: span 12;
  }
}
</style>
