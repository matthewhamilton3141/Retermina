import { useEffect, useMemo, useRef, useState } from "react";

import Icon, { type IconName } from "../Icon";
import { renderMarkdown } from "../../lib/markdown";
import {
  extractClaudeToolDiffs,
  summarizeClaudeTool,
  summarizeClaudeToolDiffs,
  type ClaudeQuestionActivity,
  type ClaudeRunStatus,
  type ClaudeShellActivity,
  type ClaudeTimelineItem,
  type ClaudeToolActivity,
} from "../../lib/claudeTranscript";
import ClaudeDiffBlock from "./ClaudeDiffBlock";

function toolVerb(tool: ClaudeToolActivity): string {
  const running = tool.status === "running";
  const name = tool.name.toLowerCase();
  if (name.includes("edit")) return running ? "Editing" : "Edited";
  if (name.includes("write")) return running ? "Writing" : "Wrote";
  if (name === "bash") return running ? "Running" : "Ran";
  if (name.includes("read")) return running ? "Reading" : "Read";
  if (name.includes("glob") || name.includes("grep") || name.includes("search")) {
    return running ? "Searching" : "Searched";
  }
  return running ? `Using ${tool.name}` : tool.name;
}

interface ToolVisual {
  icon: IconName;
  text: string;
  dot: string;
  border: string;
  wash: string;
}

function toolVisual(tool: ClaudeToolActivity): ToolVisual {
  const name = tool.name.toLowerCase();
  if (name.includes("edit") || name.includes("write") || name.includes("notebook")) {
    return {
      icon: "code",
      text: "text-violet-500",
      dot: "bg-violet-500",
      border: "border-violet-500/25",
      wash: "bg-violet-500/[0.06]",
    };
  }
  if (name === "bash" || name.includes("command")) {
    return {
      icon: "terminal",
      text: "text-amber-500",
      dot: "bg-amber-500",
      border: "border-amber-500/25",
      wash: "bg-amber-500/[0.06]",
    };
  }
  if (name.includes("read")) {
    return {
      icon: "file",
      text: "text-sky-500",
      dot: "bg-sky-500",
      border: "border-sky-500/25",
      wash: "bg-sky-500/[0.06]",
    };
  }
  if (name.includes("glob") || name.includes("grep") || name.includes("search")) {
    return {
      icon: "search",
      text: "text-cyan-500",
      dot: "bg-cyan-500",
      border: "border-cyan-500/25",
      wash: "bg-cyan-500/[0.06]",
    };
  }
  if (name === "agent" || name.includes("task")) {
    return {
      icon: "bot",
      text: "text-fuchsia-500",
      dot: "bg-fuchsia-500",
      border: "border-fuchsia-500/25",
      wash: "bg-fuchsia-500/[0.06]",
    };
  }
  return {
    icon: "spark",
    text: "rt-accent-text",
    dot: "bg-[var(--rt-accent)]",
    border: "border-[var(--rt-border)]",
    wash: "bg-[var(--rt-accent-soft)]",
  };
}

