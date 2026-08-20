<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import type { AchievementLevel, BadgeConditionType, BadgeDefinition, ServerGroup, UnlockedAchievement } from '../../types';

const activeTab = ref<'badges' | 'levels'>('badges');

const levels = ref<AchievementLevel[]>([]);
const badges = ref<BadgeDefinition[]>([]);
const unlocked = ref<UnlockedAchievement[]>([]);
const groups = ref<ServerGroup[]>([]);
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

// 时长成就表单
const levelForm = ref({ title: '', hours: 1, serverGroupId: 0 });

// 勋章编辑模态框与表单
const showBadgeModal = ref(false);
const editingBadgeId = ref<number | null>(null);
const badgeForm = ref<{
  name: string;
  category: 'behavior' | 'custom' | 'milestone';
  conditionType: BadgeConditionType;
  threshold: number;
  icon: string;
  color: string;
  description: string;
  serverGroupId: number;
  sortOrder: number;
}>({
  name: '',
  category: 'behavior',
  conditionType: 'streak_days',
  threshold: 7,
  icon: 'ph-fire',
  color: '#f97316',
  description: '',
  serverGroupId: 0,
  sortOrder: 100,
});

// 精选图标库
const ICON_PRESETS = [
  { icon: 'ph-moon-stars', label: '夜猫/深夜' },
  { icon: 'ph-fire', label: '连击/火焰' },
  { icon: 'ph-crown', label: '皇冠/周冠' },
  { icon: 'ph-users-three', label: '好友/社交' },
  { icon: 'ph-microphone', label: '房管/麦克' },
  { icon: 'ph-lightning', label: '闪电/全勤' },
  { icon: 'ph-trophy', label: '奖杯/荣耀' },
  { icon: 'ph-star', label: '星标/精英' },
  { icon: 'ph-shield', label: '盾牌/守护' },
  { icon: 'ph-game-controller', label: '手柄/电竞' },
  { icon: 'ph-heart', label: '爱心/陪伴' },
  { icon: 'ph-rocket', label: '火箭/先锋' },
  { icon: 'ph-headphones', label: '耳机/音乐' },
  { icon: 'ph-diamond', label: '钻石/尊贵' },
  { icon: 'ph-target', label: '准星/目标' },
  { icon: 'ph-medal', label: '金牌/勋章' },
  { icon: 'ph-sparkle', label: '星光/璀璨' },
  { icon: 'ph-coffee', label: '咖啡/悠闲' },
  { icon: 'ph-compass', label: '罗盘/探索' },
  { icon: 'ph-sword', label: '利剑/战神' },
  { icon: 'ph-chat-circle-dots', label: '气泡/畅聊' },
  { icon: 'ph-armchair', label: '沙发/常客' },
  { icon: 'ph-bell', label: '铃铛/准时' },
  { icon: 'ph-cube', label: '方块/创造' },
];

// 精选配色板
const COLOR_PRESETS = [
  { color: '#fbbf24', label: '琥珀金' },
  { color: '#f97316', label: '烈焰橙' },
  { color: '#fb7185', label: '玫瑰粉' },
  { color: '#818cf8', label: '幽夜蓝' },
  { color: '#22d3ee', label: '极光青' },
  { color: '#34d399', label: '翡翠绿' },
  { color: '#a855f7', label: '紫罗兰' },
  { color: '#f43f5e', label: '珊瑚红' },
];

function showNotice(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3500);
}

async function load(): Promise<void> {
  try {
    const [achievementLevels, badgeList, unlockedAchievements, serverGroups] = await Promise.all([
      api.listAchievementLevels(),
      api.listBadges(),
      api.listUnlockedAchievements(),
      api.getServerGroups(),
    ]);
    levels.value = achievementLevels;
    badges.value = badgeList;
    unlocked.value = unlockedAchievements;
    groups.value = serverGroups;
  } catch (error) {
    showNotice((error as Error).message);
  }
}

