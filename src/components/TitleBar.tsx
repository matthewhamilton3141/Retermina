import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const appWindow = getCurrentWebviewWindow();

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
 * The handler here guards against buttons via closest('button') so traffic-
 * light clicks never accidentally start a window drag, and covers the full
 * title bar width (including the gap left of the traffic lights).
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

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

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    // Buttons (close/min/max) handle themselves — don't steal their clicks.
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    appWindow.startDragging();
  }

  return (
    <div
      className="rt-titlebar flex items-center h-8 shrink-0 select-none"
      onMouseDown={handleMouseDown}
    >
      {/* Traffic lights — left-aligned, macOS convention */}
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

      {/* Remaining space is a drag target — cursor reinforces affordance */}
      <div className="flex-1 h-full cursor-move" />
    </div>
  );
}

export default TitleBar;
