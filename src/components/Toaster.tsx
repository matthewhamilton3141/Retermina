/** Bottom-centre stack of transient toasts (see store/toast). */
import { useEffect } from "react";

import Icon from "./Icon";
import { useToastStore, type Toast } from "../store/toast";

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);

  // Auto-dismiss after the toast's duration (0 = sticky). Kept in the component
  // so the store holds no timers; resets if the duration ever changes.
  useEffect(() => {
    if (!toast.duration) return;
    const id = window.setTimeout(() => dismiss(toast.id), toast.duration);
    return () => window.clearTimeout(id);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <div className="rt-menu pointer-events-auto flex items-center gap-3 px-3 py-2 shadow-lg">
      <span className="text-sm">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => { toast.action!.onClick(); dismiss(toast.id); }}
          className="rt-btn-outline rt-btn-active shrink-0 px-2 py-0.5 text-xs font-medium"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        title="Dismiss"
        className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center"
      >
        <Icon name="close" size={12} aria-label="Dismiss" />
      </button>
    </div>
  );
}

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[300] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => <ToastRow key={t.id} toast={t} />)}
    </div>
  );
}
