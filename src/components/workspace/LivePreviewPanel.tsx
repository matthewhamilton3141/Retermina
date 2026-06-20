import { memo, useEffect, useRef, useState } from "react";

import Icon from "../Icon";
import { listListeningPorts } from "../../lib/system";

/**
 * Live Preview panel: renders an iframe pointed at a local dev server so the
 * user can see hot-reload output without leaving the workspace.
 *
 * URL auto-detection: on mount, the panel scans listening ports and pre-fills
 * the address bar with the first one found (typically Vite's :5173 or CRA's
 * :3000). The user can edit the URL and navigate freely. HMR from Vite /
 * webpack-dev-server works transparently through the iframe.
 */
export const LivePreviewPanel = memo(function LivePreviewPanel() {
  const [url, setUrl] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [detecting, setDetecting] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Auto-detect the first listening localhost port on mount.
  useEffect(() => {
    listListeningPorts()
      .then((ports) => {
        const first = ports[0];
        const detected = first ? `http://localhost:${first.port}` : "http://localhost:3000";
        setUrl(detected);
        setInputValue(detected);
      })
      .finally(() => setDetecting(false));
  }, []);

  const navigate = () => {
    const target = inputValue.trim();
    if (!target) return;
    const withScheme = target.startsWith("http") ? target : `http://${target}`;
    setUrl(withScheme);
    setInputValue(withScheme);
  };

  const reload = () => {
    if (iframeRef.current) {
      // Reassigning src triggers a reload without changing the URL bar.
      iframeRef.current.src = url;
    }
  };

  return (
    <div className="rt-subsurface flex h-full w-full flex-col">
      {/* Address bar */}
      <div className="rt-divider-b flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        <Icon name="preview" size={13} className="rt-accent-text shrink-0" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate();
          }}
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
            title="Navigate"
            className="rt-btn-outline flex h-6 w-6 shrink-0 items-center justify-center"
          >
            <Icon name="launch" size={11} aria-label="Go" />
          </button>
        </form>
        <button
          type="button"
          onClick={reload}
          title="Reload preview"
          className="rt-btn flex h-6 w-6 shrink-0 items-center justify-center"
        >
          <Icon name="sync" size={13} aria-label="Reload" />
        </button>
      </div>

      {/* Iframe */}
      <div className="min-h-0 flex-1 bg-white">
        {url ? (
          <iframe
            ref={iframeRef}
            src={url}
            title="Live Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-4 text-center">
            <div className="space-y-2">
              <Icon name="preview" size={24} className="rt-text-faint mx-auto" />
              <p className="rt-text-muted text-xs leading-relaxed">
                Enter a URL above or start a dev server and click Detect.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default LivePreviewPanel;
