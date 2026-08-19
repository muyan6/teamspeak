<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import type { AchievementLevel, ChampionConfig, ElasticGroup, ServerGroup, Ts3ConnectionInfo, UnlockedAchievement } from '../types';
import Ts3Admin from './Ts3Admin.vue';

const password = ref('');
const authed = ref(api.isAuthed());
const loginError = ref('');
const activeTab = ref<'elastic' | 'champion' | 'achievement' | 'server' | 'site' | 'ts3'>('elastic');
const notice = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
const savingTs3 = ref(false);
function showNotice(msg: string): void {
  notice.value = msg;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.value = '';
  }, 3000);
}

// 弹性频道
const elasticGroups = ref<ElasticGroup[]>([]);
const egForm = ref({ name: '', namePrefix: '', createThreshold: 2, deleteThreshold: 0, maxChannels: 8 });

// 周冠军
const champion = ref<ChampionConfig | null>(null);
const championForm = ref({ enabled: 0, serverGroupId: 0, checkIntervalHours: 24 });

// 在线时长成就
const achievementLevels = ref<AchievementLevel[]>([]);
const unlockedAchievements = ref<UnlockedAchievement[]>([]);
const achievementForm = ref({ title: '', hours: 1, serverGroupId: 0 });

// 被监控的 TS3 服务器连接配置
const ts3Conn = ref<Ts3ConnectionInfo | null>(null);
const ts3Form = ref({ host: '', queryPort: 10011, serverPort: 9987, username: '', password: '' });

// 站点配置
const siteGuide = ref('');
const siteDownload = ref({ version: '3.6.2', officialUrl: '', mirrorUrl: '', translationUrl: '' });

// 服务器组
const serverGroups = ref<ServerGroup[]>([]);

async function login() {
  loginError.value = '';
  try {
    await api.login(password.value);
    authed.value = true;
    void loadAll();
  } catch (e) {
    loginError.value = (e as Error).message;
  }
}

function logout() {
  api.logout();
  authed.value = false;
  password.value = '';
}

async function loadElastic() {
  elasticGroups.value = await api.listElasticGroups();
}

async function loadChampion() {
  champion.value = await api.getChampionConfig();
  championForm.value = {
    enabled: champion.value.enabled,
    serverGroupId: champion.value.serverGroupId ?? 0,
    checkIntervalHours: champion.value.checkIntervalHours,
  };
}

async function loadAchievements() {
  [achievementLevels.value, unlockedAchievements.value] = await Promise.all([
    api.listAchievementLevels(),
    api.listUnlockedAchievements(),
  ]);
}

async function loadSite() {
  const cfg = await api.getSiteConfig();
  siteGuide.value = cfg.guide ?? '';
  siteDownload.value = {
    version: cfg.clientDownload?.version ?? '3.6.2',
    officialUrl: cfg.clientDownload?.officialUrl ?? '',
    mirrorUrl: cfg.clientDownload?.mirrorUrl ?? '',
    translationUrl: cfg.clientDownload?.translationUrl ?? '',
  };
}

async function loadServerGroups() {
  try {
    serverGroups.value = await api.getServerGroups();
  } catch (e) {
    showNotice((e as Error).message);
  }
}

async function loadTs3Config() {
  ts3Conn.value = await api.getTs3Config();
  ts3Form.value = {
    host: ts3Conn.value.host,
    queryPort: ts3Conn.value.queryPort,
    serverPort: ts3Conn.value.serverPort,
    username: ts3Conn.value.username,
    password: '',
  };
}

async function loadAll() {
  await Promise.all([loadElastic(), loadChampion(), loadAchievements(), loadSite(), loadServerGroups(), loadTs3Config()]);
}

async function addElastic() {
  if (!egForm.value.name || !egForm.value.namePrefix) return;
  await api.addElasticGroup(egForm.value);
  egForm.value = { name: '', namePrefix: '', createThreshold: 2, deleteThreshold: 0, maxChannels: 8 };
  showNotice('弹性频道组已添加');
  await loadElastic();
}

async function removeElastic(id: number) {
  await api.deleteElasticGroup(id);
  await loadElastic();
}

async function saveChampion() {
  await api.saveChampionConfig(championForm.value);
  showNotice('周冠军配置已保存');
  await loadChampion();
}

async function runChampionCheck() {
  const r = await api.checkChampion();
  showNotice(r.result ? `本周冠军：${r.result.nickname}` : '未检测到本周冠军');
}

async function addAchievement() {
  if (!achievementForm.value.title.trim() || achievementForm.value.hours < 0 || !achievementForm.value.serverGroupId) return;
  await api.addAchievementLevel(achievementForm.value);
  achievementForm.value = { title: '', hours: 1, serverGroupId: 0 };
  showNotice('在线时长成就已添加');
  await loadAchievements();
}

