/**
 * Cmd/Ctrl+Shift+F project content search.
 *
 * A full-screen overlay (mirroring the Cmd+P quick-open) that searches file
 * *contents* across the active workspace via the Rust `search_in_files`
 * command. Results are grouped by file; choosing a match opens the file in the
 * Code panel scrolled to that line (revealing the panel if it's hidden).
 */
import { useEffect, useMemo, useRef, useState } from "react";

import Icon from "./Icon";
import { searchInFiles, type FileMatches } from "../lib/fs";
import { useEditorStore } from "../store/editor";
import { useWorkspaceStore } from "../store/workspace";
import { PANEL_IDS } from "../lib/workspaceLayout";

/** Debounce (ms) before firing a search as the user types. */
const SEARCH_DEBOUNCE = 250;

export interface ContentSearchProps {
  open: boolean;
  onClose: () => void;
  /** Workspace root; null when no folder is open (search is unavailable). */
  cwd: string | null;
}

/** One selectable row in the flat keyboard-navigable list. */
interface FlatMatch {
  path: string;
  line: number;
  text: string;
}

export function ContentSearch({ open, onClose, cwd }: ContentSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileMatches[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const openFile = useEditorStore((s) => s.openFile);
  const panels = useWorkspaceStore((s) => s.panels);
  const togglePanel = useWorkspaceStore((s) => s.togglePanel);

  // Reset and focus whenever the overlay opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Debounced search as the query changes.
  useEffect(() => {
    if (!open || !cwd) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      searchInFiles(cwd, q)
        .then((r) => { if (!cancelled) { setResults(r); setActive(0); } })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, SEARCH_DEBOUNCE);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query, open, cwd]);

  // Flatten grouped results for linear keyboard navigation.
  const flat = useMemo<FlatMatch[]>(
    () => results.flatMap((f) => f.matches.map((m) => ({ path: f.path, line: m.line, text: m.text }))),
    [results],
  );
  const totalMatches = flat.length;

  const choose = (m: FlatMatch) => {
    if (!cwd) return;
    const abs = `${cwd.replace(/\/$/, "")}/${m.path}`;
    if (!panels.some((p) => p.id === PANEL_IDS.codeView)) togglePanel("codeView");
    void openFile(abs, m.line);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, flat.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
      if (e.key === "Enter")     { e.preventDefault(); const m = flat[activeIdx]; if (m) choose(m); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flat, activeIdx, onClose]);

  if (!open) return null;

  const q = query.trim();
  let flatIdx = -1; // running index so grouped rows map back to the flat list

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rt-menu flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-[var(--rt-border)] px-4 py-3">
          <Icon name="search" size={16} className="rt-text-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={cwd ? "Search in files…" : "Open a folder to search file contents"}
            disabled={!cwd}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--rt-text-faint)]"
            autoComplete="off"
            spellCheck={false}
          />
          {totalMatches > 0 && (
            <span className="rt-text-faint shrink-0 text-[10px] tabular-nums">
              {totalMatches} in {results.length} file{results.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="rt-text-faint shrink-0 text-[10px]">Esc to close</span>
        </div>

        <div className="max-h-[min(460px,62vh)] overflow-y-auto p-1">
          {!cwd ? (
            <p className="rt-text-muted py-6 text-center text-sm">No workspace folder open.</p>
          ) : loading ? (
            <p className="rt-text-faint py-6 text-center text-sm">Searching…</p>
          ) : !q ? (
            <p className="rt-text-faint py-6 text-center text-sm">Type to search across the workspace.</p>
          ) : flat.length === 0 ? (
            <p className="rt-text-muted py-6 text-center text-sm">No matches</p>
          ) : (
            results.map((file) => (
              <div key={file.path} className="mb-1">
                <div className="flex items-center gap-1.5 px-2.5 py-1">
                  <Icon name="file" size={12} className="rt-text-faint shrink-0" />
                  <span className="rt-text-muted min-w-0 truncate text-[11px] font-medium">{file.path}</span>
                  <span className="rt-text-faint shrink-0 text-[10px]">{file.matches.length}</span>
                </div>
                {file.matches.map((m) => {
                  flatIdx += 1;
                  const idx = flatIdx;
                  const active = idx === activeIdx;
                  // Locate the match in the line (case-insensitive) for highlight.
                  const lower = m.text.toLowerCase();
                  const at = lower.indexOf(q.toLowerCase());
                  return (
                    <button
                      key={`${file.path}:${m.line}:${idx}`}
                      type="button"
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => choose({ path: file.path, line: m.line, text: m.text })}
                      className={`rt-menu-item flex w-full items-baseline gap-2 px-3 py-1 text-left ${
                        active ? "bg-[var(--rt-surface-hover)]" : ""
                      }`}
                    >
                      <span className="rt-text-faint shrink-0 text-[10px] tabular-nums" style={{ minWidth: "2.5rem" }}>
                        {m.line}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {at >= 0 ? (
                          <>
                            <span className="rt-text-faint">{m.text.slice(0, at)}</span>
                            <span className="rt-accent-text font-semibold">{m.text.slice(at, at + q.length)}</span>
                            <span className="rt-text-faint">{m.text.slice(at + q.length)}</span>
                          </>
                        ) : (
                          <span className="rt-text-faint">{m.text}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default ContentSearch;
