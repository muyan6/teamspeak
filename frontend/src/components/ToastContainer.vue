<script setup lang="ts">
import { useToast } from '../composables/useToast';

const { toasts, remove } = useToast();

function getIcon(type: string): string {
  switch (type) {
    case 'success':
      return 'ph-check-circle';
    case 'error':
      return 'ph-x-circle';
    case 'warning':
      return 'ph-warning-circle';
    case 'info':
    default:
      return 'ph-info';
  }
}
</script>

<template>
  <div class="toast-container" aria-live="polite" aria-atomic="true">
    <TransitionGroup name="toast-slide" tag="div" class="toast-list">
      <div
        v-for="item in toasts"
        :key="item.id"
        class="toast-item"
        :class="item.type"
        role="alert"
      >
        <div class="toast-icon">
          <i :class="['ph-fill', getIcon(item.type)]"></i>
        </div>
        <div class="toast-content">
          <div v-if="item.title" class="toast-title">{{ item.title }}</div>
          <div class="toast-message">{{ item.message }}</div>
        </div>
        <button class="toast-close" title="关闭提示" @click="remove(item.id)">
          <i class="ph-bold ph-x"></i>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  pointer-events: none;
  max-width: 420px;
  width: calc(100vw - 32px);
}

.toast-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.toast-item {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 14px;
  background: rgba(24, 24, 27, 0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border-strong);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast-item.success {
  border-color: rgba(16, 185, 129, 0.4);
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(24, 24, 27, 0.94));
}

.toast-item.success .toast-icon {
  color: #34d399;
  background: rgba(16, 185, 129, 0.2);
}

.toast-item.error {
  border-color: rgba(239, 68, 68, 0.45);
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(24, 24, 27, 0.94));
}

.toast-item.error .toast-icon {
  color: #f87171;
  background: rgba(239, 68, 68, 0.2);
}

.toast-item.warning {
  border-color: rgba(251, 191, 36, 0.45);
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.12), rgba(24, 24, 27, 0.94));
}

.toast-item.warning .toast-icon {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.2);
}

.toast-item.info {
  border-color: rgba(56, 189, 248, 0.4);
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(24, 24, 27, 0.94));
}

.toast-item.info .toast-icon {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.2);
}

.toast-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  margin-top: 1px;
}

.toast-content {
  flex: 1;
  min-width: 0;
}

.toast-title {
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 2px;
}

.toast-message {
  font-size: 13px;
  line-height: 1.45;
  color: #e4e4e7;
  word-break: break-word;
}

.toast-close {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-faint);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  margin-top: 2px;
}

.toast-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

/* Animations */
.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast-slide-enter-from {
  opacity: 0;
  transform: translateX(40px) scale(0.95);
}

.toast-slide-leave-to {
  opacity: 0;
  transform: translateY(-16px) scale(0.95);
}

@media (max-width: 640px) {
  .toast-container {
    top: 16px;
    right: 16px;
    left: 16px;
    width: auto;
    max-width: 100%;
  }
}
</style>