async function toggleAchievement(level: AchievementLevel) {
  await api.updateAchievementLevel(level.id, { ...level, enabled: level.enabled ? 0 : 1 });
  await loadAchievements();
}

async function removeAchievement(id: number) {
  await api.deleteAchievementLevel(id);
  await loadAchievements();
}

async function runAchievementCheck() {
  const result = await api.checkAchievements();
  const granted = result.results.filter((entry) => entry.granted).length;
  showNotice(granted ? `已授予 ${granted} 项成就` : '本轮没有新增成就');
  await loadAchievements();
}

async function saveSite() {
  await api.saveSiteConfig({
    guide: siteGuide.value,
    clientDownload: siteDownload.value,
  });
  showNotice('站点配置已保存');
}

async function saveTs3Config() {
  if (!ts3Form.value.host.trim()) {
    showNotice('服务器地址不能为空');
    return;
  }
  if (savingTs3.value) return;
  savingTs3.value = true;
  try {
    const result = await api.saveTs3Config(ts3Form.value);
    ts3Conn.value = { ...(ts3Conn.value ?? {}), ...result.config, connected: false };
    showNotice('服务器配置已保存，正在重新连接；若仍未连接，请检查 ServerQuery');
    await loadTs3Config();
  } catch (e) {
    showNotice(`服务器配置保存失败：${(e as Error).message || '请求失败'}`);
  } finally {
    savingTs3.value = false;
  }
}

