import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import Icon from "../Icon";
import { buildSuggestions, type IrisSuggestion } from "../../lib/iris";
import {
  DEFAULT_GIT_STATUS,
  gitStatus,
  runBackgroundCommand,
  type CommandResult,
  type GitStatus,
} from "../../lib/system";
import { terminalBus, useActiveTerminal } from "../../lib/terminalBus";

export interface IrisBarProps {
  /** Working directory used for Git context and background commands. */
  cwd: string | null;
}

/**
 * Track the Git status of `cwd` for contextual macros. `refresh` is exposed so
 * the bar can re-read after a command (which may change ahead/behind/dirty) and
 * on focus. A request id guards against out-of-order async resolutions.
 */
function useGitStatus(cwd: string | null) {
  const [status, setStatus] = useState<GitStatus>(DEFAULT_GIT_STATUS);
  const reqId = useRef(0);

  const refresh = useCallback(() => {
    const id = (reqId.current += 1);
    void gitStatus(cwd).then((next) => {
      if (id === reqId.current) setStatus(next);
    });
  }, [cwd]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, refresh };
}

/** Combined, trimmed output of a background command (stdout then stderr). */
function commandOutput(result: CommandResult): string {
  return `${result.stdout}${result.stderr}`.trim() || "(no output)";
}

/**
 * Iris: a local, tokenless command bar. As the user types, it ranks contextual
 * Git macros (gated by the live repo state) and shell helpers. Choosing one runs
 * it in the active terminal; if no terminal is connected it falls back to a
 * captured background run shown inline.
 */
export function IrisBar({ cwd }: IrisBarProps) {
  const { status, refresh } = useGitStatus(cwd);
  const activeTerminal = useActiveTerminal();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [running, setRunning] = useState<string | null>(null);
  const [output, setOutput] = useState<{
    command: string;
    result: CommandResult;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const suggestions = useMemo(
    () => buildSuggestions(query, status),
    [query, status],
  );
  const safeIndex = suggestions.length
    ? Math.min(activeIndex, suggestions.length - 1)
    : 0;

  // Close the popover on an outside click (Escape is handled on the input).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const runSuggestion = useCallback(
    async (suggestion: IrisSuggestion) => {
      const command = suggestion.command;

      // Prefer the live terminal so output lands in the user's shell history.
      if (suggestion.run === "terminal" && terminalBus.run(command)) {
        terminalBus.get()?.focus();
        setQuery("");
        setOpen(false);
        // A Git macro can change ahead/behind/dirty — re-read shortly after.
        window.setTimeout(() => refresh(), 700);
        return;
      }

      // No terminal available (or explicitly background): capture the output.
      setRunning(command);
      setOutput(null);
      setOpen(false);
      try {
        const result = await runBackgroundCommand(command, cwd);
        setOutput({ command, result });
      } catch (err) {
        setOutput({
          command,
          result: { code: null, stdout: "", stderr: String(err) },
        });
      } finally {
        setRunning(null);
        setQuery("");
        refresh();
      }
    },
    [cwd, refresh],
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const suggestion = suggestions[safeIndex];
    if (suggestion) void runSuggestion(suggestion);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="rt-irisbar shrink-0 px-3 py-2">
      {running !== null || output !== null ? (
        <div className="mb-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="rt-text-faint truncate font-mono text-[11px]">
              {running !== null
                ? `running · ${running}`
                : output
                  ? `${output.command}${
                      typeof output.result.code === "number"
                        ? ` · exit ${output.result.code}`
                        : ""
                    }`
                  : ""}
            </span>
            {output !== null ? (
              <button
                type="button"
                onClick={() => setOutput(null)}
                title="Dismiss output"
                className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center"
              >
                <Icon name="close" size={12} aria-label="Dismiss output" />
              </button>
            ) : null}
          </div>
          {running !== null ? (
            <div className="rt-output rt-text-muted flex items-center gap-2 px-2.5 py-2 text-xs">
              <Icon name="sync" size={12} className="animate-spin" />
              Working…
            </div>
          ) : output ? (
            <pre className="rt-output max-h-40 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {commandOutput(output.result)}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div ref={containerRef} className="relative">
        {open && suggestions.length > 0 ? (
          <div
            role="listbox"
            aria-label="Iris suggestions"
            className="rt-menu absolute right-0 bottom-full left-0 z-20 mb-2 max-h-72 overflow-y-auto p-1"
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                role="option"
                aria-selected={index === safeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void runSuggestion(suggestion)}
                className="rt-menu-item flex w-full items-center gap-2.5 px-2.5 py-2 text-left"
              >
                <Icon
                  name={suggestion.icon}
                  size={15}
                  className="rt-row-icon shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {suggestion.title}
                  </span>
                  <span className="rt-text-muted block truncate text-xs">
                    {suggestion.description}
                  </span>
                </span>
                <span className="rt-text-faint shrink-0 text-[10px] font-medium tracking-wide uppercase">
                  {suggestion.group}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <Icon name="iris" size={16} className="rt-accent-text shrink-0" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
              refresh();
            }}
            onKeyDown={onKeyDown}
            placeholder="Ask Iris or type a command…"
            spellCheck={false}
            autoComplete="off"
            aria-label="Iris command bar"
            className="rt-input min-w-0 flex-1 px-2.5 py-1.5 text-sm"
          />

          {status.isRepo ? (
            <div className="rt-chip hidden items-center gap-1.5 px-2 py-1 text-[11px] sm:flex">
              <Icon name="gitClone" size={12} className="rt-accent-text" />
              <span className="max-w-[9rem] truncate font-medium">
                {status.branch ?? "detached"}
              </span>
              {status.ahead > 0 ? (
                <span className="flex items-center gap-0.5 tabular-nums">
                  <Icon name="push" size={10} />
                  {status.ahead}
                </span>
              ) : null}
              {status.behind > 0 ? (
                <span className="flex items-center gap-0.5 tabular-nums">
                  <Icon name="pull" size={10} />
                  {status.behind}
                </span>
              ) : null}
              {!status.clean ? (
                <Icon
                  name="dot"
                  size={9}
                  className="rt-accent-text fill-current"
                  aria-label="uncommitted changes"
                />
              ) : null}
            </div>
          ) : null}

          <span className="rt-text-faint hidden shrink-0 text-[11px] md:inline">
            {activeTerminal ? "↵ terminal" : "↵ background"}
          </span>

          <button
            type="submit"
            disabled={running !== null}
            className="rt-btn-outline flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium disabled:opacity-60"
          >
            <Icon name="spark" size={14} />
            <span className="hidden sm:inline">Run</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export default IrisBar;