function ToolRow({ tool }: { tool: ClaudeToolActivity }) {
  const [expanded, setExpanded] = useState(false);
  const open = expanded;
  const summary = summarizeClaudeTool(tool);
  const diffs = extractClaudeToolDiffs(tool);
  const diffSummary = useMemo(() => summarizeClaudeToolDiffs(tool), [tool]);
  const hasDetails = diffs.length > 0 || !!tool.output;
  const visual = toolVisual(tool);
  const failed = tool.status === "error";

  return (
    <div
      className={`rt-claude-item rt-claude-tool-row mx-2.5 my-1 overflow-hidden rounded-lg border ${
        failed ? "border-red-500/30 bg-red-500/[0.06]" : `${visual.border} ${visual.wash}`
      } ${tool.status === "running" ? "rt-claude-tool-running" : ""}`}
    >
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((value) => !value)}
        disabled={!hasDetails}
        aria-expanded={hasDetails ? open : undefined}
        className="group flex w-full items-center gap-2 px-2.5 py-2 text-left transition-[background-color] hover:bg-[var(--rt-surface-hover)]/45 disabled:cursor-default"
      >
        {tool.status === "running" ? (
          <span className={`rt-claude-tool-orbit flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${visual.text}`}>
            <Icon name={visual.icon} size="0.82em" />
          </span>
        ) : (
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${failed ? "text-red-500" : visual.text}`}>
            <Icon name={visual.icon} size="0.82em" />
          </span>
        )}
        <span className={`shrink-0 text-[0.78em] font-semibold ${failed ? "text-red-500" : visual.text}`}>
          {toolVerb(tool)}
        </span>
        {summary && (
          <span className="rt-text-muted min-w-0 flex-1 truncate font-mono text-[0.74em]" title={summary}>
            {summary}
          </span>
        )}
        {!summary && <span className="flex-1" />}
        {diffSummary.files > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[0.7em] font-semibold tabular-nums">
            <span className="text-emerald-500">+{diffSummary.added}</span>
            <span className="text-red-500">−{diffSummary.removed}</span>
          </span>
        )}
        {tool.status !== "running" && (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${failed ? "bg-red-500" : visual.dot}`} />
        )}
        {hasDetails && (
          <Icon
            name={open ? "chevronDown" : "chevronRight"}
            size="0.8em"
            className="rt-text-faint shrink-0"
          />
        )}
      </button>

      {open && hasDetails && (
        <div>
          {diffs.map((change, index) => (
            <ClaudeDiffBlock key={`${change.path}:${index}`} change={change} />
          ))}
          {diffs.length === 0 && tool.output && (
            <pre className="rt-text-muted max-h-56 overflow-auto border-t border-[var(--rt-border)] p-2.5 font-mono text-[0.75em] leading-relaxed whitespace-pre-wrap">
              {tool.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** A `!command` run locally, outside the Claude conversation (see `ClaudeShellActivity`). */
function ShellRow({ item }: { item: ClaudeShellActivity }) {
  const [expanded, setExpanded] = useState(true);
  const failed = item.status === "error" || (item.status === "done" && (item.code ?? 0) !== 0);
  const output = [item.stdout, item.stderr].filter(Boolean).join("\n").trim();
  const hasDetails = item.status !== "running" && !!output;

  return (
    <div
      className={`rt-claude-item mx-2.5 my-1 overflow-hidden rounded-lg border ${
        failed ? "border-red-500/30 bg-red-500/[0.06]" : "border-amber-500/25 bg-amber-500/[0.06]"
      } ${item.status === "running" ? "rt-claude-tool-running" : ""}`}
    >
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((value) => !value)}
        disabled={!hasDetails}
        aria-expanded={hasDetails ? expanded : undefined}
        className="group flex w-full items-center gap-2 px-2.5 py-2 text-left transition-[background-color] hover:bg-[var(--rt-surface-hover)]/45 disabled:cursor-default"
      >
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${failed ? "text-red-500" : "text-amber-500"}`}>
          <Icon name={item.status === "running" ? "sync" : "terminal"} size="0.82em" className={item.status === "running" ? "animate-spin" : ""} />
        </span>
        <span className={`shrink-0 text-[0.78em] font-semibold ${failed ? "text-red-500" : "text-amber-500"}`}>
          {item.status === "running" ? "Running" : "Ran"}
        </span>
        <span className="rt-text-muted min-w-0 flex-1 truncate font-mono text-[0.74em]" title={item.command}>
          {item.command}
        </span>
        {item.status === "done" && item.code !== 0 && (
          <span className="shrink-0 font-mono text-[0.7em] font-semibold text-red-500">exit {item.code}</span>
        )}
        {item.status !== "running" && (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${failed ? "bg-red-500" : "bg-amber-500"}`} />
        )}
        {hasDetails && (
          <Icon name={expanded ? "chevronDown" : "chevronRight"} size="0.8em" className="rt-text-faint shrink-0" />
        )}
      </button>

      {expanded && hasDetails && (
        <pre className="rt-text-muted max-h-56 overflow-auto border-t border-[var(--rt-border)] p-2.5 font-mono text-[0.75em] leading-relaxed whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  );
}

function QuestionCard({
  item,
  onAnswer,
  onCustomAnswer,
}: {
  item: ClaudeQuestionActivity;
  onAnswer?: (question: ClaudeQuestionActivity, answers: number[][]) => boolean;
  onCustomAnswer?: (question: ClaudeQuestionActivity, text: string) => boolean;
}) {
  const [selections, setSelections] = useState<Record<number, number[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  useEffect(() => {
    if (item.status !== "running") setSubmitted(false);
  }, [item.status]);

  const toggleOption = (questionIndex: number, optionIndex: number, multiSelect: boolean) => {
    setSelections((current) => {
      const selected = current[questionIndex] ?? [];
      const next = multiSelect
        ? selected.includes(optionIndex)
          ? selected.filter((value) => value !== optionIndex)
          : [...selected, optionIndex].sort((a, b) => a - b)
        : [optionIndex];
      return { ...current, [questionIndex]: next };
    });
  };

  const ready =
    item.questions.length > 0 &&
    item.questions.every(
      (question, index) =>
        question.options.length > 0 && (selections[index]?.length ?? 0) > 0,
    );
  const complete = item.status !== "running";

  if (complete) {
    return (
      <div
        className={`rt-claude-item mx-2.5 my-1.5 flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
          item.status === "error"
            ? "border-red-500/30 bg-red-500/[0.06]"
            : "border-emerald-500/25 bg-emerald-500/[0.05]"
        }`}
      >
        <Icon
          name={item.status === "error" ? "info" : "check"}
          size="0.82em"
          className={item.status === "error" ? "text-red-500" : "text-emerald-500"}
        />
        <span className="rt-text-muted min-w-0 flex-1 truncate text-[0.75em]">
          {item.questions[0]?.question ?? "Claude question"}
        </span>
        <span
          className={`text-[0.68em] font-semibold ${
            item.status === "error" ? "text-red-500" : "text-emerald-500"
          }`}
        >
          {item.status === "error" ? "Failed" : "Answered"}
        </span>
      </div>
    );
  }

  return (
    <section
      className="rt-claude-item rt-claude-question mx-2.5 my-2 overflow-hidden rounded-xl border border-amber-500/35 bg-amber-500/[0.07]"
      aria-label="Claude question"
      role="alert"
    >
      <header className="flex items-center gap-2 border-b border-current/10 px-3 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg text-amber-500">
          <Icon name="spark" size="0.95em" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.78em] font-semibold">Claude needs your input</p>
          <p className="rt-text-faint text-[0.66em]">
            Choose below without leaving the agent view.
          </p>
        </div>
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500 motion-reduce:animate-none" />
      </header>

      <div className="space-y-3 p-3">
        {item.questions.map((question, questionIndex) => (
            <fieldset key={`${item.toolUseId}:${questionIndex}`} disabled={submitted}>
            <legend className="mb-2 w-full">
              <span className="rt-text-faint block text-[0.64em] font-semibold uppercase tracking-[0.12em]">
                {question.header}
                {question.multiSelect ? " · choose any" : ""}
              </span>
              <span className="mt-0.5 block text-[0.84em] font-medium leading-snug">
                {question.question}
              </span>
            </legend>
            <div className="grid gap-1.5">
              {question.options.map((option, optionIndex) => {
                const selected = selections[questionIndex]?.includes(optionIndex) ?? false;
                return (
                  <button
                    key={`${option.label}:${optionIndex}`}
                    type="button"
                    onClick={() =>
                      toggleOption(questionIndex, optionIndex, question.multiSelect)
                    }
                    aria-pressed={selected}
                    className={`group flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-[transform,background-color,border-color] hover:-translate-y-px ${
                      selected
                        ? "border-[var(--rt-accent)] bg-[var(--rt-accent-soft)]"
                        : "border-[var(--rt-border)] bg-[var(--rt-subsurface)] hover:border-amber-500/40"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border text-[0.62em] font-bold ${
                        question.multiSelect ? "rounded" : "rounded-full"
                      } ${
                        selected
                          ? "border-[var(--rt-accent)] bg-[var(--rt-accent)] text-[var(--rt-accent-contrast,#fff)]"
                          : "border-[var(--rt-text-faint)]"
                      }`}
                    >
                      {selected ? <Icon name="check" size="0.72em" strokeWidth={3} /> : optionIndex + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.78em] font-medium">{option.label}</span>
                      {option.description && (
                        <span className="rt-text-muted mt-0.5 block text-[0.69em] leading-snug">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {customOpen && (
        <div className="border-t border-current/10 px-3 py-2.5">
          <textarea
            autoFocus
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            disabled={submitted}
            placeholder="Type a custom answer…"
            rows={2}
            className="w-full resize-none rounded-lg border border-[var(--rt-border)] bg-[var(--rt-subsurface)] px-2.5 py-2 text-[0.78em] outline-none focus:border-[var(--rt-accent)] disabled:opacity-60"
          />
        </div>
      )}

      <footer className="flex items-center justify-end gap-2 border-t border-current/10 px-3 py-2">
        {onCustomAnswer && (
          <button
            type="button"
            disabled={submitted}
            onClick={() => setCustomOpen((current) => !current)}
            className="rt-btn px-2 py-1 text-[0.7em] font-medium disabled:opacity-40"
          >
            {customOpen ? "Use options instead" : "Custom answer"}
          </button>
        )}
        <button
          type="button"
          disabled={
            submitted ||
            (customOpen ? !customText.trim() || !onCustomAnswer : !ready || !onAnswer)
          }
          onClick={() => {
            if (customOpen) {
              if (onCustomAnswer?.(item, customText.trim())) setSubmitted(true);
              return;
            }
            const answers = item.questions.map((_, index) => selections[index] ?? []);
            if (onAnswer?.(item, answers)) setSubmitted(true);
          }}
          className="rt-btn-active rounded-md px-2.5 py-1 text-[0.7em] font-semibold disabled:opacity-40"
        >
          {submitted
            ? "Sending…"
            : customOpen
              ? "Send"
              : item.questions.length > 1
                ? "Submit answers"
                : "Answer Claude"}
        </button>
      </footer>
    </section>
  );
}

function TimelineItem({
  item,
  onAnswerQuestion,
  onCustomAnswer,
}: {
  item: ClaudeTimelineItem;
  onAnswerQuestion?: (question: ClaudeQuestionActivity, answers: number[][]) => boolean;
  onCustomAnswer?: (question: ClaudeQuestionActivity, text: string) => boolean;
}) {
  if (item.kind === "tool") return <ToolRow tool={item} />;
  if (item.kind === "shell") return <ShellRow item={item} />;
  if (item.kind === "question") {
    return <QuestionCard item={item} onAnswer={onAnswerQuestion} onCustomAnswer={onCustomAnswer} />;
  }
  if (item.kind === "user") {
    return (
      <div className="rt-claude-item flex justify-end px-3 py-2.5">
        <div className="max-w-[88%] rounded-xl rounded-br-sm border border-[var(--rt-border)] bg-[var(--rt-surface-hover)] px-3 py-2">
          <div className="rt-accent-text mb-1 text-[0.64em] font-semibold uppercase tracking-[0.14em]">
            You
          </div>
          <div className="whitespace-pre-wrap text-[0.86em] leading-relaxed">{item.text}</div>
        </div>
      </div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="rt-claude-item flex items-start gap-2.5 px-3 py-3">
        <span className="rt-claude-avatar mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg">
          <Icon name="claudeLogo" size="0.82em" className="rt-accent-text" />
        </span>
        <div className="min-w-0 flex-1 text-[0.86em] leading-relaxed">
          {renderMarkdown(item.text)}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`mx-2.5 my-2 border-l-2 px-2 py-1.5 text-[0.76em] ${
        item.tone === "error" ? "border-red-500 text-red-500" : "rt-text-muted"
      }`}
    >
      {item.text}
    </div>
  );
}

export function ClaudeTranscript({
  items,
  status,
  partialText = "",
  onAnswerQuestion,
  onCustomAnswer,
}: {
  items: ClaudeTimelineItem[];
  status: ClaudeRunStatus;
  partialText?: string;
  onAnswerQuestion?: (question: ClaudeQuestionActivity, answers: number[][]) => boolean;
  onCustomAnswer?: (question: ClaudeQuestionActivity, text: string) => boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const pendingQuestionId = useMemo(() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.kind === "question" && item.status === "running") return item.id;
    }
    return null;
  }, [items]);
  const showEmpty =
    items.length === 0 && (status === "connecting" || status === "idle");

  useEffect(() => {
    if (!pinnedRef.current) return;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [items, status, partialText]);

  // A question is an interruption, not ordinary transcript churn. Reveal it
  // even when the reader had scrolled up so Claude cannot appear silently
  // blocked below the fold.
  useEffect(() => {
    if (!pendingQuestionId) return;
    const element = scrollRef.current;
    if (!element) return;
    pinnedRef.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [pendingQuestionId]);

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinnedRef.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 72;
      }}
      className="min-h-0 flex-1 overflow-y-auto"
      aria-live="polite"
    >
      <div className="min-h-full w-full max-w-[1180px] px-[clamp(12px,2.5vw,36px)] py-2">
        {showEmpty ? (
          <div className="flex min-h-[34vh] max-w-xl flex-col items-start justify-end px-3 pb-8 text-left">
            <span className="rt-claude-empty-orb mb-4 flex h-10 w-10 items-center justify-center rounded-xl">
              <Icon name="claudeLogo" size="1.35em" className="rt-accent-text" />
            </span>
            <p className="text-[1em] font-medium">What should Claude work on?</p>
            <p className="rt-text-muted mt-1.5 text-[0.76em] leading-relaxed">
              Ask for a change, an investigation, or a command. Work stays in one
              readable execution stream.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <TimelineItem
              key={item.id}
              item={item}
              onAnswerQuestion={onAnswerQuestion}
              onCustomAnswer={onCustomAnswer}
            />
          ))
        )}
        {partialText ? (
          <div className="rt-claude-item flex items-start gap-2.5 px-3 py-3">
            <span className="rt-claude-avatar mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg">
              <Icon name="claudeLogo" size="0.82em" className="rt-accent-text" />
            </span>
            <div className="min-w-0 flex-1 whitespace-pre-wrap text-[0.86em] leading-relaxed">
              {partialText}
              <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-[var(--rt-accent)] align-baseline motion-reduce:animate-none" />
            </div>
          </div>
        ) : status === "running" ? (
          <div className="rt-claude-item rt-text-muted flex items-center gap-2.5 px-3 py-3 text-[0.75em]">
            <span className="rt-claude-thinking flex h-4 items-end gap-0.5" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="rt-claude-thinking-label">Claude is working</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ClaudeTranscript;
