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
let nextId = 1;

export function useToast() {
  function show(message: string, type: ToastType = 'info', duration = 3500, title?: string): number {
    const id = nextId++;
    const item: ToastItem = { id, type, message, title, duration };
    toasts.value.push(item);

    if (duration > 0) {
      setTimeout(() => {
        remove(id);
      }, duration);
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
    const idx = toasts.value.findIndex((t) => t.id === id);
    if (idx !== -1) {
      toasts.value.splice(idx, 1);
    }
  }

  function clear(): void {
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