onMounted(() => {
  if (authed.value) void loadAll();
});
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
        </div>

        <div v-if="notice" class="notice">{{ notice }}</div>

        <!-- 弹性频道 -->
        <div v-if="activeTab === 'elastic'" class="tab-panel">
          <table class="tbl">
            <thead><tr><th>名称</th><th>前缀</th><th>满员阈值</th><th>最大频道</th><th></th></tr></thead>
            <tbody>
              <tr v-for="g in elasticGroups" :key="g.id">
                <td>{{ g.name }}</td>
                <td class="mono">{{ g.namePrefix }}</td>
                <td>{{ g.createThreshold }}</td>
                <td>{{ g.maxChannels }}</td>
                <td style="text-align: right"><button class="btn sm danger" @click="removeElastic(g.id)">删除</button></td>
              </tr>
              <tr class="tbl-form-row">
                <td><input v-model="egForm.name" class="input" placeholder="名称" /></td>
                <td><input v-model="egForm.namePrefix" class="input" placeholder="频道前缀" /></td>
                <td><input v-model.number="egForm.createThreshold" class="input" type="number" placeholder="满员阈值" /></td>
                <td><input v-model.number="egForm.maxChannels" class="input" type="number" placeholder="最大频道" /></td>
                <td style="text-align: right"><button class="btn primary" @click="addElastic">添加</button></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 在线时长成就 -->
        <div v-if="activeTab === 'achievement'" class="tab-panel">
          <div class="modal-actions" style="margin-top: 0">
            <button class="btn sm" @click="runAchievementCheck">立即检测</button>
          </div>
          <table class="tbl">
            <thead><tr><th>成就</th><th>在线时长</th><th>奖励服务器组</th><th>状态</th><th></th></tr></thead>
            <tbody>
              <tr v-for="level in achievementLevels" :key="level.id">
                <td>{{ level.title }}</td>
                <td>{{ level.hours }} 小时</td>
                <td>{{ serverGroups.find((group) => group.sgid === level.serverGroupId)?.name || `SG${level.serverGroupId}` }}</td>
                <td><button class="btn sm" :class="{ primary: level.enabled }" @click="toggleAchievement(level)">{{ level.enabled ? '已启用' : '已停用' }}</button></td>
                <td style="text-align: right"><button class="btn sm danger" @click="removeAchievement(level.id)">删除</button></td>
              </tr>
              <tr class="tbl-form-row">
                <td><input v-model="achievementForm.title" class="input" placeholder="成就名称" /></td>
                <td><input v-model.number="achievementForm.hours" class="input" type="number" min="0" placeholder="小时" /></td>
                <td>
                  <select v-model.number="achievementForm.serverGroupId" class="input">
                    <option :value="0" disabled>选择服务器组</option>
                    <option v-for="group in serverGroups" :key="group.sgid" :value="group.sgid">{{ group.name }}</option>
                  </select>
                </td>
                <td colspan="2" style="text-align: right"><button class="btn primary" @click="addAchievement">添加</button></td>
              </tr>
            </tbody>
          </table>
          <div class="achievement-history">
            <div class="section-title">最近已解锁</div>
            <div v-if="!unlockedAchievements.length" class="empty">暂无已解锁成就</div>
            <ul v-else class="achievement-list">
              <li v-for="entry in unlockedAchievements.slice(0, 10)" :key="`${entry.nickname}-${entry.title}`">
                <span>{{ entry.nickname }}</span><span>{{ entry.title }} · {{ entry.hours }} 小时</span>
              </li>
            </ul>
          </div>
        </div>

        <!-- 周冠军 -->
        <div v-if="activeTab === 'champion'" class="tab-panel">
          <div class="field">
            <label>启用周冠军</label>
            <select v-model.number="championForm.enabled" class="input">
              <option :value="0">关闭</option>
              <option :value="1">启用</option>
            </select>
          </div>
          <div class="field">
            <label>奖励服务器组</label>
            <select v-model.number="championForm.serverGroupId" class="input">
              <option :value="0" disabled>选择服务器组</option>
              <option v-for="g in serverGroups" :key="g.sgid" :value="g.sgid">{{ g.name }}</option>
            </select>
          </div>
          <div class="field">
            <label>检测间隔（小时）</label>
            <input v-model.number="championForm.checkIntervalHours" class="input" type="number" />
          </div>
          <div v-if="champion && champion.lastWinnerNickname" class="champion-last">
            上期冠军：{{ champion.lastWinnerNickname }}
          </div>
          <div class="modal-actions">
            <button class="btn sm" @click="runChampionCheck">立即检测</button>
            <button class="btn primary" @click="saveChampion">保存配置</button>
          </div>
        </div>

        <!-- TS3 管理 -->
        <div v-if="activeTab === 'ts3'" class="tab-panel">
          <Ts3Admin />
        </div>

        <!-- 服务器配置 -->
        <div v-if="activeTab === 'server'" class="tab-panel">
          <div v-if="ts3Conn" class="conn-status" :class="{ ok: ts3Conn.connected }">
            连接状态：{{ ts3Conn.connected ? '已连接' : '未连接' }}
          </div>
          <div class="field">
            <label>服务器地址（host）</label>
            <input v-model="ts3Form.host" class="input" placeholder="例如 150.158.129.222" />
          </div>
          <div class="field">
            <label>ServerQuery 端口</label>
            <input v-model.number="ts3Form.queryPort" class="input" type="number" />
          </div>
          <div class="field">
            <label>语音端口</label>
            <input v-model.number="ts3Form.serverPort" class="input" type="number" />
          </div>
          <div class="field">
            <label>ServerQuery 账号</label>
            <input v-model="ts3Form.username" class="input" placeholder="serveradmin" />
          </div>
          <div class="field">
            <label>ServerQuery 密码</label>
            <input v-model="ts3Form.password" class="input" type="password" placeholder="留空保持原密码" />
          </div>
          <p class="hint">保存后将立即使用新配置重新连接被监控的 TS 服务器。公开显示地址仍为 996，不受影响。</p>
          <div class="modal-actions">
            <button class="btn primary" :disabled="savingTs3" @click="saveTs3Config">
              {{ savingTs3 ? '保存中...' : '保存并重连' }}
            </button>
          </div>
        </div>

        <!-- 站点配置 -->
        <div v-if="activeTab === 'site'" class="tab-panel">
          <div class="field">
            <label>下载教程（Markdown，留空使用默认教程）</label>
            <textarea v-model="siteGuide" class="input" rows="8" placeholder="留空使用默认教程"></textarea>
          </div>
          <div class="field">
            <label>官方下载链接</label>
            <input v-model="siteDownload.officialUrl" class="input" placeholder="留空使用默认" />
          </div>
          <div class="field">
            <label>备用下载链接</label>
            <input v-model="siteDownload.mirrorUrl" class="input" placeholder="留空使用默认" />
          </div>
          <div class="field">
            <label>汉化包链接</label>
            <input v-model="siteDownload.translationUrl" class="input" placeholder="留空使用默认" />
          </div>
          <div class="modal-actions">
            <button class="btn primary" @click="saveSite">保存</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.admin-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.admin-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--bg-hover);
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s;
}

.back-btn:hover {
  color: var(--text);
  border-color: var(--primary);
}

.admin-brand {
  color: var(--text-faint);
  font-size: 13px;
  font-weight: 600;
}

.admin-surface {
  min-width: 0;
}

.achievement-history {
  margin-top: 20px;
}

.achievement-list {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.achievement-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-dim);
  font-size: 13px;
}

.admin-page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.admin-page-heading h2 {
  margin: 0;
  color: var(--text);
  font-size: 20px;
  font-weight: 800;
}

.admin-page-heading p {
  margin: 5px 0 0;
  color: var(--text-faint);
  font-size: 13px;
}

:deep(.tab-panel) {
  overflow-x: auto;
}

:deep(.tbl) {
  width: 100%;
}

@media (max-width: 640px) {
  .admin-page-heading {
    align-items: flex-start;
  }

  :deep(.tbl) {
    min-width: 640px;
  }
}
</style>
