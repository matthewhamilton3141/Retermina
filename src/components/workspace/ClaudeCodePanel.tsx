import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import ConfirmDialog from "../ConfirmDialog";
import Icon from "../Icon";
import { useTauriFileDrop } from "../../hooks/useTauriFileDrop";
import { claudeBus } from "../../lib/claudeBus";
import {
  buildClaudeSlashCommands,
  claudeSettingDraft,
  claudeSlashQuery,
  filterClaudeSettingOptions,
  filterClaudeSlashCommands,
  resolveClaudeSlashCommand,
  CLAUDE_MODEL_OPTIONS,
  type ClaudeSettingOption,
  type ClaudeSlashCommand,
} from "../../lib/claudeCommands";
import {
  appendClaudeTerminalOutput,
  detectClaudeLimit,
  detectsClaudePermissionRequest,
} from "../../lib/claudeLimit";
import {
  interruptClaudeAgent,
  sendClaudeAgentMessage,
  startClaudeAgent,
  stopClaudeAgent,
} from "../../lib/claudeAgent";
import { getClaudeTokenUsage, setClaudeTheme, type ClaudeTokenUsage } from "../../lib/fs";
import { prettyPath } from "../../lib/format";
import { claudeThemeForEngine } from "../../lib/theme";
import type {
  ClaudePermissionMode,
  ClaudeQuestionActivity,
} from "../../lib/claudeTranscript";
import {
  claudeWorkspacePreference,
  useClaudeSessions,
  useClaudeWorkspacePreferences,
  type ClaudeModelChoice,
  type ClaudePanelView,
} from "../../store/claudeSessions";
import { useScheduleDraft } from "../../store/scheduledPrompts";
import { useTheme } from "../../theme/ThemeProvider";
import ClaudeControlBar from "./ClaudeControlBar";
import ClaudeSettingMenu from "./ClaudeSettingMenu";
import ClaudeSlashMenu from "./ClaudeSlashMenu";
import ClaudeTranscript from "./ClaudeTranscript";
import { usePanelZoom } from "./panelZoom";
import TerminalViewport, { type TerminalControls } from "./TerminalViewport";

function newClaudeSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const ClaudeCodePanel = memo(function ClaudeCodePanel({
  cwd,
  workspaceId,
  active,
}: {
  cwd: string | null;
  workspaceId: string;
  active: boolean;
}) {
  const panelZoom = usePanelZoom();
  const controlsRef = useRef<TerminalControls | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const composerContainerRef = useRef<HTMLDivElement | null>(null);
  const composerDropRef = useRef<HTMLFormElement | null>(null);
  const pendingPromptsRef = useRef<string[]>([]);
  // Holds the timer that submits (sends the trailing CR of) a just-pasted prompt.
  // Tracked so a fast interrupt can cancel the submit before it fires.
  const pendingSubmitRef = useRef<number | null>(null);
  const outputBufferRef = useRef("");
  const lastLimitKeyRef = useRef("");
  const revealedQuestionRef = useRef<string | null>(null);
  // Whether Claude has actually written a transcript for the current session.
  // `--resume` fails hard on a session that was never persisted (Claude sat idle
  // at its welcome screen), so a restart (theme/permission/model change) must
  // relaunch such a session with `--session-id` instead of resuming a ghost.
  const sessionEstablishedRef = useRef(false);
  // The live stream-json agent subprocess driving the Agent view, and an
  // ever-incrementing index that keeps each ingested record's source id unique
  // across agent restarts (so a resume never false-dedupes against old records).
  const agentHandleRef = useRef<string | null>(null);
  const agentIndexRef = useRef(0);

  const session = useClaudeSessions((state) => state.sessions[workspaceId]);
  const beginSession = useClaudeSessions((state) => state.beginSession);
  const ingest = useClaudeSessions((state) => state.ingest);
  const setStatus = useClaudeSessions((state) => state.setStatus);
  const setSessionPermissionMode = useClaudeSessions((state) => state.setPermissionMode);
  const setError = useClaudeSessions((state) => state.setError);
  const markSubmitted = useClaudeSessions((state) => state.markSubmitted);
  const markInterrupted = useClaudeSessions((state) => state.markInterrupted);
  const pushNotice = useClaudeSessions((state) => state.pushNotice);
  const setLimit = useClaudeSessions((state) => state.setLimit);
  const removeSession = useClaudeSessions((state) => state.removeSession);

  const storedView = useClaudeWorkspacePreferences(
    (state) => state.workspaces[workspaceId]?.view,
  );
  const draft = useClaudeWorkspacePreferences(
    (state) => state.workspaces[workspaceId]?.draft ?? "",
  );
  const permissionMode = useClaudeWorkspacePreferences(
    (state) => state.workspaces[workspaceId]?.permissionMode ?? "default",
  );
  const modelChoice = useClaudeWorkspacePreferences(
    (state) => state.workspaces[workspaceId]?.model ?? "default",
  );
  const setView = useClaudeWorkspacePreferences((state) => state.setView);
  const setDraft = useClaudeWorkspacePreferences((state) => state.setDraft);
  const setPreferredPermissionMode = useClaudeWorkspacePreferences(
    (state) => state.setPermissionMode,
  );
  const setModelChoice = useClaudeWorkspacePreferences((state) => state.setModel);
  const view = storedView ?? "agent";

  // Once the CLI has been opened, keep it mounted for the panel's lifetime.
  useEffect(() => {
    if (view === "cli") setCliMounted(true);
  }, [view]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [restartNonce, setRestartNonce] = useState(0);
  // The CLI terminal mounts on first open and then stays mounted (even while the
  // Agent view is showing) so switching back and forth never resets it.
  const [cliMounted, setCliMounted] = useState(false);
  // Brief loader shown in the Agent view while Claude warms up on boot.
  const [booting, setBooting] = useState(true);
  // A model switch awaiting the user's confirmation (only when a chat is live).
  const [pendingModel, setPendingModel] = useState<ClaudeModelChoice | null>(null);
  const [usage, setUsage] = useState<ClaudeTokenUsage | null>(null);
  const status = session?.status ?? "connecting";

  const { theme } = useTheme();
  const targetClaudeTheme = claudeThemeForEngine(theme);
  const initialClaudeThemeRef = useRef(targetClaudeTheme);
  const [themeReady, setThemeReady] = useState(false);
  const [launchedClaudeTheme, setLaunchedClaudeTheme] = useState<string | null>(null);
  const [dismissedTheme, setDismissedTheme] = useState<string | null>(null);
  const showThemeRestart =
    themeReady &&
    launchedClaudeTheme !== targetClaudeTheme &&
    dismissedTheme !== targetClaudeTheme;

  // Claude reads ~/.claude.json only at process launch. Gate the PTY's first
  // mount on this write so an old *-ansi preference cannot win the startup
  // race and flatten Claude's own full-colour interface.
  useEffect(() => {
    let disposed = false;
    const launchTheme = initialClaudeThemeRef.current;
    void setClaudeTheme(launchTheme)
      .catch(() => {})
      .finally(() => {
        if (disposed) return;
        setLaunchedClaudeTheme(launchTheme);
        setThemeReady(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Warm the interactive CLI in the *background* on boot — Claude fully
  // initialises there (including any first-run step the headless agent can't do)
  // without ever showing the terminal. The Agent view stays put and just shows a
  // brief loader (see `booting`), so the hand-off is invisible.
  useEffect(() => {
    if (themeReady) setCliMounted(true);
  }, [themeReady]);

  // Clear the Agent's boot loader once its subprocess is live (with a short
  // settle), or after a fallback so it can never get stuck spinning.
  useEffect(() => {
    if (!booting) return;
    const delay = connected ? 350 : 4000;
    const timer = window.setTimeout(() => setBooting(false), delay);
    return () => window.clearTimeout(timer);
  }, [booting, connected]);

  // The CLI view is an independent, persistent interactive Claude terminal. It
  // is kept mounted once opened so toggling never resets it, and runs its own
  // (auto) session rather than sharing the Agent's stream-json session — Claude
  // rejects two live processes on one session id.
  const createClaudeCommand = useCallback(() => {
    const activeMode =
      useClaudeSessions.getState().sessions[workspaceId]?.permissionMode ?? permissionMode;
    const args = ["claude", "--permission-mode", activeMode];
    if (modelChoice !== "default") args.push("--model", modelChoice);
    return args.map(shellQuote).join(" ");
  }, [modelChoice, permissionMode, workspaceId]);

  // Drive the Agent view with a managed stream-json Claude subprocess: it
  // streams structured records straight over stdout (no fragile file-tailing).
  // It stays alive regardless of the active view (so switching to the CLI and
  // back never resets it) and only (re)starts on a permission/model change.
  // Headless stream-json can't surface an interactive approval prompt, so modes
  // that rely on one ("default"/"auto"/"dontAsk") would block every tool. Coerce
  // those to auto-accept for the agent; Plan / Full access pass through.
  const rawPermissionMode = session?.permissionMode ?? permissionMode;
  const agentPermissionMode: ClaudePermissionMode =
    rawPermissionMode === "default" ||
    rawPermissionMode === "auto" ||
    rawPermissionMode === "dontAsk"
      ? "acceptEdits"
      : rawPermissionMode;
  useEffect(() => {
    if (!themeReady) return;

    // Mint the agent session on first need.
    if (!sessionId) {
      const id = newClaudeSessionId();
      sessionEstablishedRef.current = false;
      beginSession(workspaceId, id);
      setSessionId(id);
      return;
    }

    const id = sessionId;
    let disposed = false;
    let handleId: string | null = null;
    if (useClaudeSessions.getState().sessions[workspaceId]?.status !== "running") {
      setStatus(workspaceId, "connecting");
    }

    void startClaudeAgent({
      cwd,
      sessionId: id,
      permissionMode: agentPermissionMode,
      model: modelChoice,
      resume: sessionEstablishedRef.current,
      onEvent: (event) => {
        if (disposed) return;
        if (event.type === "record") {
          sessionEstablishedRef.current = true;
          ingest(workspaceId, id, agentIndexRef.current++, event.record);
        } else if (event.type === "exit") {
          setConnected(false);
        }
      },
    })
      .then((hid) => {
        if (disposed) {
          void stopClaudeAgent(hid);
          return;
        }
        handleId = hid;
        agentHandleRef.current = hid;
        setConnected(true);
        if (useClaudeSessions.getState().sessions[workspaceId]?.status === "connecting") {
          setStatus(workspaceId, "idle");
        }
        // Flush any prompts queued before the agent was ready.
        const pending = pendingPromptsRef.current.splice(0);
        for (const prompt of pending) {
          ingest(workspaceId, id, agentIndexRef.current++, {
            type: "user",
            timestamp: new Date().toISOString(),
            message: { content: prompt },
          });
          void sendClaudeAgentMessage(hid, prompt);
        }
      })
      .catch((error) => {
        if (!disposed) setError(workspaceId, String(error));
      });

    return () => {
      disposed = true;
      setConnected(false);
      agentHandleRef.current = null;
      if (handleId) void stopClaudeAgent(handleId);
    };
  }, [
    themeReady,
    sessionId,
    cwd,
    agentPermissionMode,
    modelChoice,
    restartNonce,
    beginSession,
    ingest,
    setStatus,
    setError,
    workspaceId,
  ]);

  useEffect(() => {
    if (!cwd) return;
    const load = () =>
      getClaudeTokenUsage(cwd, sessionId)
        .then(setUsage)
        .catch(() => {});
    load();
    const interval = window.setInterval(load, 30_000);
    return () => window.clearInterval(interval);
  }, [cwd, sessionId]);

  useEffect(() => {
    if (
      !cwd ||
      (status !== "idle" && status !== "waiting" && status !== "limited")
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void getClaudeTokenUsage(cwd, sessionId).then(setUsage).catch(() => {});
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [cwd, sessionId, session?.items.length, status]);

  const writePrompt = useCallback(
    (text: string, clearComposer = false, trackInTranscript = true) => {
      const prompt = text.trim();
      if (!prompt) return;
      if (trackInTranscript) markSubmitted(workspaceId, prompt);
      if (clearComposer) setDraft(workspaceId, "");

      const current = claudeWorkspacePreference(workspaceId);
      if (current.view === "agent") {
        const handle = agentHandleRef.current;
        // Queue until the agent subprocess is ready (flushed in its effect).
        if (!handle || !sessionId) {
          pendingPromptsRef.current.push(prompt);
          return;
        }
        // stream-json never echoes the user's turn, so add the bubble ourselves.
        ingest(workspaceId, sessionId, agentIndexRef.current++, {
          type: "user",
          timestamp: new Date().toISOString(),
          message: { content: prompt },
        });
        void sendClaudeAgentMessage(handle, prompt);
        return;
      }

      const controls = controlsRef.current;
      if (!controls) {
        pendingPromptsRef.current.push(prompt);
        return;
      }
      controls.write(`\x1b[200~${prompt}\x1b[201~`);
      if (pendingSubmitRef.current) window.clearTimeout(pendingSubmitRef.current);
      pendingSubmitRef.current = window.setTimeout(() => {
        pendingSubmitRef.current = null;
        controlsRef.current?.write("\r");
      }, 120);
    },
    [ingest, markSubmitted, sessionId, setDraft, workspaceId],
  );

  useEffect(() => {
    claudeBus.set(workspaceId, {
      paste: (text) => {
        const current = claudeWorkspacePreference(workspaceId);
        if (current.view === "agent") {
          const joined = current.draft ? `${current.draft}\n${text}` : text;
          useClaudeWorkspacePreferences.getState().setDraft(workspaceId, joined);
        } else {
          controlsRef.current?.write(`\x1b[200~${text}\x1b[201~`);
        }
      },
      focus: () => {
        const current = claudeWorkspacePreference(workspaceId);
        if (current.view === "agent") composerRef.current?.focus();
        else controlsRef.current?.focus();
      },
      submit: () => {
        const current = claudeWorkspacePreference(workspaceId);
        if (current.view === "agent") writePrompt(current.draft, true);
        else controlsRef.current?.write("\r");
      },
      execute: (text) => writePrompt(text),
    });
    return () => claudeBus.clear(workspaceId);
  }, [workspaceId, writePrompt]);

  useEffect(
    () => () => {
      if (pendingSubmitRef.current) window.clearTimeout(pendingSubmitRef.current);
    },
    [],
  );

  const handleTerminalOutput = useCallback(
    (chunk: string) => {
      const buffer = appendClaudeTerminalOutput(outputBufferRef.current, chunk);
      outputBufferRef.current = buffer;

      const limit = detectClaudeLimit(buffer);
      if (limit) {
        const key = `${limit.kind}:${limit.resetAt ?? limit.message.slice(0, 120)}`;
        if (key !== lastLimitKeyRef.current) {
          lastLimitKeyRef.current = key;
          setLimit(workspaceId, {
            kind: limit.kind,
            resetAt: limit.resetAt,
            detectedAt: Date.now(),
          });
        }
      } else if (detectsClaudePermissionRequest(buffer)) {
        const current = useClaudeSessions.getState().sessions[workspaceId];
        if (current && current.status !== "limited") setStatus(workspaceId, "waiting");
        // Drop the painted prompt after surfacing it so later terminal redraws
        // cannot keep forcing a completed approval back into "waiting".
        outputBufferRef.current = "";
      }
    },
    [setLimit, setStatus, workspaceId],
  );

  const changeView = useCallback(
    (next: ClaudePanelView) => {
      setView(workspaceId, next);
      if (next === "cli") requestAnimationFrame(() => controlsRef.current?.focus());
      else requestAnimationFrame(() => composerRef.current?.focus());
    },
    [setView, workspaceId],
  );

  const restartClaude = useCallback(() => {
    setConnected(false);
    setStatus(workspaceId, "connecting");
    setRestartNonce((value) => value + 1);
  }, [setStatus, workspaceId]);

  const startFreshClaude = useCallback(() => {
    outputBufferRef.current = "";
    lastLimitKeyRef.current = "";
    sessionEstablishedRef.current = false;
    setConnected(false);
    if (sessionId) removeSession(workspaceId, sessionId);
    setSessionId(null);
    setRestartNonce((value) => value + 1);
  }, [removeSession, sessionId, workspaceId]);

  const handleRestart = async () => {
    await setClaudeTheme(targetClaudeTheme).catch(() => {});
    setLaunchedClaudeTheme(targetClaudeTheme);
    setDismissedTheme(null);
    restartClaude();
  };

  const changePermissionMode = (next: ClaudePermissionMode) => {
    if (next === (session?.permissionMode ?? permissionMode)) return;
    setPreferredPermissionMode(workspaceId, next);
    setSessionPermissionMode(workspaceId, next);
    restartClaude();
  };

  const modelLabelFor = (value: string) =>
    CLAUDE_MODEL_OPTIONS.find((option) => option.value === value)?.label ?? value;

  const applyModel = (next: ClaudeModelChoice) => {
    setModelChoice(workspaceId, next);
    restartClaude();
    pushNotice(workspaceId, `Model → ${modelLabelFor(next)}`);
  };

  const changeModel = (next: ClaudeModelChoice) => {
    if (next === modelChoice) return;
    // Switching restarts the agent. It resumes the same conversation on the new
    // model, but double-check with the user first when a conversation is live.
    if ((session?.items.length ?? 0) > 0) {
      setPendingModel(next);
      return;
    }
    applyModel(next);
  };

  const answerQuestion = useCallback(
    (question: ClaudeQuestionActivity, answers: number[][]) => {
      const controls = controlsRef.current;
      if (!controls) return false;

      question.questions.forEach((prompt, questionIndex) => {
        const selected = [...(answers[questionIndex] ?? [])].sort((a, b) => a - b);
        if (selected.length === 0) return;
        let sequence = "";
        let cursor = 0;
        if (prompt.multiSelect) {
          for (const optionIndex of selected) {
            sequence += "\x1b[B".repeat(Math.max(0, optionIndex - cursor));
            sequence += " ";
            cursor = optionIndex;
          }
          sequence += "\r";
        } else {
          sequence = `${"\x1b[B".repeat(selected[0])}\r`;
        }
        window.setTimeout(
          () => controlsRef.current?.write(sequence),
          100 + questionIndex * 220,
        );
      });

      window.setTimeout(
        () => setStatus(workspaceId, "running"),
        120 + answers.length * 220,
      );
      return true;
    },
    [setStatus, workspaceId],
  );

  const openSchedule = () => {
    const currentDraft = claudeWorkspacePreference(workspaceId).draft.trim();
    useScheduleDraft.getState().openDraft({
      prompt: currentDraft || session?.lastSubmittedPrompt || "",
      fireAt: session?.limit?.resetAt ?? null,
      workspaceId,
      cwd,
      workspaceLabel: cwd ? prettyPath(cwd) : "Blank Terminal",
    });
  };

  const contextPct =
    usage && usage.contextWindow > 0
      ? Math.min(1, usage.contextTokens / usage.contextWindow)
      : 0;
  const contextColor =
    contextPct >= 0.85 ? "#ef4444" : contextPct >= 0.6 ? "#f59e0b" : "var(--rt-accent)";
  const canSubmit =
    connected && status !== "waiting" && status !== "limited" && status !== "exited";
  // Only offer interrupt while Claude is actively writing a turn. When it's
  // waiting on the reader (a question/approval) there's nothing to stop.
  const canInterrupt = connected && status === "running";
  const model = session?.model ?? usage?.model;
  const pendingQuestionId =
    session?.items.find(
      (item) => item.kind === "question" && item.status === "running",
    )?.id ?? null;
  const hasPendingQuestion = pendingQuestionId !== null;
  // Model/mode are switchable whenever a session exists — the change restarts
  // the agent (resuming the same conversation), so it needn't wait for idle.
  const controlsDisabled = !sessionId;
  const slashCommands = useMemo(
    () => buildClaudeSlashCommands(session?.skills ?? []),
    [session?.skills],
  );
  const slashQuery = claudeSlashQuery(draft);
  // `/model …` / `/mode …` get their own inline picker instead of the generic
  // command menu (and never route to the CLI).
  const settingInfo = claudeSettingDraft(draft);
  const settingKind = settingInfo?.kind ?? null;
  const filteredSlashCommands = useMemo(
    () =>
      slashQuery === null
        ? []
        : filterClaudeSlashCommands(slashCommands, slashQuery),
    [slashCommands, slashQuery],
  );
  const [slashSelection, setSlashSelection] = useState(0);
  const [dismissedSlashDraft, setDismissedSlashDraft] = useState<string | null>(null);
  const slashMenuVisible =
    slashQuery !== null && dismissedSlashDraft !== draft && settingKind === null;

  const filteredSettingOptions = useMemo(
    () => (settingInfo ? filterClaudeSettingOptions(settingInfo.kind, settingInfo.query) : []),
    [settingInfo?.kind, settingInfo?.query],
  );
  const [settingSelection, setSettingSelection] = useState(0);
  const [dismissedSettingDraft, setDismissedSettingDraft] = useState<string | null>(null);
  const settingMenuVisible =
    settingKind !== null &&
    filteredSettingOptions.length > 0 &&
    dismissedSettingDraft !== draft;
  const activeSettingValue =
    settingKind === "model" ? modelChoice : session?.permissionMode ?? permissionMode;

  const applySetting = (option: ClaudeSettingOption) => {
    if (settingKind === "model") {
      // changeModel handles the confirmation + "Model → …" notice.
      changeModel(option.value);
    } else if (settingKind === "mode") {
      changePermissionMode(option.value as ClaudePermissionMode);
      pushNotice(workspaceId, `Mode → ${option.label}`);
    }
    setDraft(workspaceId, "");
    setDismissedSettingDraft(null);
  };

  useEffect(() => {
    if (!pendingQuestionId || revealedQuestionRef.current === pendingQuestionId) return;
    revealedQuestionRef.current = pendingQuestionId;
    if (view !== "agent") setView(workspaceId, "agent");
  }, [pendingQuestionId, setView, view, workspaceId]);

  useEffect(() => {
    setSlashSelection(0);
  }, [slashQuery]);

  useEffect(() => {
    if (slashSelection < filteredSlashCommands.length) return;
    setSlashSelection(Math.max(0, filteredSlashCommands.length - 1));
  }, [filteredSlashCommands.length, slashSelection]);

  useEffect(() => {
    setSettingSelection(0);
  }, [settingInfo?.kind, settingInfo?.query]);

  useEffect(() => {
    if (settingSelection < filteredSettingOptions.length) return;
    setSettingSelection(Math.max(0, filteredSettingOptions.length - 1));
  }, [filteredSettingOptions.length, settingSelection]);

  const pickSlashCommand = useCallback(
    (command: ClaudeSlashCommand) => {
      const next = `${command.command}${command.acceptsArguments ? " " : ""}`;
      setDraft(workspaceId, next);
      setDismissedSlashDraft(next);
      requestAnimationFrame(() => {
        const textarea = composerRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(next.length, next.length);
      });
    },
    [setDraft, workspaceId],
  );

  const submitDraft = useCallback(() => {
    const prompt = draft.trim();
    if (!prompt || !canSubmit) return;
    // `/model …` and `/mode …` are handled inline — never sent to Claude/CLI.
    if (settingInfo) {
      const options = filterClaudeSettingOptions(settingInfo.kind, settingInfo.query);
      const option = options[settingSelection] ?? options[0];
      if (option) applySetting(option);
      else setDraft(workspaceId, "");
      return;
    }
    const command = resolveClaudeSlashCommand(slashCommands, prompt);
    if (command?.behavior === "fresh") {
      setDraft(workspaceId, "");
      setDismissedSlashDraft(null);
      startFreshClaude();
      return;
    }
    const terminalCommand = prompt.startsWith("/") && command?.behavior !== "agent";
    if (terminalCommand) changeView("cli");
    writePrompt(prompt, true, !terminalCommand);
    setDismissedSlashDraft(null);
  }, [
    applySetting,
    canSubmit,
    changeView,
    draft,
    settingInfo,
    settingSelection,
    slashCommands,
    setDraft,
    startFreshClaude,
    workspaceId,
    writePrompt,
  ]);

  const interruptClaude = useCallback(() => {
    if (!canInterrupt) return;
    const current = claudeWorkspacePreference(workspaceId);
    if (current.view === "agent") {
      const handle = agentHandleRef.current;
      if (handle) void interruptClaudeAgent(handle);
    } else {
      // Cancel a prompt pasted but whose submitting CR hasn't fired yet, so a
      // fast interrupt doesn't let the turn start right after we stop it.
      if (pendingSubmitRef.current) {
        window.clearTimeout(pendingSubmitRef.current);
        pendingSubmitRef.current = null;
      }
      // Escape cancels the active turn in Claude's TUI.
      controlsRef.current?.write("\x1b");
    }
    // Reflect it immediately — the turn may end before any record arrives.
    markInterrupted(workspaceId);
  }, [canInterrupt, markInterrupted, workspaceId]);

  const insertDroppedPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const pasted = paths.map(shellQuote).join(" ");
      const textarea = composerRef.current;
      const current = draft;
      const start = textarea?.selectionStart ?? current.length;
      const end = textarea?.selectionEnd ?? start;
      const before = current.slice(0, start);
      const after = current.slice(end);
      const spaceBefore = before.length > 0 && !/\s$/.test(before) ? " " : "";
      const spaceAfter = after.length > 0 && !/^\s/.test(after) ? " " : "";
      const insert = `${spaceBefore}${pasted}${spaceAfter}`;
      const next = `${before}${insert}${after}`;
      const cursor = before.length + insert.length - (spaceAfter ? 1 : 0);
      setDraft(workspaceId, next);
      setDismissedSlashDraft(null);
      requestAnimationFrame(() => {
        const field = composerRef.current;
        field?.focus();
        field?.setSelectionRange(cursor, cursor);
      });
    },
    [draft, setDraft, workspaceId],
  );

  const { isDragOver: isComposerDragOver } = useTauriFileDrop(
    composerDropRef,
    insertDroppedPaths,
  );

  useLayoutEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    const maxHeight = 160;
    const minHeight = 22;
    textarea.style.height = "auto";
    const contentHeight = textarea.scrollHeight;
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, contentHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  return (
    <div
      className="rt-claude-stage rt-terminal-surface flex h-full w-full flex-col"
      style={{ fontSize: `${Math.round(14 * panelZoom)}px` }}
    >
      {showThemeRestart && (
        <div className="rt-divider-b flex shrink-0 items-center gap-2 px-2.5 py-1.5">
          <span className="rt-text-muted flex-1 text-[0.72em]">
            Restart Claude to match {theme.label}.
          </span>
          <button
            type="button"
            onClick={handleRestart}
            className="rt-accent-text text-[0.72em] font-medium hover:underline"
          >
            Restart
          </button>
          <button
            type="button"
            onClick={() => setDismissedTheme(targetClaudeTheme)}
            className="rt-text-faint text-[0.72em] hover:underline"
          >
            Later
          </button>
        </div>
      )}

      {session?.limit && (
        <div className="rt-divider-b flex shrink-0 items-center gap-2 bg-amber-500/10 px-2.5 py-2">
          <Icon name="clock" size="0.95em" className="shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1 text-[0.76em]">
            {session.limit.kind === "weekly" ? "Weekly" : "Session"} limit reached
            {session.limit.resetAt
              ? ` · resets ${new Date(session.limit.resetAt).toLocaleString([], {
                  weekday: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : " · reset time needs review"}
          </span>
          <button
            type="button"
            onClick={openSchedule}
            className="shrink-0 text-[0.74em] font-semibold text-amber-600 hover:underline dark:text-amber-400"
          >
            Schedule prompt
          </button>
          <button
            type="button"
            onClick={() => setLimit(workspaceId, null)}
            className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center"
            title="Dismiss"
          >
            <Icon name="close" size="0.8em" aria-label="Dismiss limit notice" />
          </button>
        </div>
      )}

      {status === "waiting" && view === "agent" && !hasPendingQuestion && (
        <button
          type="button"
          onClick={() => changeView("cli")}
          className="rt-divider-b flex shrink-0 items-center gap-2 px-2.5 py-1.5 text-left"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          <span className="rt-text-muted flex-1 text-[0.74em]">Claude needs your approval.</span>
          <span className="rt-accent-text text-[0.72em] font-medium">Open CLI</span>
        </button>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          className={`absolute inset-0 flex flex-col ${
            view === "agent" ? "visible" : "invisible pointer-events-none"
          }`}
        >
          {booting && (session?.items.length ?? 0) === 0 ? (
            <div className="rt-text-muted flex min-h-0 flex-1 items-center justify-center gap-2 text-sm">
              <Icon name="sync" size="0.95em" className="rt-accent-text animate-spin" />
              Starting Claude…
            </div>
          ) : (
            <ClaudeTranscript
              items={session?.items ?? []}
              status={status}
              partialText={session?.partialText ?? ""}
              onAnswerQuestion={answerQuestion}
              onOpenCli={() => changeView("cli")}
            />
          )}
          {session?.error && (
            <div className="border-t border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[0.72em] text-red-500">
              {session.error}
            </div>
          )}
          <form
            ref={composerDropRef}
            className="rt-claude-composer-shell relative shrink-0 px-[clamp(8px,1.5vw,22px)] py-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              submitDraft();
            }}
          >
            <div className="rt-claude-composer-row flex w-full items-end gap-2">
              <button
                type="button"
                disabled={!!draft.trim() && !draft.startsWith("/")}
                onClick={() => {
                  const next = draft.trim() ? draft : "/";
                  setDraft(workspaceId, next);
                  setDismissedSlashDraft(null);
                  requestAnimationFrame(() => composerRef.current?.focus());
                }}
                className="rt-claude-command-trigger rt-btn-outline flex h-9 w-9 shrink-0 items-center justify-center font-mono text-sm font-semibold disabled:opacity-35"
                title={
                  draft.trim() && !draft.startsWith("/")
                    ? "Clear the draft to use Claude commands"
                    : "Claude commands"
                }
                aria-label="Open Claude commands"
              >
                /
              </button>
              <div
                ref={composerContainerRef}
                className={`rt-claude-composer rt-input flex items-center px-3 py-1.5 ${
                  status === "running" ? "rt-claude-composer-active" : ""
                } ${isComposerDragOver ? "rt-claude-composer-drop" : ""}`}
              >
                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(event) => {
                    setDraft(workspaceId, event.target.value);
                    setDismissedSlashDraft(null);
                  }}
                  onKeyDown={(event) => {
                    if (settingMenuVisible) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setSettingSelection(
                          (index) => (index + 1) % filteredSettingOptions.length,
                        );
                        return;
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setSettingSelection(
                          (index) =>
                            (index - 1 + filteredSettingOptions.length) %
                            filteredSettingOptions.length,
                        );
                        return;
                      }
                      if (
                        ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") &&
                        filteredSettingOptions[settingSelection]
                      ) {
                        event.preventDefault();
                        applySetting(filteredSettingOptions[settingSelection]);
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setDismissedSettingDraft(draft);
                        return;
                      }
                    }
                    if (slashMenuVisible) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setSlashSelection((index) =>
                          filteredSlashCommands.length
                            ? (index + 1) % filteredSlashCommands.length
                            : 0,
                        );
                        return;
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setSlashSelection((index) =>
                          filteredSlashCommands.length
                            ? (index - 1 + filteredSlashCommands.length) %
                              filteredSlashCommands.length
                            : 0,
                        );
                        return;
                      }
                      if (
                        ((event.key === "Enter" && !event.shiftKey) ||
                          event.key === "Tab") &&
                        filteredSlashCommands[slashSelection]
                      ) {
                        event.preventDefault();
                        pickSlashCommand(filteredSlashCommands[slashSelection]);
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setDismissedSlashDraft(draft);
                        return;
                      }
                    }
                    if (event.key === "Escape" && canInterrupt) {
                      event.preventDefault();
                      interruptClaude();
                      return;
                    }
                    if (event.key === "Enter" && !event.shiftKey && canSubmit) {
                      event.preventDefault();
                      submitDraft();
                    }
                  }}
                  rows={1}
                  placeholder="Ask Claude to change, inspect, or run something…"
                  aria-label="Prompt Claude Code"
                  className="min-h-[22px] min-w-0 flex-1 resize-none bg-transparent text-[0.86em] leading-[1.45] outline-none focus:outline-none focus-visible:outline-none"
                />
              </div>
              {canInterrupt ? (
                <button
                  type="button"
                  onClick={interruptClaude}
                  title="Interrupt Claude (Esc)"
                  className="rt-claude-interrupt flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform hover:-translate-y-px active:translate-y-0"
                >
                  <Icon name="stop" size="0.85em" aria-label="Interrupt Claude" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim() || !canSubmit}
                  title={
                    !connected
                      ? "Claude is connecting"
                      : status === "limited"
                        ? "Schedule this prompt for the reset time"
                        : "Send prompt (Enter)"
                  }
                  className="rt-btn-active flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform hover:-translate-y-px active:translate-y-0 disabled:opacity-35"
                >
                  <Icon name="levelUp" size="0.95em" aria-label="Send prompt" />
                </button>
              )}
            </div>
            {isComposerDragOver && (
              <div className="pointer-events-none absolute inset-1.5 z-10 flex items-center justify-center gap-2 rounded-[var(--rt-radius-sm)] border-2 border-dashed border-[var(--rt-accent)] bg-[var(--rt-accent-soft)]">
                <Icon name="folderOpen" size={16} className="rt-accent-text" />
                <p className="rt-accent-text text-xs font-medium">
                  Drop to insert path
                </p>
              </div>
            )}
            {slashMenuVisible && (
              <ClaudeSlashMenu
                anchorRef={composerContainerRef}
                commands={filteredSlashCommands}
                selectedIndex={slashSelection}
                onSelectedIndexChange={setSlashSelection}
                onPick={pickSlashCommand}
                onClose={() => setDismissedSlashDraft(draft)}
              />
            )}
            {settingMenuVisible && settingKind && (
              <ClaudeSettingMenu
                anchorRef={composerContainerRef}
                kind={settingKind}
                options={filteredSettingOptions}
                selectedIndex={settingSelection}
                activeValue={activeSettingValue}
                onSelectedIndexChange={setSettingSelection}
                onPick={applySetting}
                onClose={() => setDismissedSettingDraft(draft)}
              />
            )}
          </form>
        </div>

        <div
          className={`absolute inset-0 ${
            view === "cli" ? "visible" : "invisible pointer-events-none"
          }`}
        >
          {/* The interactive Claude terminal is its own persistent session. It
              mounts on first CLI open and stays mounted (no restartNonce key)
              so toggling back and forth — or an Agent restart — never resets it. */}
          {cliMounted &&
            (themeReady ? (
              <TerminalViewport
                cwd={cwd}
                className="h-full w-full p-2"
                initialCommand={createClaudeCommand}
                autoFocus={active && view === "cli"}
                onOutput={handleTerminalOutput}
                registerWithBus={false}
                registerControls={(controls) => {
                  controlsRef.current = controls;
                }}
              />
            ) : (
              <div className="rt-text-muted flex h-full items-center justify-center gap-2 text-sm">
                <Icon name="sync" size="0.9em" className="animate-spin" />
                Preparing Claude’s full-colour terminal…
              </div>
            ))}
        </div>
      </div>
      <ClaudeControlBar
        status={status}
        view={view}
        permissionMode={agentPermissionMode}
        modelChoice={modelChoice}
        model={model ?? null}
        usage={usage}
        contextPct={contextPct}
        contextColor={contextColor}
        controlsDisabled={controlsDisabled}
        onViewChange={changeView}
        onPermissionModeChange={changePermissionMode}
        onModelChange={changeModel}
      />

      <ConfirmDialog
        open={pendingModel !== null}
        title="Switch model?"
        message={
          <>
            Your conversation continues on{" "}
            <span className="font-semibold">
              {pendingModel ? modelLabelFor(pendingModel) : ""}
            </span>
            . Any in-progress reply restarts on the new model.
          </>
        }
        confirmLabel={`Switch to ${pendingModel ? modelLabelFor(pendingModel) : ""}`}
        cancelLabel="Keep current"
        onConfirm={() => {
          if (pendingModel) applyModel(pendingModel);
          setPendingModel(null);
        }}
        onCancel={() => setPendingModel(null)}
      />
    </div>
  );
});

export default ClaudeCodePanel;
