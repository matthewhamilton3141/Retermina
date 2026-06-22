/**
 * FloatingMenu — a reusable, viewport-anchored popup surface.
 *
 * Why this exists: menus (right-click context menus, popovers) rendered inside
 * a workspace panel are trapped by that panel. react-grid-layout applies a CSS
 * `transform` to every grid item, which makes `position: fixed` resolve against
 * the panel rather than the viewport, and the panel's `overflow: hidden` then
 * clips anything that spills past its edges (e.g. a context menu next to the
 * Code panel gets covered).
 *
 * Rendering through a portal into `document.body` escapes every panel's
 * transform/overflow/stacking context, so the menu always floats on the top
 * layer above the whole app. Coordinates are viewport-relative (clientX/Y) and
 * are clamped/flipped so the menu stays fully on-screen.
 *
 * Use this anywhere a menu must break out of its container.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface FloatingMenuProps {
  /** Anchor point in viewport coordinates (e.g. event.clientX / clientY). */
  x: number;
  y: number;
  /** Called when the user clicks away or presses Escape. */
  onClose: () => void;
  children: ReactNode;
  /** Extra classes for the menu surface (defaults include `rt-menu`). */
  className?: string;
}

/** Gap kept between the menu and the viewport edge when clamping. */
const EDGE_MARGIN = 8;

export function FloatingMenu({ x, y, onClose, children, className }: FloatingMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Start at the requested point; the layout effect corrects it before paint.
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // Flip/clamp so the menu never spills past the viewport edges. Runs before
  // paint, so the user never sees the unclamped position.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();

    let left = x;
    let top = y;
    if (left + width + EDGE_MARGIN > window.innerWidth) {
      // Prefer opening to the left of the cursor; clamp if still overflowing.
      left = Math.max(EDGE_MARGIN, Math.min(x - width, window.innerWidth - width - EDGE_MARGIN));
    }
    if (top + height + EDGE_MARGIN > window.innerHeight) {
      top = Math.max(EDGE_MARGIN, Math.min(y - height, window.innerHeight - height - EDGE_MARGIN));
    }
    setPos({ left, top });
  }, [x, y]);

  // Escape closes the menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      {/* Click-away / scroll catcher. Right-click on it also closes. */}
      <div
        className="fixed inset-0 z-[1000]"
        onMouseDown={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        ref={ref}
        className={`rt-menu fixed z-[1001] ${className ?? ""}`}
        style={{ left: pos.left, top: pos.top }}
        role="menu"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export default FloatingMenu;
