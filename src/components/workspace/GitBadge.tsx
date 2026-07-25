import { useEffect, useState } from "react";

import Icon from "../Icon";
import { DEFAULT_GIT_STATUS, gitStatus, type GitStatus } from "../../lib/system";

/**
 * Compact working-tree indicator for the workspace header: the branch the
 * active tab is on plus the short HEAD commit, with a subtle dot when the tree
 * has uncommitted changes. Renders nothing outside a Git repo.
 *
 * The status is re-read on a slow poll and whenever the window regains focus, so
 * a commit or branch switch made in the terminal (or elsewhere) is reflected
 * without the user doing anything.
 */
export function GitBadge({ cwd }: { cwd: string | null }) {
  const [status, setStatus] = useState<GitStatus>(DEFAULT_GIT_STATUS);

  useEffect(() => {
    if (!cwd) {
      setStatus(DEFAULT_GIT_STATUS);
      return;
    }
    let disposed = false;
    const load = () => {
      void gitStatus(cwd).then((next) => {
        if (!disposed) setStatus(next);
      });
    };
    load();
    const interval = window.setInterval(load, 8_000);
    // Coming back to the app is the moment the tree most likely changed.
    window.addEventListener("focus", load);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", load);
    };
  }, [cwd]);

  if (!status.isRepo || !status.branch) return null;

  const dirty = !status.clean;
  const ahead = status.ahead > 0 ? `↑${status.ahead}` : "";
  const behind = status.behind > 0 ? `↓${status.behind}` : "";
  const divergence = [ahead, behind].filter(Boolean).join(" ");

  return (
    <>
      <div className="rt-divider mx-1 h-4 w-px shrink-0" />
      <div
        className="rt-text-muted flex min-w-0 shrink items-center gap-1.5 text-xs"
        title={`On branch ${status.branch}${status.commit ? ` at ${status.commit}` : ""}${
          dirty ? " · uncommitted changes" : " · clean"
        }`}
      >
        <Icon name="gitClone" size={13} className="shrink-0 opacity-70" />
        <span className="min-w-0 truncate font-medium">{status.branch}</span>
        {dirty && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
            aria-label="uncommitted changes"
          />
        )}
        {status.commit && (
          <span className="rt-text-faint shrink-0 font-mono tabular-nums">
            {status.commit}
          </span>
        )}
        {divergence && (
          <span className="rt-text-faint shrink-0 tabular-nums">{divergence}</span>
        )}
      </div>
    </>
  );
}

export default GitBadge;
