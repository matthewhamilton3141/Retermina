import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import {
  closePty,
  createPtySession,
  resizePty,
  writeToPty,
  type PtyEvent,
} from "../../lib/pty";
import { terminalBus } from "../../lib/terminalBus";
import { useTheme } from "../../theme/ThemeProvider";

/** Decode a base64 chunk into bytes for xterm (which reassembles UTF-8). */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface TerminalViewportProps {
  /** Working directory for the shell (null = home / default). */
  cwd?: string | null;
  className?: string;
  /** Called when the shell process exits. */
  onExit?: () => void;
}

/**
 * Renders a live terminal: creates an xterm instance, binds it to a backend PTY
 * session, streams output in, sends keystrokes out, and keeps the PTY sized to
 * the visible area. The whole lifecycle lives in one effect keyed by `cwd`.
 */
export function TerminalViewport({
  cwd = null,
  className,
  onExit,
}: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Keep the latest onExit without re-running the (heavy) PTY effect.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // The terminal canvas is painted from a JS color table (not CSS), so it must
  // react to theme changes itself. A ref mirrors the latest engine palette so
  // the PTY effect can seed the initial theme without depending on it (which
  // would otherwise tear down and respawn the shell on every theme switch).
  const { terminalTheme } = useTheme();
  const termRef = useRef<Terminal | null>(null);
  const terminalThemeRef = useRef(terminalTheme);
  terminalThemeRef.current = terminalTheme;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let sessionId: string | null = null;
    const pendingInput: string[] = [];

    const term = new Terminal({
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: terminalThemeRef.current,
    });
    termRef.current = term;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    safeFit();

    function safeFit() {
      try {
        fitAddon.fit();
      } catch {
        // Container not measurable yet (e.g. detached); ignore.
      }
    }

    const dataSub = term.onData((data) => {
      if (sessionId) {
        void writeToPty(sessionId, data);
      } else {
        pendingInput.push(data); // buffer until the session connects
      }
    });

    const handleEvent = (event: PtyEvent) => {
      if (disposed) return;
      if (event.type === "data") {
        term.write(base64ToBytes(event.chunk));
      } else {
        term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
        onExitRef.current?.();
      }
    };

    createPtySession({ cwd, cols: term.cols, rows: term.rows }, handleEvent)
      .then((id) => {
        if (disposed) {
          void closePty(id); // unmounted before connect
          return;
        }
        sessionId = id;
        for (const input of pendingInput) void writeToPty(id, input);
        pendingInput.length = 0;
        term.focus();
        // Expose this session to Iris so it can run commands here. Registered
        // through the module-level bus (not React state) so the command bar
        // never re-renders this memoized panel.
        terminalBus.set({
          sessionId: id,
          run: (command) => void writeToPty(id, `${command}\r`),
          write: (data) => void writeToPty(id, data),
          focus: () => term.focus(),
        });
      })
      .catch((error) => {
        term.write(
          `\r\n\x1b[31mFailed to start shell: ${String(error)}\x1b[0m\r\n`,
        );
      });

    // Track the last size sent to the PTY so a continuous grid resize doesn't
    // spam the backend: a panel resizes by many pixels but cols/rows only change
    // at character boundaries.
    let lastCols = term.cols;
    let lastRows = term.rows;
    const handleResize = () => {
      safeFit();
      if (sessionId && (term.cols !== lastCols || term.rows !== lastRows)) {
        lastCols = term.cols;
        lastRows = term.rows;
        void resizePty(sessionId, term.cols, term.rows);
      }
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      dataSub.dispose();
      if (sessionId) {
        terminalBus.clear(sessionId);
        void closePty(sessionId);
      }
      term.dispose();
      termRef.current = null;
    };
  }, [cwd]);

  // Recolor the live terminal when the engine changes, without recreating it.
  // xterm only applies a theme when handed a fresh object, hence the spread.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = { ...terminalTheme };
    }
  }, [terminalTheme]);

  return <div ref={containerRef} className={className} />;
}

export default TerminalViewport;
