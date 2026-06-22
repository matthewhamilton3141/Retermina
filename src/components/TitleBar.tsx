import { useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";

const appWindow = getCurrentWebviewWindow();

/** Window rectangle in physical pixels. */
interface Rect { x: number; y: number; w: number; h: number; }

/** Tween duration for the maximize / restore animation. */
const ANIM_MS = 230;

/** easeOutCubic — fast start, gentle settle. */
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Animate the window's outer bounds from `from` to `to` by stepping
 * setPosition + setSize each frame. The window is driven manually (rather than
 * the OS's instant maximize) so the resize is smooth.
 *
 * Each frame skips issuing a new IPC pair while the previous one is still in
 * flight (`pending`) so we never flood the bridge, and the final frame snaps to
 * the exact target so rounding never leaves the window a pixel off.
 */
function animateBounds(from: Rect, to: Rect): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    let pending = false;

    const apply = (r: Rect) =>
      Promise.all([
        appWindow.setPosition(new PhysicalPosition(r.x, r.y)),
        appWindow.setSize(new PhysicalSize(r.w, r.h)),
      ]);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ANIM_MS);
      const e = ease(t);
      const r: Rect = {
        x: Math.round(from.x + (to.x - from.x) * e),
        y: Math.round(from.y + (to.y - from.y) * e),
        w: Math.round(from.w + (to.w - from.w) * e),
        h: Math.round(from.h + (to.h - from.h) * e),
      };
      if (!pending) {
        pending = true;
        apply(r).finally(() => { pending = false; });
      }
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        apply(to).finally(() => resolve());
      }
    };
    requestAnimationFrame(step);
  });
}

/**
 * Custom title bar for the decorations:false + transparent:true window.
 *
 * Window dragging uses an explicit onMouseDown → startDragging() on the outer
 * bar rather than data-tauri-drag-region. The attribute approach installs a
 * document-level listener that calls startDragging() on ANY mousedown near a
 * tagged element — including while the cursor drifts over the bar mid-panel-
 * drag. Once startDragging() fires, macOS hands all subsequent mousemove events
 * to the OS window-move loop, silently killing react-draggable's panel drag.
 *
 * Maximize/restore is animated: instead of the OS's instant snap we tween the
 * window's outer bounds between the restored rect (captured on maximize) and
 * the monitor's work area. `prefers-reduced-motion` falls back to an instant
 * jump. Double-clicking the bar and the green traffic-light both route through
 * the same toggle so the tracked state stays coherent.
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  // Outer bounds to restore to when un-maximizing (captured at maximize time).
  const restoreRef = useRef<Rect | null>(null);
  // Guards against re-entrancy while a tween is running.
  const animatingRef = useRef(false);

  async function toggleMaximize() {
    if (animatingRef.current) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    try {
      animatingRef.current = true;

      if (maximized) {
        // ── Restore ──
        const target = restoreRef.current;
        if (!target) { await appWindow.unmaximize(); setMaximized(false); return; }

        const pos = await appWindow.outerPosition();
        const size = await appWindow.outerSize();
        const from: Rect = { x: pos.x, y: pos.y, w: size.width, h: size.height };

        if (reduceMotion) {
          await appWindow.setPosition(new PhysicalPosition(target.x, target.y));
          await appWindow.setSize(new PhysicalSize(target.w, target.h));
        } else {
          await animateBounds(from, target);
        }
        setMaximized(false);
      } else {
        // ── Maximize ──
        const monitor = await currentMonitor();
        if (!monitor) { await appWindow.maximize(); setMaximized(true); return; }

        const pos = await appWindow.outerPosition();
        const size = await appWindow.outerSize();
        const from: Rect = { x: pos.x, y: pos.y, w: size.width, h: size.height };
        restoreRef.current = from;

        const wa = monitor.workArea;
        const target: Rect = {
          x: wa.position.x,
          y: wa.position.y,
          w: wa.size.width,
          h: wa.size.height,
        };

        if (reduceMotion) {
          await appWindow.setPosition(new PhysicalPosition(target.x, target.y));
          await appWindow.setSize(new PhysicalSize(target.w, target.h));
        } else {
          await animateBounds(from, target);
        }
        setMaximized(true);
      }
    } finally {
      animatingRef.current = false;
    }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    // Buttons (close/min/max) handle themselves — don't steal their clicks.
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    appWindow.startDragging();
  }

  // Double-clicking the title bar toggles maximize/restore — the standard
  // desktop convention. Guarded against the traffic-light buttons so a quick
  // double-click on one never also resizes the window.
  function handleDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    void toggleMaximize();
  }

  return (
    <div
      className="rt-titlebar flex items-center h-8 shrink-0 select-none"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Traffic lights — left-aligned, macOS convention */}
      <div className="group flex items-center gap-1.5 px-3">
        <button
          type="button"
          className="rt-tl rt-tl-close"
          title="Close"
          aria-label="Close window"
          onClick={() => appWindow.close()}
        >
          <svg className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 12 12">
            <path stroke="rgba(0,0,0,0.6)" strokeWidth="1.2" strokeLinecap="round" d="M 3 3 L 9 9 M 9 3 L 3 9" />
          </svg>
        </button>
        <button
          type="button"
          className="rt-tl rt-tl-min"
          title="Minimize"
          aria-label="Minimize window"
          onClick={() => appWindow.minimize()}
        >
          <svg className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 12 12">
            <path stroke="rgba(0,0,0,0.6)" strokeWidth="1.2" strokeLinecap="round" d="M 2.5 6 L 9.5 6" />
          </svg>
        </button>
        <button
          type="button"
          className="rt-tl rt-tl-max"
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore window" : "Maximize window"}
          onClick={() => void toggleMaximize()}
        >
          <svg className="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 12 12">
            <path fill="rgba(0,0,0,0.6)" d="M 2.5 2.5 L 7.5 2.5 L 2.5 7.5 Z M 9.5 9.5 L 4.5 9.5 L 9.5 4.5 Z" />
          </svg>
        </button>
      </div>

      {/* Remaining space is a drag target — cursor reinforces affordance */}
      <div className="flex-1 h-full cursor-move" />
    </div>
  );
}

export default TitleBar;
