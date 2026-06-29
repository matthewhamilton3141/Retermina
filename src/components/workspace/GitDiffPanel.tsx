import { memo, useCallback, useEffect, useRef, useState } from "react";

import Icon from "../Icon";
import { loadGitDiff, type GitDiffFile } from "../../lib/gitDiff";
import { runBackgroundCommand } from "../../lib/system";

/** How often to re-run git so an agent's edits show up live. */
const POLL_MS = 2000;

/** Single-quote a value for safe shell interpolation. */
const shq = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

const STATUS_LABEL: Record<GitDiffFile["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

/**
 * "Changes" panel — a live, project-wide git diff of the workspace working
 * tree vs the last commit. Reflects edits from anywhere, including Claude Code
 * running in the terminal, because it just polls `git`.
 */
export const GitDiffPanel = memo(function GitDiffPanel({ cwd }: { cwd: string | null }) {
  const [files, setFiles] = useState<GitDiffFile[]>([]);
  const [isRepo, setIsRepo] = useState(true);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const lastLine = (r: { stdout: string; stderr: string }) =>
    (r.stderr || r.stdout || "Command failed").trim().split("\n").filter(Boolean).slice(-1)[0] || "Command failed";

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await loadGitDiff(cwd);
      setIsRepo(res.isRepo);
      setFiles(res.files);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setLoading(true);
    let active = true;
    void refresh();
    const id = window.setInterval(() => {
      if (active) void refresh();
    }, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [refresh]);

  const commit = useCallback(async () => {
    const msg = message.trim();
    if (!cwd || !msg || busy) return;
    setBusy(true);
    setActionError(null);
    const res = await runBackgroundCommand(`git add -A && git commit -m ${shq(msg)}`, cwd);
    setBusy(false);
    if (res.code === 0) { setMessage(""); void refresh(); }
    else setActionError(lastLine(res));
  }, [cwd, message, busy, refresh]);

  const discard = useCallback(async (file: GitDiffFile) => {
    if (!cwd || busy) return;
    if (!window.confirm(`Discard changes to "${file.path}"? This can't be undone.`)) return;
    setBusy(true);
    setActionError(null);
    const cmd = file.status === "untracked"
      ? `git clean -fd -- ${shq(file.path)}`
      : `git checkout -- ${shq(file.path)}`;
    const res = await runBackgroundCommand(cmd, cwd);
    setBusy(false);
    if (res.code === 0) void refresh();
    else setActionError(lastLine(res));
  }, [cwd, busy, refresh]);

  const toggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const totalAdded = files.reduce((n, f) => n + f.added, 0);
  const totalRemoved = files.reduce((n, f) => n + f.removed, 0);

  return (
    <div className="rt-subsurface flex h-full w-full flex-col">
      {/* Header */}
      <div className="rt-divider-b flex items-center gap-2 px-2.5 py-1.5">
        <Icon name="gitDiff" size={13} className="rt-accent-text shrink-0" />
        <span className="text-xs font-medium">Changes</span>
        {files.length > 0 && (
          <span className="text-[11px]">
            <span className="text-emerald-600 font-medium">+{totalAdded}</span>
            <span className="rt-text-faint mx-1">·</span>
            <span className="text-red-500 font-medium">−{totalRemoved}</span>
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void refresh()}
          title="Rescan changes"
          className="rt-btn flex h-6 w-6 items-center justify-center"
        >
          <Icon name="sync" size={13} className={loading ? "animate-spin" : undefined} aria-label="Rescan" />
        </button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {!isRepo ? (
          <Empty icon="gitDiff" text="Not a git repository. Initialize one to track changes here." />
        ) : files.length === 0 ? (
          <Empty icon="gitDiff" text={loading ? "Scanning…" : "Working tree clean — no changes."} />
        ) : (
          files.map((file) => {
            const isCollapsed = collapsed.has(file.path);
            return (
              <div key={file.path} className="rt-divider-b">
                {/* File header */}
                <div className="rt-row group/file flex w-full items-center gap-2 px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => toggle(file.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Icon
                      name={isCollapsed ? "chevronRight" : "chevronDown"}
                      size={12}
                      className="rt-text-faint shrink-0"
                    />
                    <span
                      className={`shrink-0 font-mono text-[10px] font-bold ${
                        file.status === "deleted" ? "text-red-500" : "text-emerald-600"
                      }`}
                      title={file.status}
                    >
                      {STATUS_LABEL[file.status]}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={file.path}>
                      {file.path}
                    </span>
                  </button>
                  {file.binary ? (
                    <span className="rt-text-faint shrink-0 text-[10px]">binary</span>
                  ) : (
                    <span className="shrink-0 text-[10px]">
                      <span className="text-emerald-600">+{file.added}</span>
                      <span className="rt-text-faint mx-0.5">·</span>
                      <span className="text-red-500">−{file.removed}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void discard(file)}
                    disabled={busy}
                    title="Discard changes to this file"
                    className="rt-btn rt-btn-danger flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover/file:opacity-100 disabled:opacity-30"
                  >
                    <Icon name="sync" size={11} className="rotate-90" aria-label="Discard file changes" />
                  </button>
                </div>

                {/* Diff body */}
                {!isCollapsed && !file.binary && (
                  <div className="overflow-x-auto font-mono text-[12px] leading-5">
                    {file.lines.map((line, idx) => {
                      if (line.kind === "hunk") {
                        return (
                          <div
                            key={idx}
                            className="rt-text-faint select-none whitespace-pre bg-[var(--rt-surface-hover)] px-3 py-px text-[11px]"
                          >
                            {line.text}
                          </div>
                        );
                      }
                      const isAdd = line.kind === "add";
                      const isDel = line.kind === "del";
                      const rowBg = isAdd ? "bg-emerald-500/10" : isDel ? "bg-red-500/10" : "";
                      const textCls = isAdd
                        ? "text-emerald-800 dark:text-emerald-300"
                        : isDel
                        ? "text-red-800 dark:text-red-300"
                        : "";
                      const sigil = isAdd ? "+" : isDel ? "−" : " ";
                      return (
                        <div key={idx} className={`flex items-start whitespace-pre ${rowBg}`}>
                          <span
                            className={`w-4 shrink-0 select-none text-center font-bold leading-5 ${
                              isAdd ? "text-emerald-600" : isDel ? "text-red-500" : "rt-text-faint"
                            }`}
                          >
                            {sigil}
                          </span>
                          <span className={textCls}>{line.text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Commit composer */}
      {isRepo && (
        <div className="shrink-0 border-t border-[var(--rt-border)] p-2">
          {actionError && <p className="mb-1 text-[11px] text-red-500">{actionError}</p>}
          <div className="flex items-center gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void commit(); } }}
              placeholder="Commit message…"
              spellCheck={false}
              className="rt-input min-w-0 flex-1 px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={() => void commit()}
              disabled={busy || !message.trim() || files.length === 0}
              title="Stage all changes and commit"
              className="rt-btn-outline rt-btn-active flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-xs font-medium disabled:opacity-40"
            >
              {busy ? <Icon name="sync" size={12} className="animate-spin" /> : <Icon name="apply" size={12} />}
              Commit all
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

function Empty({ icon, text }: { icon: "gitDiff"; text: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
      <Icon name={icon} size={20} className="rt-text-faint" />
      <p className="rt-text-muted text-xs leading-relaxed">{text}</p>
    </div>
  );
}

export default GitDiffPanel;
