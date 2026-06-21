/**
 * useTauriFileDrop — per-element Tauri file-drop listener.
 *
 * Tauri's `onDragDropEvent` fires globally for the whole webview, so each
 * consumer of this hook checks whether the cursor was actually over its own
 * DOM element before acting. Physical pixel positions from the event are
 * converted to CSS logical pixels via `window.devicePixelRatio` so
 * `elementFromPoint` works correctly on Retina displays.
 *
 * Usage:
 *   const dropRef = useRef<HTMLDivElement>(null);
 *   const { isDragOver } = useTauriFileDrop(dropRef, (paths) => { ... });
 *
 * Multiple independent drop zones (e.g. three terminal panels) can each use
 * this hook simultaneously — only the one whose element is under the cursor
 * at drop time will fire `onDrop`.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export function useTauriFileDrop(
  zoneRef: RefObject<Element | null>,
  onDrop: (paths: string[]) => void,
): { isDragOver: boolean } {
  const [isDragOver, setIsDragOver] = useState(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    function hitTest(physX: number, physY: number): boolean {
      const el = zoneRef.current;
      if (!el) return false;
      const dpr = window.devicePixelRatio || 1;
      const target = document.elementFromPoint(physX / dpr, physY / dpr);
      return target !== null && el.contains(target);
    }

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const { type } = event.payload;

        if (type === "enter" || type === "over") {
          const { x, y } = event.payload.position;
          setIsDragOver(hitTest(x, y));
        } else if (type === "drop") {
          const { x, y } = event.payload.position;
          if (hitTest(x, y)) {
            onDropRef.current(event.payload.paths);
          }
          setIsDragOver(false);
        } else {
          // "leave"
          setIsDragOver(false);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [zoneRef]);

  return { isDragOver };
}
