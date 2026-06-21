/**
 * useTauriFileDrop — per-element Tauri file-drop listener.
 *
 * Tauri's `onDragDropEvent` fires globally for the whole webview, so each
 * consumer checks whether the cursor is over its own element before acting.
 * Physical pixel positions are converted to CSS logical pixels via
 * `window.devicePixelRatio` so `elementFromPoint` works on Retina displays.
 *
 * Works for both files and directories — Tauri includes folder paths in the
 * `paths` array exactly like file paths.
 *
 * Usage:
 *   const dropRef = useRef<HTMLDivElement>(null);
 *   const { isDragOver } = useTauriFileDrop(dropRef, (paths) => { ... });
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
    // Guard against the component unmounting before the async listener
    // promise resolves — if it does, call unlisten() immediately.
    let cancelled = false;
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
        if (cancelled) {
          fn(); // component already unmounted — stop listening immediately
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [zoneRef]);

  return { isDragOver };
}
