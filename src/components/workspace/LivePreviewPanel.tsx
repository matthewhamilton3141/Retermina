import { memo, useCallback, useEffect, useState } from "react";

import Icon from "../Icon";
import { listListeningPorts } from "../../lib/system";
import {
  openPreviewWindow,
  closePreviewWindow,
  isPreviewOpen,
} from "../../lib/previewWindow";

/**
 * Live Preview launcher panel.
 *
 * Replaces the old embedded-iframe approach with a native Tauri WebviewWindow
 * so that:
 *   - HMR WebSocket connections work natively (no iframe sandbox restrictions)
 *   - The preview feels like a real browser window, not a cramped panel pane
 *   - Closing the window terminates the underlying dev server automatically
 *
 * This panel is the control surface: URL detection, address bar, launch/close
 * buttons, and open/closed status. The actual rendering happens in the pop-out
 * window.
 */
export const LivePreviewPanel = memo(function LivePreviewPanel() {
  const [inputValue, setInputValue] = useState("");
  const [detecting, setDetecting] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [windowOpen, setWindowOpen] = useState(false);
  const [detectedPorts, setDetectedPorts] = useState<{ port: number; process: string }[]>([]);

  // Auto-detect listening ports on mount.
  useEffect(() => {
    listListeningPorts()
      .then((ports) => {
        setDetectedPorts(ports.map((p) => ({ port: p.port, process: p.process })));
        const first = ports[0];
        if (first) {
          setInputValue(`http://localhost:${first.port}`);
        }
      })
      .finally(() => setDetecting(false));
  }, []);

  // Sync window-open state on mount and whenever the panel re-focuses.
  useEffect(() => {
    isPreviewOpen().then(setWindowOpen);
  }, []);

  const launch = useCallback(async () => {
    const url = inputValue.trim();
    if (!url) return;
    const withScheme = url.startsWith("http") ? url : `http://${url}`;
    setLaunching(true);
    try {
      await openPreviewWindow(withScheme);
      setWindowOpen(true);
    } finally {
      setLaunching(false);
    }
  }, [inputValue]);

  const close = useCallback(async () => {
    await closePreviewWindow();
    setWindowOpen(false);
  }, []);

  const selectPort = useCallback((port: number) => {
    setInputValue(`http://localhost:${port}`);
  }, []);

  return (
    <div className="rt-subsurface flex h-full w-full flex-col">
      {/* Address bar */}
      <div className="rt-divider-b flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        <Icon name="preview" size={13} className="rt-accent-text shrink-0" />
        <form
          onSubmit={(e) => { e.preventDefault(); launch(); }}
          className="flex min-w-0 flex-1 items-center gap-1"
        >
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={detecting ? "Detecting dev server…" : "http://localhost:3000"}
            spellCheck={false}
            autoComplete="off"
            className="rt-input min-w-0 flex-1 px-2 py-0.5 font-mono text-[11px]"
          />
          <button
            type="submit"
            disabled={launching || !inputValue.trim()}
            title={windowOpen ? "Reopen / navigate" : "Launch preview window"}
            className="rt-btn-outline flex h-6 shrink-0 items-center gap-1 px-2 text-[11px] font-medium disabled:opacity-50"
          >
            {launching ? (
              <Icon name="sync" size={11} className="animate-spin" />
            ) : (
              <Icon name="launch" size={11} />
            )}
            {windowOpen ? "Reload" : "Launch"}
          </button>
        </form>

        {windowOpen && (
          <button
            type="button"
            onClick={close}
            title="Close preview window and stop server"
            className="rt-btn flex h-6 w-6 shrink-0 items-center justify-center"
          >
            <Icon name="close" size={12} aria-label="Close preview" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 flex flex-col gap-4">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              windowOpen ? "bg-emerald-400" : "rt-text-faint bg-current opacity-30"
            }`}
          />
          <span className="rt-text-muted text-xs">
            {windowOpen ? "Preview window open" : "No preview window"}
          </span>
        </div>

        {/* Detected ports quick-select */}
        {detectedPorts.length > 0 && (
          <div>
            <p className="rt-text-faint mb-1.5 text-[11px] font-medium uppercase tracking-wide">
              Detected servers
            </p>
            <div className="flex flex-col gap-1">
              {detectedPorts.map(({ port, process: proc }) => (
                <button
                  key={port}
                  type="button"
                  onClick={() => selectPort(port)}
                  className="rt-row flex items-center gap-2 rounded px-2 py-1.5 text-left"
                >
                  <Icon name="server" size={12} className="rt-row-icon shrink-0" />
                  <span className="rt-text-muted font-mono text-[11px]">
                    :{port}
                  </span>
                  {proc && (
                    <span className="rt-text-faint truncate text-[11px]">{proc}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {!detecting && detectedPorts.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <Icon name="preview" size={22} className="rt-text-faint" />
            <p className="rt-text-muted text-xs leading-relaxed">
              No servers detected.
              <br />
              Start a dev server and enter its URL above.
            </p>
          </div>
        )}

        {/* HMR note */}
        {windowOpen && (
          <p className="rt-text-faint mt-auto text-[10px] leading-relaxed">
            Hot reloading (HMR) works natively — the preview window connects
            directly to the dev server WebSocket.
          </p>
        )}
      </div>
    </div>
  );
});

export default LivePreviewPanel;
