import { useCallback, useEffect, useRef, useState } from "react";

import Icon from "../components/Icon";
import SettingsModal from "../components/SettingsModal";
import LaunchActionCard, {
  type LaunchAction,
} from "../components/launch/LaunchActionCard";
import RecentWorkspacesPanel from "../components/launch/RecentWorkspacesPanel";
import type { RecentEntry } from "../store/recent";
import { useAppStore } from "../store/app";
import { useRecentStore } from "../store/recent";
import { useEditorStore } from "../store/editor";
import { createFile, createDir, readFile, suggestDirectories, validateDirectory } from "../lib/fs";
import { runBackgroundCommand } from "../lib/system";
import { getTerminalCwd } from "../lib/terminalImport";
import { useTauriFileDrop } from "../hooks/useTauriFileDrop";

type PendingId = "new-file" | "open-folder" | "clone-repo";

const PENDING_META: Record<
  PendingId,
  { icon: "newFile" | "openFolder" | "gitClone"; label: string; placeholder: string; hint: string }
> = {
  "new-file": {
    icon: "newFile",
    label: "New File",
    placeholder: "/path/to/file.ts",
    hint: "Absolute path — the file will be created and opened for editing.",
  },
  "open-folder": {
    icon: "openFolder",
    label: "Open Folder",
    placeholder: "/path/to/project",
    hint: "Absolute path to an existing directory.",
  },
  "clone-repo": {
    icon: "gitClone",
    label: "Clone Git Repository",
    placeholder: "https://github.com/user/repo.git",
    hint: "Clones into your home directory and opens the workspace.",
  },
};

