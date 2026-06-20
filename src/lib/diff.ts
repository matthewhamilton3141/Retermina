/**
 * Line-level diff using Myers / LCS backtracking.
 * No external dependencies — runs entirely in the browser.
 */

export type DiffLineType = "unchanged" | "added" | "removed";

export interface DiffLine {
  type: DiffLineType;
  /** 1-based line number in the new file (undefined for removed lines). */
  newNum?: number;
  /** 1-based line number in the old file (undefined for added lines). */
  oldNum?: number;
  text: string;
}

/**
 * Compute a line-level diff between two text blobs.
 * Returns a flat list of DiffLine entries in document order, mixing
 * unchanged, added, and removed lines — the same format git diff uses.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to reconstruct the diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: "unchanged", oldNum: i, newNum: j, text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", newNum: j, text: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", oldNum: i, text: a[i - 1] });
      i--;
    }
  }

  return result;
}

/** True when there are any added or removed lines in the diff. */
export function hasChanges(diff: DiffLine[]): boolean {
  return diff.some((l) => l.type !== "unchanged");
}

/** Collapse long unchanged runs, keeping `ctx` lines around each hunk. */
export function collapseDiff(diff: DiffLine[], ctx = 3): DiffLine[] {
  const changed = new Set<number>();
  diff.forEach((line, idx) => {
    if (line.type !== "unchanged") {
      for (let k = Math.max(0, idx - ctx); k <= Math.min(diff.length - 1, idx + ctx); k++) {
        changed.add(k);
      }
    }
  });

  const result: DiffLine[] = [];
  let lastIncluded = -1;
  diff.forEach((line, idx) => {
    if (changed.has(idx)) {
      if (lastIncluded >= 0 && idx > lastIncluded + 1) {
        result.push({ type: "unchanged", text: "…" });
      }
      result.push(line);
      lastIncluded = idx;
    }
  });

  return result;
}
