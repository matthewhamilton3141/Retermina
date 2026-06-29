import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Trap keyboard focus within `ref` while `active`.
 *
 * On activation it focuses the first focusable element; Tab / Shift+Tab wrap at
 * the ends instead of escaping to the page behind. On deactivation it restores
 * focus to whatever was focused before (typically the control that opened the
 * dialog). Visible (rendered) elements only, so hidden controls are skipped.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null,
      );

    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [ref, active]);
}