// 时长成就管理
async function addLevel(): Promise<void> {
  if (!levelForm.value.title.trim() || levelForm.value.hours < 0) return;
  try {
    await api.addAchievementLevel({ ...levelForm.value, title: levelForm.value.title.trim() });
    levelForm.value = { title: '', hours: 1, serverGroupId: 0 };
    showNotice('在线时长成就已添加并自动匹配授予');
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function toggleLevel(level: AchievementLevel): Promise<void> {
  try {
    await api.updateAchievementLevel(level.id, { ...level, enabled: level.enabled ? 0 : 1 });
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function removeLevel(id: number): Promise<void> {
  try {
    await api.deleteAchievementLevel(id);
    showNotice('时长成就已删除');
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

// 勋章管理
function openAddBadgeModal(): void {
  editingBadgeId.value = null;
  badgeForm.value = {
    name: '',
    category: 'behavior',
    conditionType: 'streak_days',
    threshold: 7,
    icon: 'ph-fire',
    color: '#f97316',
    description: '',
    serverGroupId: 0,
    sortOrder: (badges.value.length + 1) * 10,
  };
  showBadgeModal.value = true;
}

function openEditBadgeModal(b: BadgeDefinition): void {
  editingBadgeId.value = b.id;
  const threshold = Number(b.conditionParams?.threshold || b.conditionParams?.start_hour || 1);
  badgeForm.value = {
    name: b.name,
    category: b.category,
    conditionType: b.conditionType,
    threshold: Number.isFinite(threshold) ? threshold : 1,
    icon: b.icon || 'ph-medal',
    color: b.color || '#fbbf24',
    description: b.description || '',
    serverGroupId: b.serverGroupId || 0,
    sortOrder: b.sortOrder || 100,
  };
  showBadgeModal.value = true;
}

async function saveBadge(): Promise<void> {
  if (!badgeForm.value.name.trim()) {
    showNotice('请输入勋章名称');
    return;
  }

  let conditionParams: Record<string, any> = {};
  if (badgeForm.value.conditionType === 'night_owl') {
    conditionParams = { start_hour: 2, end_hour: 5 };
  } else {
    conditionParams = { threshold: Number(badgeForm.value.threshold || 1) };
  }

  const payload = {
    name: badgeForm.value.name.trim(),
    category: badgeForm.value.category,
    icon: badgeForm.value.icon.trim() || 'ph-medal',
    color: badgeForm.value.color,
    description: badgeForm.value.description.trim(),
    conditionType: badgeForm.value.conditionType,
    conditionParams,
    serverGroupId: badgeForm.value.serverGroupId || 0,
    sortOrder: Number(badgeForm.value.sortOrder || 100),
    enabled: 1,
  };

  try {
    if (editingBadgeId.value) {
      await api.updateBadge(editingBadgeId.value, payload);
      showNotice('勋章已修改并自动全员匹配');
    } else {
      await api.addBadge(payload);
      showNotice('新勋章已添加并自动全员匹配');
    }
    showBadgeModal.value = false;
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function toggleBadge(b: BadgeDefinition): Promise<void> {
  try {
    await api.updateBadge(b.id, { ...b, enabled: b.enabled ? 0 : 1 });
    showNotice(b.enabled ? '勋章已停用' : '勋章已启用并重新计算');
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function removeBadge(id: number): Promise<void> {
  try {
    await api.deleteBadge(id);
    showNotice('勋章已删除');
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

async function runCheck(): Promise<void> {
  try {
    const result = await api.checkAchievements();
    const granted = result.results.filter((entry) => entry.granted).length;
    showNotice(granted ? `已为成员授予 ${granted} 项成就与勋章` : '本轮检测完毕，成员当前数据已全部匹配完成');
    await load();
  } catch (error) {
    showNotice((error as Error).message);
  }
}

function formatConditionSummary(b: BadgeDefinition): string {
  const p = b.conditionParams || {};
  switch (b.conditionType) {
    case 'streak_days':
      return `连续打卡 ≥ ${p.threshold || 7} 天`;
    case 'total_hours':
      return `累计在线 ≥ ${p.threshold || 1} 小时`;
    case 'active_days':
      return `累计活跃 ≥ ${p.threshold || 30} 天`;
    case 'night_owl':
      return `凌晨 02:00~05:00 深度在线`;
    case 'bond_friends':
      return `羁绊好友 ≥ ${p.threshold || 3} 位`;
    case 'channel_stay':
      return `单频道停留 ≥ ${p.threshold || 50} 小时`;
    case 'weekly_champion':
      return `获得过周冠军 ≥ ${p.threshold || 1} 次`;
    default:
      return '自定义条件';
  }
}

function groupName(serverGroupId: number): string {
  if (!serverGroupId || serverGroupId <= 0) return '无（仅网站勋章）';
  return groups.value.find((group) => group.sgid === serverGroupId)?.name || `SG${serverGroupId}`;
}

onMounted(() => { void load(); });
</script>

<template>
  <div class="achievements-container">
    <div v-if="notice" class="notice">{{ notice }}</div>

    <!-- 顶部功能切换 -->
    <div class="tabs-header-row">
      <div class="sub-nav-tabs">
        <button
          class="sub-tab-btn"
          :class="{ active: activeTab === 'badges' }"
          @click="activeTab = 'badges'"
        >
          <i class="ph-fill ph-medal"></i> 勋章与行为成就 ({{ badges.length }})
        </button>
        <button
          class="sub-tab-btn"
          :class="{ active: activeTab === 'levels' }"
          @click="activeTab = 'levels'"
        >
          <i class="ph-fill ph-trophy"></i> 时长成就等级 ({{ levels.length }})
        </button>
      </div>

      <div class="top-actions">
        <button class="btn sm" @click="runCheck" title="立即对全员重新计算并发放">
          <i class="ph-bold ph-arrows-clockwise"></i> 立即全员检测匹配
        </button>
        <button v-if="activeTab === 'badges'" class="btn sm primary" @click="openAddBadgeModal">
          <i class="ph-bold ph-plus"></i> 新增勋章
        </button>
      </div>
    </div>

    <!-- 视图 1：勋章勋位管理 (Badges) -->
    <div v-if="activeTab === 'badges'" class="tab-content-box">
      <table class="tbl">
        <thead>
          <tr>
            <th>勋章样式 / 名称</th>
            <th>分类</th>
            <th>达成条件</th>
            <th>描述</th>
            <th>奖励服务器组</th>
            <th>状态</th>
            <th style="text-align: right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in badges" :key="b.id" class="badge-table-row">
            <td>
              <div class="badge-preview-cell">
                <div
                  class="badge-mini-avatar"
                  :style="{ background: b.color + '20', color: b.color, borderColor: b.color + '55' }"
                >
                  <i :class="['ph-fill', b.icon || 'ph-medal']"></i>
                </div>
                <span class="badge-table-name" :style="{ color: b.color }">{{ b.name }}</span>
              </div>
            </td>
            <td>
              <span class="badge-chip" :class="b.category">
                {{ b.category === 'behavior' ? '趣味行为' : (b.category === 'milestone' ? '时长成就' : '自定义') }}
              </span>
            </td>
            <td>
              <span class="condition-badge-tag">{{ formatConditionSummary(b) }}</span>
            </td>
            <td>
              <span class="badge-table-desc" :title="b.description">{{ b.description || '-' }}</span>
            </td>
            <td>
              <span class="group-reward-tag">{{ groupName(b.serverGroupId) }}</span>
            </td>
            <td>
              <button
                class="btn sm"
                :class="{ primary: b.enabled }"
                @click="toggleBadge(b)"
              >
                {{ b.enabled ? '已启用' : '已停用' }}
              </button>
            </td>
            <td style="text-align: right">
              <div style="display: inline-flex; gap: 6px">
                <button class="btn sm" @click="openEditBadgeModal(b)">编辑</button>
                <button class="btn sm danger" @click="removeBadge(b.id)">删除</button>
              </div>
            </td>
          </tr>
          <tr v-if="!badges.length">
            <td colspan="7" class="empty">暂无勋章配置，点击右上角“新增勋章”添加</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 视图 2：时长成就管理 (Levels) -->
    <div v-else class="tab-content-box">
      <table class="tbl">
        <thead>
          <tr>
            <th>成就等级名称</th>
            <th>所需在线时长</th>
            <th>奖励服务器组</th>
            <th>状态</th>
            <th style="text-align: right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="level in levels" :key="level.id">
            <td style="font-weight: 700">{{ level.title }}</td>
            <td><span class="condition-badge-tag">{{ level.hours }} 小时</span></td>
            <td><span class="group-reward-tag">{{ groupName(level.serverGroupId) }}</span></td>
            <td>
              <button class="btn sm" :class="{ primary: level.enabled }" @click="toggleLevel(level)">
                {{ level.enabled ? '已启用' : '已停用' }}
              </button>
            </td>
            <td style="text-align: right">
              <button class="btn sm danger" @click="removeLevel(level.id)">删除</button>
            </td>
          </tr>
          <tr class="tbl-form-row">
            <td><input v-model="levelForm.title" class="input" placeholder="例如：百小时老兵" /></td>
            <td><input v-model.number="levelForm.hours" class="input" type="number" min="0" placeholder="时长(小时)" /></td>
            <td>
              <select v-model.number="levelForm.serverGroupId" class="input">
                <option :value="0">无（仅勋章徽章与荣誉殿堂）</option>
                <option v-for="group in groups" :key="group.sgid" :value="group.sgid">{{ group.name }}</option>
              </select>
            </td>
            <td colspan="2" style="text-align: right">
              <button class="btn primary" @click="addLevel">添加时长等级</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="history">
        <div class="section-title">最近已解锁记录</div>
        <div v-if="!unlocked.length" class="empty">暂无已解锁记录</div>
        <ul v-else class="history-list">
          <li v-for="entry in unlocked.slice(0, 10)" :key="`${entry.nickname}-${entry.title}`">
            <span style="font-weight: 700; color: var(--text)">{{ entry.nickname }}</span>
            <span style="color: var(--amber)">{{ entry.title }} · 达成 {{ entry.hours }} 小时</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- 模态框：新增/编辑勋章 -->
    <div v-if="showBadgeModal" class="badge-modal-mask" @click.self="showBadgeModal = false">
      <div class="badge-modal-card">
        <div class="modal-head">
          <h3>{{ editingBadgeId ? '编辑勋章与达成条件' : '新增自定义勋章' }}</h3>
          <button class="modal-close" @click="showBadgeModal = false">✕</button>
        </div>

        <div class="modal-body">
          <!-- 实时预览区 -->
          <div class="live-preview-box">
            <div
              class="preview-badge-avatar"
              :style="{ background: badgeForm.color + '22', color: badgeForm.color, borderColor: badgeForm.color + '55' }"
            >
              <i :class="['ph-fill', badgeForm.icon || 'ph-medal']"></i>
            </div>
            <div>
              <div class="preview-badge-name" :style="{ color: badgeForm.color }">{{ badgeForm.name || '勋章名称预览' }}</div>
              <div class="preview-badge-desc">{{ badgeForm.description || '达成说明预览' }}</div>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label>勋章名称 *</label>
              <input v-model="badgeForm.name" class="input" placeholder="例如：夜猫子、破晓之星" />
            </div>

            <div class="form-group">
              <label>勋章分类</label>
              <select v-model="badgeForm.category" class="input">
                <option value="behavior">趣味行为勋章</option>
                <option value="custom">自定义勋章</option>
                <option value="milestone">时长里程碑成就</option>
              </select>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label>达成条件类型 *</label>
              <select v-model="badgeForm.conditionType" class="input">
                <option value="streak_days">🔥 连续在线打卡（连续天数）</option>
                <option value="total_hours">⏱️ 累计在线时长（小时）</option>
                <option value="active_days">⚡️ 累计活跃天数（总天数）</option>
                <option value="night_owl">🦉 凌晨深夜在线（02:00~05:00深度在线）</option>
                <option value="bond_friends">🤝 深度羁绊好友数（好友位）</option>
                <option value="channel_stay">🎙️ 单频道累计停留（小时）</option>
                <option value="weekly_champion">👑 曾荣获周冠军（获胜）</option>
              </select>
            </div>

            <div class="form-group" v-if="badgeForm.conditionType !== 'night_owl'">
              <label>达成阈值 * (
                {{ badgeForm.conditionType.includes('hour') ? '小时' : (badgeForm.conditionType.includes('day') ? '天' : '数量') }}
              )</label>
              <input v-model.number="badgeForm.threshold" class="input" type="number" min="1" placeholder="例如：7" />
            </div>
            <div class="form-group" v-else>
              <label>深夜时段</label>
              <input class="input" disabled value="凌晨 02:00 ~ 05:00 期间深度在线" />
            </div>
          </div>

          <!-- 配色选择 -->
          <div class="form-group">
            <label>勋章配色</label>
            <div class="color-picker-row">
              <button
                v-for="c in COLOR_PRESETS"
                :key="c.color"
                type="button"
                class="color-swatch-btn"
                :style="{ background: c.color }"
                :class="{ active: badgeForm.color === c.color }"
                @click="badgeForm.color = c.color"
                :title="c.label"
              ></button>
              <input v-model="badgeForm.color" class="input color-input-text" placeholder="#hex" />
            </div>
          </div>

          <!-- 图标选择器 -->
          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <label style="margin-bottom: 0">勋章图标 (Phosphor Icons)</label>
              <span style="font-size: 11px; color: var(--text-faint)">点击下方预设或输入类名</span>
            </div>
            <div class="icon-presets-grid">
              <button
                v-for="item in ICON_PRESETS"
                :key="item.icon"
                type="button"
                class="icon-preset-btn"
                :class="{ active: badgeForm.icon === item.icon }"
                @click="badgeForm.icon = item.icon"
                :title="item.label"
              >
                <i :class="['ph-fill', item.icon]"></i>
              </button>
            </div>
            <input v-model="badgeForm.icon" class="input" style="margin-top: 6px" placeholder="自定义图标类名，如 ph-fire" />
          </div>

          <div class="form-group">
            <label>勋章说明 / 达成描述</label>
            <input v-model="badgeForm.description" class="input" placeholder="例如：连续在线打卡达到 7 天" />
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label>奖励服务器组 (可选)</label>
              <select v-model.number="badgeForm.serverGroupId" class="input">
                <option :value="0">无（纯网站勋章）</option>
                <option v-for="group in groups" :key="group.sgid" :value="group.sgid">{{ group.name }}</option>
              </select>
            </div>

            <div class="form-group">
              <label>展示排序权重</label>
              <input v-model.number="badgeForm.sortOrder" class="input" type="number" placeholder="数字越小越靠前" />
            </div>
          </div>
        </div>

        <div class="modal-foot">
          <button class="btn" @click="showBadgeModal = false">取消</button>
          <button class="btn primary" @click="saveBadge">保存并全员匹配</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.achievements-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tabs-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.sub-nav-tabs {
  display: flex;
  gap: 6px;
  background: rgba(255, 255, 255, 0.03);
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.sub-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.sub-tab-btn:hover {
  color: var(--text);
}

.sub-tab-btn.active {
  background: rgba(251, 191, 36, 0.15);
  color: var(--amber);
}

.top-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.tab-content-box {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.badge-table-row:hover {
  background: rgba(255, 255, 255, 0.02);
}

.badge-preview-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.badge-mini-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  border: 1px solid;
  flex-shrink: 0;
}

.badge-table-name {
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.badge-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600;
}

.badge-chip.behavior {
  background: rgba(129, 140, 248, 0.15);
  color: #818cf8;
}

.badge-chip.milestone {
  background: rgba(251, 191, 36, 0.15);
  color: var(--amber);
}

.badge-chip.custom {
  background: rgba(34, 211, 238, 0.15);
  color: #22d3ee;
}

.condition-badge-tag {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-dim);
}

.badge-table-desc {
  font-size: 12px;
  color: var(--text-faint);
  max-width: 220px;
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-reward-tag {
  font-size: 12px;
  color: var(--text-faint);
}

/* 模态框样式 */
.badge-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(6px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.badge-modal-card {
  width: 100%;
  max-width: 580px;
  max-height: 90vh;
  background: #171717;
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-head {
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
}

.modal-head h3 {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.modal-close {
  background: transparent;
  border: none;
  color: var(--text-faint);
  font-size: 16px;
  cursor: pointer;
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.modal-foot {
  padding: 14px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.2);
}

.live-preview-box {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
}

.preview-badge-avatar {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  border: 1px solid;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.preview-badge-name {
  font-size: 15px;
  font-weight: 800;
}

.preview-badge-desc {
  font-size: 12px;
  color: var(--text-faint);
  margin-top: 2px;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
}

.color-picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-swatch-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.color-swatch-btn:hover {
  transform: scale(1.15);
}

.color-swatch-btn.active {
  border-color: #ffffff;
  transform: scale(1.15);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.4);
}

.color-input-text {
  width: 100px;
  font-family: monospace;
}

.icon-presets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
  gap: 6px;
  background: rgba(0, 0, 0, 0.2);
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.icon-preset-btn {
  height: 36px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.icon-preset-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
  transform: scale(1.1);
}

.icon-preset-btn.active {
  background: rgba(251, 191, 36, 0.2);
  border-color: var(--amber);
  color: var(--amber);
  transform: scale(1.1);
}

.history { margin-top: 20px; }
.history-list { display: grid; gap: 8px; margin: 10px 0 0; padding: 0; list-style: none; }
.history-list li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; color: var(--text-dim); font-size: 13px; }

@media (max-width: 600px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