export function LaunchHub() {
  const openTerminal = useAppStore((state) => state.openTerminal);
  const recentEntries = useRecentStore((s) => s.entries);

  const [pending, setPending] = useState<PendingId | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Open-folder combobox state ─────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIdx, setSuggestionIdx] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLUListElement>(null);
  const comboboxRef = useRef<HTMLDivElement>(null);

  // Debounced suggestion fetch — only runs for open-folder
  useEffect(() => {
    if (pending !== "open-folder" || !input.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const id = window.setTimeout(async () => {
      try {
        const fsSuggestions = await suggestDirectories(input);

        // Prepend any recent workspaces whose path starts with the typed value
        const val = input.toLowerCase();
        const recentMatches = recentEntries
          .filter((e) => e.path.toLowerCase().startsWith(val) && e.path !== input)
          .map((e) => e.path);

        const merged = [...new Set([...recentMatches, ...fsSuggestions])].slice(0, 10);
        setSuggestions(merged);
        setShowSuggestions(merged.length > 0);
        setSuggestionIdx(-1);
      } catch {
        // ignore backend errors during suggestions
      }
    }, 150);

    return () => window.clearTimeout(id);
  }, [input, pending, recentEntries]);

  // Close dropdown when clicking outside the combobox
  useEffect(() => {
    if (!showSuggestions) return;
    const handler = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSuggestions]);

  // ── Terminal import ────────────────────────────────────────────────────────
  const [importState, setImportState] = useState<
    | { status: "idle" }
    | { status: "detecting" }
    | { status: "found"; cwd: string; app: string }
    | { status: "error"; msg: string }
  >({ status: "idle" });

  const runImport = useCallback(async () => {
    setImportState({ status: "detecting" });
    try {
      const result = await getTerminalCwd();
      setImportState({ status: "found", cwd: result.cwd, app: result.app });
    } catch (err) {
      setImportState({ status: "error", msg: String(err) });
      setTimeout(() => setImportState({ status: "idle" }), 3000);
    }
  }, []);

  useEffect(() => {
    const onFocus = () => {
      if (importState.status !== "idle") return;
      getTerminalCwd()
        .then((result) =>
          setImportState({ status: "found", cwd: result.cwd, app: result.app }),
        )
        .catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [importState.status]);

  const confirmImport = useCallback(() => {
    if (importState.status !== "found") return;
    openTerminal(importState.cwd);
    setImportState({ status: "idle" });
  }, [importState, openTerminal]);

  // ── OS file/folder drag-and-drop ──────────────────────────────────────────
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handleFileDrop = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const path = paths[0];
      const lastName = path.split("/").pop() ?? "";
      const isLikelyFile = lastName.includes(".");

      if (isLikelyFile) {
        const parent = path.split("/").slice(0, -1).join("/") || "/";
        openTerminal(parent);
        try {
          await readFile(path);
          useEditorStore.getState().openFile(path);
        } catch {
          // binary or unreadable — workspace still opened
        }
      } else {
        openTerminal(path);
      }
    },
    [openTerminal],
  );

  const { isDragOver } = useTauriFileDrop(dropZoneRef, handleFileDrop);

  // ── Form helpers ──────────────────────────────────────────────────────────
  function selectAction(id: PendingId) {
    setPending(id);
    setInput("");
    setStatus(null);
    setRunning(false);
    setSuggestions([]);
    setShowSuggestions(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancel() {
    setPending(null);
    setInput("");
    setStatus(null);
    setRunning(false);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  function applySuggestion(path: string) {
    // Append a trailing slash so the next keystroke continues into that dir
    const withSlash = path.endsWith("/") ? path : path + "/";
    setInput(withSlash);
    setShowSuggestions(false);
    setSuggestionIdx(-1);
    inputRef.current?.focus();
  }

  async function createAndOpen(path: string) {
    try {
      await createDir(path);
      openTerminal(path);
    } catch (e) {
      setStatus({ ok: false, msg: `Could not create directory: ${String(e)}` });
      setRunning(false);
    }
  }

  async function submit() {
    const val = input.trim();
    if (!val || running) return;
    setRunning(true);
    setStatus(null);
    setShowSuggestions(false);

    try {
      if (pending === "open-folder") {
        const isDir = await validateDirectory(val);
        if (!isDir) {
          setStatus({ ok: false, msg: "Directory does not exist." });
          setRunning(false);
          return;
        }
        openTerminal(val);
        return;
      }

      if (pending === "new-file") {
        await createFile(val);
        const dir = val.includes("/") ? val.split("/").slice(0, -1).join("/") || "/" : ".";
        openTerminal(dir);
        return;
      }

      if (pending === "clone-repo") {
        const result = await runBackgroundCommand(`git clone ${val}`, null);
        if (result.code === 0) {
          const parts = val.replace(/\.git$/, "").split("/");
          const repoName = parts[parts.length - 1] ?? "repo";
          const home = (await runBackgroundCommand("echo $HOME", null)).stdout.trim();
          openTerminal(`${home}/${repoName}`);
        } else {
          setStatus({ ok: false, msg: result.stderr.trim() || "Clone failed." });
          setRunning(false);
        }
        return;
      }
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
      setRunning(false);
    }
  }

  // ── Actions list ──────────────────────────────────────────────────────────
  const actions: LaunchAction[] = [
    {
      id: "blank-terminal",
      icon: "launch",
      label: "Launch Blank Terminal",
      description: "Start a fresh shell session",
      onSelect: () => openTerminal(null),
    },
    {
      id: "new-file",
      icon: "newFile",
      label: "New File",
      description: "Create and edit a new file",
      onSelect: () => selectAction("new-file"),
    },
    {
      id: "open-folder",
      icon: "openFolder",
      label: "Open Folder",
      description: "Open an existing project",
      onSelect: () => selectAction("open-folder"),
    },
    {
      id: "clone-repo",
      icon: "gitClone",
      label: "Clone Git Repository",
      description: "Clone from a remote URL",
      onSelect: () => selectAction("clone-repo"),
    },
    {
      id: "import-terminal",
      icon: "terminal",
      label: "Import from Terminal",
      description: importState.status === "detecting"
        ? "Detecting…"
        : "Continue where you left off",
      onSelect: runImport,
    },
  ];

  const openWorkspace = (entry: RecentEntry) => openTerminal(entry.path);
  const meta = pending ? PENDING_META[pending] : null;

  // Keyboard handler for the open-folder combobox input
  function handleFolderKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestionIdx((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestionIdx((i) => Math.max(i - 1, -1));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && suggestionIdx >= 0) {
        e.preventDefault();
        applySuggestion(suggestions[suggestionIdx]);
        return;
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }
    if (e.key === "Enter") submit();
    if (e.key === "Escape") cancel();
  }

  return (
    <div ref={dropZoneRef} className="relative flex h-full flex-col">
      {/* Drop overlay */}
      {isDragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-xl"
          style={{ background: "var(--rt-accent-soft)", border: "2px dashed var(--rt-accent)" }}
        >
          <Icon name="folderOpen" size={36} className="rt-accent-text" />
          <p className="rt-accent-text text-sm font-medium">Drop to open</p>
        </div>
      )}

      <header className="rt-toolbar flex items-center gap-2 px-3 py-2">
        <Icon name="terminal" size={15} className="rt-accent-text shrink-0" />
        <span className="text-sm font-medium">Retermina</span>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          className="rt-btn-outline ml-auto flex items-center gap-1.5 px-2 py-1 text-xs font-medium"
        >
          <Icon name="settings" size={14} />
          <span>Settings</span>
        </button>
      </header>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-12 px-6 py-16">
          <header className="flex flex-col items-center gap-3 text-center">
            <span className="rt-surface flex h-14 w-14 items-center justify-center rounded-2xl">
              <Icon name="terminal" size={28} className="rt-accent-text" />
            </span>
            <h1 className="text-3xl font-semibold tracking-tight">Retermina</h1>
            <p className="rt-text-muted text-sm">A customizable terminal workspace</p>
          </header>

          {/* Terminal import banner */}
          {importState.status === "found" && (
            <div className="rt-surface flex items-center gap-3 rounded-xl px-4 py-3">
              <Icon name="terminal" size={18} className="rt-accent-text shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Continue in {importState.app}</p>
                <p className="rt-text-muted truncate font-mono text-xs">{importState.cwd}</p>
              </div>
              <button
                type="button"
                onClick={confirmImport}
                className="rt-btn-outline rt-btn-active shrink-0 px-3 py-1.5 text-xs font-medium"
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => setImportState({ status: "idle" })}
                className="rt-btn flex h-6 w-6 shrink-0 items-center justify-center"
              >
                <Icon name="close" size={12} aria-label="Dismiss" />
              </button>
            </div>
          )}
          {importState.status === "error" && (
            <p className="text-xs text-red-500">{importState.msg}</p>
          )}

          <section>
            <h2 className="rt-text-muted mb-3 text-xs font-semibold uppercase tracking-wider">
              Start
            </h2>

            {/* Primary action — full-width hero card */}
            {actions[0] && (
              <button
                type="button"
                onClick={actions[0].onSelect}
                className="rt-card group mb-3 flex w-full items-center gap-4 px-5 py-4 text-left transition hover:-translate-y-0.5"
              >
                <span className="rt-card-icon flex h-11 w-11 shrink-0 items-center justify-center">
                  <Icon name={actions[0].icon} size={22} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{actions[0].label}</span>
                  <span className="rt-text-muted mt-0.5 block text-xs">{actions[0].description}</span>
                </span>
                <Icon name="chevronRight" size={16} className="rt-text-faint ml-auto shrink-0" />
              </button>
            )}

            {/* Secondary actions — 2×2 grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {actions.slice(1).map((action) => (
                <LaunchActionCard key={action.id} action={action} />
              ))}
            </div>

            {/* Inline action form */}
            {pending && meta && (
              <div className="rt-surface mt-4 flex flex-col gap-3 rounded-xl p-4">
                {/* Header */}
                <div className="flex items-center gap-2">
                  <Icon name={meta.icon} size={15} className="rt-accent-text shrink-0" />
                  <span className="text-sm font-medium">{meta.label}</span>
                  <button
                    type="button"
                    onClick={cancel}
                    className="rt-btn ml-auto flex h-6 w-6 items-center justify-center"
                    aria-label="Cancel"
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>

                <p className="rt-text-faint text-xs">{meta.hint}</p>

                {/* Input — combobox for open-folder, plain for everything else */}
                {pending === "open-folder" ? (
                  <div ref={comboboxRef} className="relative">
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setStatus(null);
                        setShowSuggestions(true);
                      }}
                      onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                      onKeyDown={handleFolderKeyDown}
                      placeholder={meta.placeholder}
                      disabled={running}
                      autoComplete="off"
                      spellCheck={false}
                      className="rt-input w-full px-3 py-2 text-sm"
                    />

                    {/* Suggestions dropdown */}
                    {showSuggestions && suggestions.length > 0 && (
                      <ul
                        ref={suggestionsRef}
                        className="rt-menu absolute left-0 right-0 top-full z-50 mt-1 max-h-[180px] overflow-y-auto rounded-lg py-1 shadow-lg"
                      >
                        {suggestions.map((s, idx) => {
                          const isRecent = recentEntries.some((e) => e.path === s);
                          const name = s.replace(/\/$/, "").split("/").pop() ?? s;
                          const active = idx === suggestionIdx;
                          return (
                            <li key={s}>
                              <button
                                type="button"
                                onMouseEnter={() => setSuggestionIdx(idx)}
                                onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
                                className={`rt-menu-item flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                                  active ? "bg-[var(--rt-surface-hover)]" : ""
                                }`}
                              >
                                <Icon
                                  name={isRecent ? "folderOpen" : "folder"}
                                  size={13}
                                  className="rt-text-muted shrink-0"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-medium">{name}</span>
                                  <span className="rt-text-faint block truncate text-[10px] font-mono">{s}</span>
                                </span>
                                {isRecent && (
                                  <span className="rt-text-faint shrink-0 text-[9px] font-semibold uppercase tracking-wide">
                                    Recent
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : (
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submit();
                      if (e.key === "Escape") cancel();
                    }}
                    placeholder={meta.placeholder}
                    disabled={running}
                    className="rt-input w-full px-3 py-2 text-sm"
                  />
                )}

                {/* Status / error */}
                {status && (
                  <div className="flex items-center gap-2">
                    <p className={`flex-1 text-xs ${status.ok ? "rt-text-muted" : "text-red-500"}`}>
                      {status.msg}
                    </p>
                    {!status.ok && pending === "open-folder" && (
                      <button
                        type="button"
                        onClick={() => {
                          const val = input.trim();
                          if (val) createAndOpen(val);
                        }}
                        className="rt-btn-outline shrink-0 px-2.5 py-1 text-xs font-medium"
                      >
                        Create it?
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={submit}
                  disabled={!input.trim() || running}
                  className="rt-btn-outline self-end px-4 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  {running ? "Working…" : "Go"}
                </button>
              </div>
            )}
          </section>

          <RecentWorkspacesPanel onOpen={openWorkspace} />
        </div>
      </main>
    </div>
  );
}

export default LaunchHub;
