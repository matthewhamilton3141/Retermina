/**
 * Cmd+P quick-open — fuzzy file search across the active workspace.
 *
 * On open it pulls a (capped) recursive file index from the Rust `list_files`
 * command, fuzzy-filters as you type, and opens the chosen file in the Code
 * panel (revealing the panel if it's hidden). Mirrors the Command Palette's
 * full-screen overlay + keyboard navigation.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import Icon from "./Icon";
import { listFiles } from "../lib/fs";
import { useEditorStore } from "../store/editor";
import { useWorkspaceStore } from "../store/workspace";
import { PANEL_IDS } from "../lib/workspaceLayout";

const MAX_RESULTS = 50;

/** Score a query against a relative path, favouring basename matches. */
function scorePath(query: string, path: string): number {
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const base = p.slice(p.lastIndexOf("/") + 1);

  if (base === q)         return 1000;
  if (base.startsWith(q)) return 600;
  if (base.includes(q))   return 350;
  if (p.includes(q))      return 180;

  // Subsequence over the full path (e.g. "scmp" → "src/components/...").
  let qi = 0;
  for (let i = 0; i < p.length && qi < q.length; i++) {
    if (p[i] === q[qi]) qi++;
  }
  return qi === q.length ? 60 : 0;
}

export interface FileSearchProps {
  open: boolean;
  onClose: () => void;
  /** Workspace root; null when no folder is open (search is unavailable). */
  cwd: string | null;
}

export function FileSearch({ open, onClose, cwd }: FileSearchProps) {
  const [query, setQuery]       = useState("");
  const [activeIdx, setActive]  = useState(0);
  const [files, setFiles]       = useState<string[]>([]);
  const [loading, setLoading]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const openFile    = useEditorStore((s) => s.openFile);
  const panels      = useWorkspaceStore((s) => s.panels);
  const togglePanel = useWorkspaceStore((s) => s.togglePanel);

  // Load (and cache) the file index whenever the palette opens.
  useEffect(() => {
    if (!open || !cwd) return;
    setQuery("");
    setActive(0);
    setLoading(true);
    let cancelled = false;
    listFiles(cwd)
      .then((list) => { if (!cancelled) setFiles(list); })
      .catch(() => { if (!cancelled) setFiles([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => { cancelled = true; };
  }, [open, cwd]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return files.slice(0, MAX_RESULTS);
    return files
      .map((path) => ({ path, s: scorePath(q, path) }))
      .filter((e) => e.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_RESULTS)
      .map((e) => e.path);
  }, [files, query]);

  useEffect(() => { setActive(0); }, [query]);

  const choose = (rel: string) => {
    if (!cwd) return;
    const abs = `${cwd.replace(/\/$/, "")}/${rel}`;
    // Reveal the Code panel if it's currently hidden.
    if (!panels.some((p) => p.id === PANEL_IDS.codeView)) togglePanel("codeView");
    void openFile(abs);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
      if (e.key === "Enter")     { e.preventDefault(); const r = results[activeIdx]; if (r) choose(r); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, activeIdx, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rt-menu flex w-full max-w-xl flex-col overflow-hidden rounded-2xl shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-[var(--rt-border)] px-4 py-3">
          <Icon name="search" size={16} className="rt-text-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={cwd ? "Search files by name…" : "Open a folder to search files"}
            disabled={!cwd}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--rt-text-faint)]"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="rt-text-faint shrink-0 text-[10px]">Esc to close</span>
        </div>

        <div className="max-h-[min(420px,60vh)] overflow-y-auto p-1">
          {!cwd ? (
            <p className="rt-text-muted py-6 text-center text-sm">No workspace folder open.</p>
          ) : loading ? (
            <p className="rt-text-faint py-6 text-center text-sm">Indexing files…</p>
          ) : results.length === 0 ? (
            <p className="rt-text-muted py-6 text-center text-sm">No matching files</p>
          ) : (
            results.map((path, idx) => {
              const active = idx === activeIdx;
              const slash  = path.lastIndexOf("/");
              const dir    = slash >= 0 ? path.slice(0, slash + 1) : "";
              const base   = slash >= 0 ? path.slice(slash + 1) : path;
              return (
                <button
                  key={path}
                  type="button"
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => choose(path)}
                  className={`rt-menu-item flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                    active ? "bg-[var(--rt-surface-hover)]" : ""
                  }`}
                >
                  <Icon name="file" size={14} className="rt-text-faint shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {dir && <span className="rt-text-faint">{dir}</span>}
                    <span className="font-medium">{base}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default FileSearch;
