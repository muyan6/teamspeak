<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { HOME_MODULES, useHomeModules } from './home-modules';

const { modules, loading, saving, error, enabledCount, load, save, reset } = useHomeModules();
const notice = ref('');

async function saveModules(): Promise<void> {
  try {
    await save();
    notice.value = '主页模块配置已保存';
    window.setTimeout(() => (notice.value = ''), 2600);
  } catch {
    // 错误消息已由 composable 保存并展示。
  }
}

onMounted(() => void load());
</script>

<template>
  <section class="home-modules-panel" aria-labelledby="home-modules-title">
    <header class="panel-hero">
      <div class="panel-hero-icon" aria-hidden="true">▦</div>
      <div class="panel-heading">
        <p class="eyebrow">Homepage appearance</p>
        <h3 id="home-modules-title">主页模块</h3>
        <p>按需保留首页信息，关闭的模块不会占用页面空间。</p>
      </div>
      <div class="module-summary" :aria-label="`当前启用 ${enabledCount} 个模块`">
        <strong>{{ enabledCount }}</strong><span>/ {{ HOME_MODULES.length }} 已启用</span>
      </div>
    </header>

    <div v-if="loading" class="panel-state">正在读取模块配置…</div>
    <template v-else>
      <div class="modules-grid">
        <label v-for="module in HOME_MODULES" :key="module.key" class="module-card" :class="{ disabled: !modules[module.key] }">
          <span class="module-icon" aria-hidden="true">{{ module.icon }}</span>
          <span class="module-copy">
            <strong>{{ module.title }}</strong>
            <small>{{ module.description }}</small>
          </span>
          <input v-model="modules[module.key]" type="checkbox" class="switch-input" :aria-label="`切换${module.title}`" />
          <span class="switch" aria-hidden="true"><span></span></span>
        </label>
      </div>

      <p v-if="error" class="panel-error">{{ error }}</p>
      <p v-else-if="notice" class="panel-notice">{{ notice }}</p>

      <footer class="panel-actions">
        <button type="button" class="btn sm" :disabled="saving" @click="reset">恢复默认</button>
        <button type="button" class="btn primary" :disabled="saving" @click="saveModules">
          {{ saving ? '保存中…' : '保存模块设置' }}
        </button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.home-modules-panel { overflow: hidden; border: 1px solid var(--border); border-radius: 18px; background: linear-gradient(145deg, rgba(39, 39, 42, .74), rgba(24, 24, 27, .45)); }
.panel-hero { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 20px; border-bottom: 1px solid var(--border); background: linear-gradient(110deg, rgba(244, 63, 94, .13), transparent 58%); }
.panel-hero-icon, .module-icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.panel-hero-icon { width: 44px; height: 44px; color: #fff; font-size: 23px; border-radius: 13px; background: linear-gradient(135deg, var(--primary), var(--accent)); box-shadow: 0 8px 22px rgba(244, 63, 94, .28); }
.eyebrow { margin: 0 0 2px; color: var(--primary); font-size: 10px; font-weight: 800; letter-spacing: .11em; text-transform: uppercase; }
.panel-heading h3 { margin: 0; color: var(--text); font-size: 17px; }.panel-heading p:last-child { margin: 4px 0 0; color: var(--text-faint); font-size: 12px; }
.module-summary { min-width: 88px; padding: 8px 10px; border: 1px solid rgba(16,185,129,.25); border-radius: 11px; color: var(--green); background: rgba(16,185,129,.08); text-align: center; white-space: nowrap; }.module-summary strong { display: block; font-size: 18px; line-height: 1; }.module-summary span { font-size: 10px; font-weight: 700; }
.modules-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 16px; }
.module-card { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px; min-height: 82px; padding: 14px; border: 1px solid var(--border); border-radius: 14px; background: rgba(9, 9, 11, .3); cursor: pointer; transition: border-color .18s, background .18s, transform .18s; }.module-card:hover { border-color: rgba(244,63,94,.42); background: rgba(244,63,94,.06); transform: translateY(-1px); }.module-card.disabled { opacity: .58; }
.module-icon { width: 34px; height: 34px; border-radius: 10px; color: var(--primary); background: rgba(244,63,94,.12); font-size: 16px; font-weight: 800; }.module-copy { min-width: 0; }.module-copy strong, .module-copy small { display: block; }.module-copy strong { color: var(--text); font-size: 13px; }.module-copy small { margin-top: 4px; color: var(--text-faint); font-size: 11px; line-height: 1.38; }
.switch-input { position: absolute; width: 1px; height: 1px; opacity: 0; }.switch { width: 38px; height: 22px; padding: 3px; border-radius: 999px; background: rgba(113,113,122,.45); transition: background .18s; }.switch span { display: block; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .18s; box-shadow: 0 1px 4px rgba(0,0,0,.35); }.switch-input:checked + .switch { background: var(--green); }.switch-input:checked + .switch span { transform: translateX(16px); }.switch-input:focus-visible + .switch { outline: 2px solid var(--text); outline-offset: 3px; }
.panel-state, .panel-error, .panel-notice { margin: 16px; padding: 11px 13px; border-radius: 10px; font-size: 13px; }.panel-state { color: var(--text-dim); background: var(--bg-soft); }.panel-error { color: var(--red); background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.22); }.panel-notice { color: var(--green); background: rgba(16,185,129,.1); border: 1px solid rgba(16,185,129,.22); }
.panel-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 16px; border-top: 1px solid var(--border); background: rgba(9,9,11,.2); }
@media (max-width: 720px) { .modules-grid { grid-template-columns: minmax(0, 1fr); }.panel-hero { grid-template-columns: auto minmax(0, 1fr); }.module-summary { grid-column: 2; justify-self: start; }.panel-heading p:last-child { display: none; } }
</style>
