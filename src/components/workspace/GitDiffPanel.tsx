import { memo, useCallback, useEffect, useRef, useState } from "react";

import Icon from "../Icon";
import { loadGitDiff, type GitDiffFile } from "../../lib/gitDiff";

/** How often to re-run git so an agent's edits show up live. */
const POLL_MS = 2000;

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
  const inFlight = useRef(false);

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
                <button
                  type="button"
                  onClick={() => toggle(file.path)}
                  className="rt-row flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
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
                  {file.binary ? (
                    <span className="rt-text-faint shrink-0 text-[10px]">binary</span>
                  ) : (
                    <span className="shrink-0 text-[10px]">
                      <span className="text-emerald-600">+{file.added}</span>
                      <span className="rt-text-faint mx-0.5">·</span>
                      <span className="text-red-500">−{file.removed}</span>
                    </span>
                  )}
                </button>

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
