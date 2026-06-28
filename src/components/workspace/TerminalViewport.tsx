import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";

import {
  closePty,
  createPtySession,
  resizePty,
  writeToPty,
  type PtyEvent,
} from "../../lib/pty";
import { terminalBus } from "../../lib/terminalBus";
import { terminalColorFgbg } from "../../lib/theme";
import { resolveTerminalFontStack } from "../../lib/fonts";
import { useAppStore } from "../../store/app";
import { useTheme } from "../../theme/ThemeProvider";
import { useTauriFileDrop } from "../../hooks/useTauriFileDrop";
import Icon from "../Icon";

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
  /**
   * A command line to run automatically once the PTY session connects, sent
   * the same way Iris sends a command: the literal text followed by a carriage
   * return. Runs after any input the user already typed while the session was
   * still connecting (that queue is flushed first), so it behaves like the
   * first thing typed into a fresh shell rather than racing ahead of it.
   */
  initialCommand?: string;
  /**
   * Whether this viewport registers itself as the terminal Iris drives.
   * Defaults to true, matching the original (sole) Terminal panel's behavior.
   * A second concurrent terminal-like panel — e.g. the Claude Code panel,
   * which deliberately runs its own dedicated CLI session — should pass
   * `false` so it doesn't contend with the regular Terminal panel for Iris's
   * single active-terminal slot; commands typed into Iris should always reach
   * the user's actual shell, not whichever panel happened to mount or focus
   * most recently.
   */
  registerWithBus?: boolean;
  /**
   * Whether this viewport's workspace tab is currently in the foreground. When
   * a backgrounded tab is re-activated this flips to true and the terminal
   * re-claims the Iris bus, so commands typed into Iris reach the terminal the
   * user is actually looking at rather than whichever tab connected last.
   */
  active?: boolean;
}

/**
 * Renders a live terminal: creates an xterm instance, binds it to a backend PTY
 * session, streams output in, sends keystrokes out, and keeps the PTY sized to
 * the visible area. The whole lifecycle lives in one effect keyed by `cwd`.
 */
