import { useMemo } from "react";

import { collapseDiff, computeLineDiff } from "../../lib/diff";
import type { ClaudeToolDiff } from "../../lib/claudeTranscript";

export function ClaudeDiffBlock({ change }: { change: ClaudeToolDiff }) {
  const diff = useMemo(
    () => computeLineDiff(change.oldText, change.newText),
    [change.oldText, change.newText],
  );
  const visible = useMemo(() => collapseDiff(diff, 3), [diff]);
  const added = diff.filter((line) => line.type === "added").length;
  const removed = diff.filter((line) => line.type === "removed").length;

  return (
    <div className="border-t border-[var(--rt-border)]">
      <div className="flex items-center gap-2 px-2.5 py-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[0.78em]" title={change.path}>
          {change.path}
        </span>
        <span className="shrink-0 font-mono text-[0.72em]">
          <span className="text-emerald-600">+{added}</span>
          <span className="rt-text-faint mx-1">/</span>
          <span className="text-red-500">−{removed}</span>
        </span>
      </div>
      <div className="max-h-64 overflow-auto font-mono text-[0.78em] leading-5">
        {visible.map((line, index) => {
          if (line.text === "…") {
            return (
              <div key={index} className="rt-text-faint select-none py-px text-center text-[0.7em]">
                ···
              </div>
            );
          }
          const addedLine = line.type === "added";
          const removedLine = line.type === "removed";
          const background = addedLine
            ? "bg-emerald-500/10"
            : removedLine
              ? "bg-red-500/10"
              : "";
          const color = addedLine
            ? "text-emerald-800 dark:text-emerald-300"
            : removedLine
              ? "text-red-800 dark:text-red-300"
              : "";
          const marker = addedLine ? "+" : removedLine ? "−" : " ";
          const number = addedLine ? line.newNum : line.oldNum;
          return (
            <div key={index} className={`flex min-w-max items-start whitespace-pre ${background}`}>
              <span className="rt-text-faint w-9 shrink-0 select-none pr-2 text-right text-[0.72em]">
                {number ?? ""}
              </span>
              <span
                className={`w-4 shrink-0 select-none text-center font-bold ${
                  addedLine ? "text-emerald-600" : removedLine ? "text-red-500" : "rt-text-faint"
                }`}
              >
                {marker}
              </span>
              <span className={color}>{line.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ClaudeDiffBlock;
