/**
 * A small, glass-themed confirmation modal for destructive or irreversible
 * actions (e.g. closing a live workspace tab). Escape or the backdrop cancels;
 * Enter confirms. Rendered only while `open` so it stays out of the tab order
 * otherwise.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import Icon from "./Icon";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true the confirm button is styled as destructive (red). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    // Focus the confirm button so Enter/Space acts immediately.
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  // Portal to <body> so the modal escapes any ancestor stacking context (e.g.
  // the tab strip's `z-50`) and always paints above every toolbar and panel.
  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div ref={dialogRef} className="rt-card flex w-full max-w-sm flex-col overflow-hidden shadow-2xl">
        <div className="flex items-start gap-3 p-5">
          <div
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{
              background: destructive ? "rgba(239,68,68,0.15)" : "var(--rt-surface-strong)",
              color: destructive ? "rgb(248,113,113)" : "var(--rt-accent)",
            }}
          >
            <Icon name="info" size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{title}</h2>
            <div className="rt-text-muted mt-1 text-sm">{message}</div>
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-[var(--rt-border)] px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rt-btn-outline px-3 py-1.5 text-xs font-medium"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs font-semibold"
            style={{
              borderRadius: "var(--rt-radius, 6px)",
              background: destructive ? "rgb(220,38,38)" : "var(--rt-accent)",
              color: "var(--rt-accent-contrast, #fff)",
            }}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
