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
import { buildSuggestions, type IrisCtx, type IrisSuggestion, type IrisPrompt } from "../../lib/iris";
import { useMacrosStore } from "../../store/macros";
import MacroManager from "./MacroManager";
import {
  DEFAULT_GIT_STATUS,
  gitStatus,
  runBackgroundCommand,
  type CommandResult,
  type GitStatus,
} from "../../lib/system";
import { terminalBus, useActiveTerminal } from "../../lib/terminalBus";
import { useEditorStore } from "../../store/editor";

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
      // Degrade a missing/malformed response to "not a repo" rather than letting
      // a null blank the whole Iris bar (and the workspace) downstream.
      if (id === reqId.current) setStatus(next ?? DEFAULT_GIT_STATUS);
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
  const selectedPath = useEditorStore((s) => s.selectedPath);

  const userMacros = useMacrosStore((s) => s.macros);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [macroMgrOpen, setMacroMgrOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [running, setRunning] = useState<string | null>(null);
  const [output, setOutput] = useState<{
    command: string;
    result: CommandResult;
  } | null>(null);

  // Prompt mode — set when the user selects a macro that needs an argument.
  const [promptState, setPromptState] = useState<{
    suggestion: IrisSuggestion;
    prompt: IrisPrompt;
    arg: string;
  } | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const irisCtx = useMemo<IrisCtx>(
    () => ({ ...status, selectedPath }),
    [status, selectedPath],
  );

  const suggestions = useMemo(
    () => buildSuggestions(query, irisCtx, { userMacros }),
    [query, irisCtx, userMacros],
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

  const runCommand = useCallback(
    async (suggestion: IrisSuggestion, command: string) => {
      if (suggestion.run === "terminal" && terminalBus.run(command)) {
        terminalBus.get()?.focus();
        setQuery("");
        setOpen(false);
        setPromptState(null);
        window.setTimeout(() => refresh(), 700);
        return;
      }
      setRunning(command);
      setOutput(null);
      setOpen(false);
      setPromptState(null);
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

  const runSuggestion = useCallback(
    async (suggestion: IrisSuggestion) => {
      // If the macro needs an argument, enter prompt mode instead of running.
      if (suggestion.prompt) {
        setOpen(false);
        setPromptState({ suggestion, prompt: suggestion.prompt, arg: "" });
        setTimeout(() => promptInputRef.current?.focus(), 0);
        return;
      }
      await runCommand(suggestion, suggestion.command);
    },
    [runCommand],
  );

  const submitPrompt = useCallback(() => {
    if (!promptState) return;
    const arg = promptState.arg.trim();
    if (!arg) return;
    const command = promptState.prompt.build(arg);
    void runCommand(promptState.suggestion, command);
  }, [promptState, runCommand]);

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
    } else if (event.key === "Tab" && open && suggestions.length > 0) {
      // Without this branch, Tab falls through to the browser's default
      // focus-navigation behavior. If focus has already moved to (or is
      // captured by) the terminal, that default behavior can manifest as a
      // literal tab character landing in the shell instead of completing the
      // highlighted suggestion — Tab needs to be claimed here the same way
      // Enter already is, including preventDefault so neither the browser's
      // default nor anything downstream (xterm's own key handling) ever sees it.
      event.preventDefault();
      const suggestion = suggestions[safeIndex];
      if (suggestion) void runSuggestion(suggestion);
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
            className="rt-menu absolute right-0 bottom-full left-0 z-50 mb-2 max-h-72 overflow-y-auto p-1"
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                role="option"
                aria-selected={index === safeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  // Acting on mousedown (and preventing its default) instead of
                  // click keeps the Iris <input> from ever blurring in between —
                  // a blur here could let something else (terminal focus, the
                  // outside-click handler) react and unmount/reposition this
                  // list before the click event would otherwise have fired.
                  event.preventDefault();
                  void runSuggestion(suggestion);
                }}
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
                <span className="flex shrink-0 items-center gap-1.5">
                  {suggestion.prompt && (
                    <span className="rt-text-faint text-[10px]" title="Requires input">
                      ✎
                    </span>
                  )}
                  <span className="rt-text-faint text-[10px] font-medium tracking-wide uppercase">
                    {suggestion.group}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {/* ── Prompt mode ── */}
        {promptState && (
          <form
            onSubmit={(e) => { e.preventDefault(); submitPrompt(); }}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              onClick={() => setPromptState(null)}
              className="rt-btn flex h-7 w-7 shrink-0 items-center justify-center"
              title="Cancel"
            >
              <Icon name="back" size={14} />
            </button>
            <span className="rt-text-muted shrink-0 text-xs font-medium">
              {promptState.suggestion.title}
            </span>
            <input
              ref={promptInputRef}
              value={promptState.arg}
              onChange={(e) =>
                setPromptState((s) => s && { ...s, arg: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") setPromptState(null);
              }}
              placeholder={promptState.prompt.placeholder}
              spellCheck={false}
              autoComplete="off"
              aria-label={promptState.prompt.label}
              className="rt-input min-w-0 flex-1 px-2.5 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={!promptState.arg.trim()}
              className="rt-btn-outline flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium disabled:opacity-60"
            >
              <Icon name="launch" size={14} />
              <span className="hidden sm:inline">Run</span>
            </button>
          </form>
        )}

        {/* ── Normal mode ── */}
        {!promptState && (
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
            type="button"
            onClick={() => setMacroMgrOpen(true)}
            title="Manage Iris macros"
            className="rt-btn flex shrink-0 items-center justify-center h-7 w-7"
          >
            <Icon name="spark" size={14} aria-label="Manage Iris macros" />
          </button>

          <button
            type="submit"
            disabled={running !== null}
            className="rt-btn-outline flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium disabled:opacity-60"
          >
            <Icon name="spark" size={14} />
            <span className="hidden sm:inline">Run</span>
          </button>
        </form>
        )} {/* end !promptState */}
      </div>

      <MacroManager open={macroMgrOpen} onClose={() => setMacroMgrOpen(false)} />
    </div>
  );
}

export default IrisBar;
