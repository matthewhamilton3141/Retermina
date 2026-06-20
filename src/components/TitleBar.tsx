import { useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const appWindow = getCurrentWebviewWindow();

/**
 * Custom title bar. Window dragging is handled by an explicit onMouseDown on
 * the drag region that calls startDragging() directly — this is intentional.
 *
 * The alternative, data-tauri-drag-region, installs a document-level mousedown
 * listener that calls startDragging() whenever the cursor is anywhere over a
 * tagged element. On macOS, startDragging() hands all subsequent mousemove
 * events to the OS for window movement, which silently kills any concurrent
 * react-draggable panel-drag (the panel stops following the cursor). Because
 * the user can move the mouse from a panel title bar up into the title bar
 * during a drag, the OS steals the events and the panel drag dies.
 *
 * The explicit onMouseDown below fires ONLY when the drag spacer itself is the
 * mousedown target, so it never races with the workspace grid.
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    appWindow.isMaximized().then((v) => { if (!cancelled) setMaximized(v); });

    const unlistenPromise = appWindow.onResized(async () => {
      const v = await appWindow.isMaximized();
      if (!cancelled) setMaximized(v);
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  function handleDragMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // Only start window drag on primary button, directly on the spacer
    if (e.button !== 0) return;
    e.preventDefault();
    appWindow.startDragging();
  }

  return (
    <div className="rt-titlebar flex items-center h-8 shrink-0 select-none">
      {/* Traffic lights */}
      <div className="flex items-center gap-1.5 px-3">
        <button
          type="button"
          className="rt-tl rt-tl-close"
          title="Close"
          aria-label="Close window"
          onClick={() => appWindow.close()}
        />
        <button
          type="button"
          className="rt-tl rt-tl-min"
          title="Minimize"
          aria-label="Minimize window"
          onClick={() => appWindow.minimize()}
        />
        <button
          type="button"
          className="rt-tl rt-tl-max"
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore window" : "Maximize window"}
          onClick={() => appWindow.toggleMaximize()}
        />
      </div>

      {/* Drag spacer — explicit startDragging() so it never competes with
          the workspace grid's react-draggable event loop */}
      <div
        ref={dragRef}
        className="flex-1 h-full cursor-move"
        onMouseDown={handleDragMouseDown}
      />
    </div>
  );
}

export default TitleBar;
