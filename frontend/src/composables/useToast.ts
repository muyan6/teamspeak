import { ref } from 'vue';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  title?: string;
  duration: number;
}

const toasts = ref<ToastItem[]>([]);
/** 记录每条 toast 的自动关闭定时器，手动关闭/清空时一并回收，避免句柄泄漏。 */
const dismissTimers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

export function useToast() {
  function show(message: string, type: ToastType = 'info', duration = 3500, title?: string): number {
    const id = nextId++;
    const item: ToastItem = { id, type, message, title, duration };
    toasts.value.push(item);

    if (duration > 0) {
      const timer = setTimeout(() => {
        dismissTimers.delete(id);
        remove(id);
      }, duration);
      dismissTimers.set(id, timer);
    }

    return id;
  }

  function success(message: string, duration = 3500, title?: string): number {
    return show(message, 'success', duration, title);
  }

  function error(message: string, duration = 4500, title?: string): number {
    return show(message, 'error', duration, title);
  }

  function warning(message: string, duration = 4000, title?: string): number {
    return show(message, 'warning', duration, title);
  }

  function info(message: string, duration = 3500, title?: string): number {
    return show(message, 'info', duration, title);
  }

  function remove(id: number): void {
    const timer = dismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimers.delete(id);
    }
    const idx = toasts.value.findIndex((t) => t.id === id);
    if (idx !== -1) {
      toasts.value.splice(idx, 1);
    }
  }

  function clear(): void {
    for (const timer of dismissTimers.values()) clearTimeout(timer);
    dismissTimers.clear();
    toasts.value = [];
  }

  return {
    toasts,
    show,
    success,
    error,
    warning,
    info,
    remove,
    clear,
  };
}

export const toast = useToast();
