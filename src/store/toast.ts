/**
 * Transient toast notifications.
 *
 * A minimal queue rendered by <Toaster>. Toasts can carry a single action
 * (e.g. "Undo"); auto-dismiss timing is handled by the Toaster component so the
 * store stays free of timers.
 */
import { create } from "zustand";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  action?: ToastAction;
  /** Auto-dismiss delay in ms; 0 keeps it until dismissed. */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  /** Enqueue a toast; returns its id. */
  push: (toast: { message: string; action?: ToastAction; duration?: number }) => string;
  dismiss: (id: string) => void;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: ({ message, action, duration = 5000 }) => {
    const id = newId();
    set((s) => ({ toasts: [...s.toasts, { id, message, action, duration }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