/** Quote a filesystem path for safe shell pasting. */
function shellQuote(p: string): string {
  if (/[\s'"\\$`!#&*?;<>|(){}[\]]/.test(p)) {
    return "'" + p.replace(/'/g, "'\\''") + "'";
  }
  return p;
}

export function TerminalViewport({
  cwd = null,
  className,
  onExit,
  initialCommand,
  registerWithBus = true,
  active = true,
}: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Re-claims the Iris bus for this terminal; populated once the PTY connects.
  const registerBusRef = useRef<(() => void) | null>(null);
  // Keep the latest onExit without re-running the (heavy) PTY effect.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Write function populated once the PTY session is established.
  // Used by the file-drop handler to paste paths without going through the
  // terminalBus (which would target the *active* terminal, not this specific one).
  const ptyWriteRef = useRef<((data: string) => void) | null>(null);

  // Drop zone ref wraps the whole viewport.
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handleFileDrop = useCallback((paths: string[]) => {
    const write = ptyWriteRef.current;
    if (!write || paths.length === 0) return;
    // Paste quoted paths space-separated, no trailing newline so the user
    // sees the paths in the prompt before pressing Enter.
    const pasted = paths.map(shellQuote).join(" ") + " ";
    write(pasted);
    // Focus this terminal so the pasted text is visible.
    termRef.current?.focus();
  }, []);

  const { isDragOver } = useTauriFileDrop(dropZoneRef, handleFileDrop);
  // Same pattern as onExit: the effect below only runs once per `cwd`, so a
  // ref keeps it reading the current initialCommand without needing it in the
  // dependency array (which would otherwise tear down and respawn the shell
  // every time the prop identity changed, even though it's only meant to fire
  // once at session start).
  const initialCommandRef = useRef(initialCommand);
  initialCommandRef.current = initialCommand;

  // The terminal canvas is painted from a JS color table (not CSS), so it must
  // react to theme changes itself. A ref mirrors the latest engine palette so
  // the PTY effect can seed the initial theme without depending on it (which
  // would otherwise tear down and respawn the shell on every theme switch).
  const { terminalTheme } = useTheme();
  const termRef = useRef<Terminal | null>(null);
  const terminalThemeRef = useRef(terminalTheme);
  terminalThemeRef.current = terminalTheme;

  // Terminal typeface — like the theme, xterm paints from a JS font setting
  // rather than CSS, so it can't inherit the UI font token and needs its own
  // preference. Refs mirror the latest values so the PTY effect can seed the
  // initial Terminal without depending on them (which would respawn the shell
  // on every font tweak); a separate effect applies live changes + refits.
  const terminalFontId   = useAppStore((s) => s.terminalFontId);
  const terminalFontSize = useAppStore((s) => s.terminalFontSize);
  const customFonts      = useAppStore((s) => s.customFonts);
  const terminalFontFamily = useMemo(
    () => resolveTerminalFontStack(terminalFontId, customFonts),
    [terminalFontId, customFonts],
  );
  const fontFamilyRef = useRef(terminalFontFamily);
  fontFamilyRef.current = terminalFontFamily;
  const fontSizeRef = useRef(terminalFontSize);
  fontSizeRef.current = terminalFontSize;
  // Cursor blink is an accessibility preference (a blinking cursor can be a
  // distraction / photosensitivity concern). Same ref-seed pattern.
  const terminalCursorBlink = useAppStore((s) => s.terminalCursorBlink);
  const cursorBlinkRef = useRef(terminalCursorBlink);
  cursorBlinkRef.current = terminalCursorBlink;
  // Populated inside the PTY effect: refits the terminal to its container and
  // resyncs the PTY dimensions. Lets the font effect trigger a proper refit
  // without owning the FitAddon instance (which lives in that effect).
  const refitRef = useRef<(() => void) | null>(null);

  // Scrollback search — the addon is created inside the PTY effect; these
  // refs/state let the search UI (rendered outside that effect) drive it.
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState({ index: -1, count: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let sessionId: string | null = null;
    const pendingInput: string[] = [];

    const term = new Terminal({
      fontFamily: fontFamilyRef.current,
      fontSize: fontSizeRef.current,
      cursorBlink: cursorBlinkRef.current,
      theme: terminalThemeRef.current,
    });
    termRef.current = term;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Scrollback search + clickable links. Links open in the OS default
    // browser via the Tauri opener plugin rather than xterm's default
    // window.open (which a Tauri webview blocks).
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;
    const resultsSub = searchAddon.onDidChangeResults((r) => {
      if (!disposed) setSearchResults({ index: r.resultIndex, count: r.resultCount });
    });
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void openUrl(uri);
      }),
    );

    // Cmd/Ctrl+F opens the search bar instead of reaching the shell. Exclude
    // Shift so Cmd/Ctrl+Shift+F falls through to the global content-search
    // overlay rather than opening both at once.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "f") {
        setSearchOpen(true);
        return false;
      }
      return true;
    });

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

    createPtySession(
      {
        cwd,
        cols: term.cols,
        rows: term.rows,
        // Seed the shell's COLORFGBG from the theme active at spawn time so
        // tools like Claude Code emit colours legible on a light background.
        colorFgbg: terminalColorFgbg(terminalThemeRef.current.background),
      },
      handleEvent,
    )
      .then((id) => {
        if (disposed) {
          void closePty(id); // unmounted before connect
          return;
        }
        sessionId = id;
        for (const input of pendingInput) void writeToPty(id, input);
        pendingInput.length = 0;
        term.focus();
        // Fire once per session, after any buffered keystrokes — same shape as
        // Iris's own terminalBus.run, just sent directly since this viewport
        // owns the session itself rather than going through the bus.
        const command = initialCommandRef.current;
        if (command) void writeToPty(id, `${command}\r`);
        // Populate the drop-handler write ref for this specific PTY.
        ptyWriteRef.current = (data) => void writeToPty(id, data);

        if (registerWithBus) {
          // Expose this session to Iris so it can run commands here. Registered
          // through the module-level bus (not React state) so the command bar
          // never re-renders this memoized panel. Stored in a ref too so a tab
          // re-activation can re-claim the bus (see the `active` effect below).
          const register = () =>
            terminalBus.set({
              sessionId: id,
              run: (cmd) => void writeToPty(id, `${cmd}\r`),
              write: (data) => void writeToPty(id, data),
              focus: () => term.focus(),
            });
          registerBusRef.current = register;
          register();
        }
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
    refitRef.current = handleResize;

    return () => {
      disposed = true;
      ptyWriteRef.current = null;
      registerBusRef.current = null;
      refitRef.current = null;
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      resultsSub.dispose();
      searchAddonRef.current = null;
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

  // Restyle the live terminal when the font family or size changes, without
  // recreating it. Cell metrics shift, so refit + resync the PTY afterwards.
  // Web fonts may still be loading, so refit again once they're ready to settle
  // glyph widths to real metrics rather than the fallback's.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = terminalFontFamily;
    term.options.fontSize = terminalFontSize;
    refitRef.current?.();
    void document.fonts.ready.then(() => refitRef.current?.());
  }, [terminalFontFamily, terminalFontSize]);

  // Toggle the live cursor blink (no refit needed — metrics are unchanged).
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.cursorBlink = terminalCursorBlink;
  }, [terminalCursorBlink]);

  // When this terminal's tab moves to the foreground, re-claim the Iris bus so
  // Iris drives the terminal the user is now looking at. No-op until the PTY
  // has connected (registerBusRef populated) and only when bus-registered.
  useEffect(() => {
    if (active) registerBusRef.current?.();
  }, [active]);

  // Focus the search field whenever the bar opens.
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Incremental search as the user types: re-run from the current position so
  // matches don't jump around. Clearing the query drops the highlight.
  useEffect(() => {
    if (!searchOpen) return;
    if (searchQuery) {
      searchAddonRef.current?.findNext(searchQuery, { incremental: true });
    } else {
      termRef.current?.clearSelection();
      setSearchResults({ index: -1, count: 0 });
    }
  }, [searchQuery, searchOpen]);

  const findNext = useCallback(() => {
    if (searchQuery) searchAddonRef.current?.findNext(searchQuery);
  }, [searchQuery]);

  const findPrevious = useCallback(() => {
    if (searchQuery) searchAddonRef.current?.findPrevious(searchQuery);
  }, [searchQuery]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    termRef.current?.clearSelection();
    termRef.current?.focus();
  }, []);

  return (
    <div ref={dropZoneRef} className={`relative ${className ?? ""}`}>
      {/* xterm canvas fills the wrapper */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Scrollback search bar (Cmd/Ctrl+F) */}
      {searchOpen && (
        <div
          className="rt-panel absolute right-2 top-2 z-20 flex items-center gap-1 rounded px-1.5 py-1 shadow"
          style={{ background: "var(--rt-surface)" }}
        >
          <Icon name="search" size={13} className="opacity-60" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) findPrevious();
                else findNext();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              }
            }}
            placeholder="Find"
            spellCheck={false}
            className="w-32 bg-transparent text-xs outline-none"
            style={{ color: "var(--rt-text)" }}
          />
          <span className="min-w-[3rem] text-center text-[11px] tabular-nums opacity-60">
            {searchResults.count > 0 ? `${searchResults.index + 1}/${searchResults.count}` : searchQuery ? "0/0" : ""}
          </span>
          <button
            type="button"
            onClick={findPrevious}
            title="Previous match (Shift+Enter)"
            className="rt-btn flex h-5 w-5 items-center justify-center rounded"
          >
            <Icon name="chevronDown" size={13} className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={findNext}
            title="Next match (Enter)"
            className="rt-btn flex h-5 w-5 items-center justify-center rounded"
          >
            <Icon name="chevronDown" size={13} />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            title="Close (Esc)"
            className="rt-btn flex h-5 w-5 items-center justify-center rounded"
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
      {/* Drop overlay — shown for both files and folders */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded"
          style={{ background: "var(--rt-accent-soft)", border: "2px dashed var(--rt-accent)" }}>
          <Icon name="folderOpen" size={22} className="rt-accent-text" />
          <p className="rt-accent-text text-xs font-medium">Drop to paste path</p>
        </div>
      )}
    </div>
  );
}

export default TerminalViewport;
