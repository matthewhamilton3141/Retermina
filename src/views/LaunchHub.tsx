import { useCallback, useRef, useState } from "react";

import Icon from "../components/Icon";
import ThemeSwitcher from "../components/ThemeSwitcher";
import LaunchActionCard, {
  type LaunchAction,
} from "../components/launch/LaunchActionCard";
import RecentWorkspacesPanel from "../components/launch/RecentWorkspacesPanel";
import type { RecentEntry } from "../store/recent";
import { useAppStore } from "../store/app";
import { useEditorStore } from "../store/editor";
import { createFile, readFile } from "../lib/fs";
import { runBackgroundCommand } from "../lib/system";
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

/**
 * The clean, distraction-free start screen shown before any terminal session
 * exists.
 */
export function LaunchHub() {
  const openTerminal = useAppStore((state) => state.openTerminal);
  const [pending, setPending] = useState<PendingId | null>(null);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── File / folder drag-and-drop from OS ────────────────────────────────────
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handleFileDrop = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const path = paths[0];
      // Heuristic: last path segment containing a "." is likely a file.
      const lastName = path.split("/").pop() ?? "";
      const isLikelyFile = lastName.includes(".");

      if (isLikelyFile) {
        // Open the file's parent directory as the workspace and load the file
        // in the Code panel.
        const parent = path.split("/").slice(0, -1).join("/") || "/";
        openTerminal(parent);
        try {
          await readFile(path); // confirm it's readable text before opening
          useEditorStore.getState().openFile(path);
        } catch {
          // Binary or unreadable — workspace still opened, editor skipped.
        }
      } else {
        // Directory — open directly as workspace.
        openTerminal(path);
      }
    },
    [openTerminal],
  );

  const { isDragOver } = useTauriFileDrop(dropZoneRef, handleFileDrop);

  function selectAction(id: PendingId) {
    setPending(id);
    setInput("");
    setStatus(null);
    setRunning(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancel() {
    setPending(null);
    setInput("");
    setStatus(null);
    setRunning(false);
  }

  async function submit() {
    const val = input.trim();
    if (!val || running) return;
    setRunning(true);
    setStatus(null);

    try {
      if (pending === "open-folder") {
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
          // Derive the cloned directory name from the URL
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
  ];

  const openWorkspace = (entry: RecentEntry) => {
    openTerminal(entry.path);
  };

  const meta = pending ? PENDING_META[pending] : null;

  return (
    <div ref={dropZoneRef} className="relative flex h-full flex-col">
      {/* Drop overlay — appears when the user hovers a file/folder over the hub */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-xl"
          style={{ background: "var(--rt-accent-soft)", border: "2px dashed var(--rt-accent)" }}>
          <Icon name="folderOpen" size={36} className="rt-accent-text" />
          <p className="rt-accent-text text-sm font-medium">Drop to open</p>
        </div>
      )}
      <header className="rt-toolbar flex items-center gap-2 px-3 py-2">
        <Icon name="terminal" size={15} className="rt-accent-text shrink-0" />
        <span className="text-sm font-medium">Retermina</span>
        <div className="ml-auto">
          <ThemeSwitcher align="right" />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-12 px-6 py-16">
          <header className="flex flex-col items-center gap-3 text-center">
            <span className="rt-surface flex h-14 w-14 items-center justify-center">
              <Icon name="terminal" size={28} className="rt-accent-text" />
            </span>
            <h1 className="text-3xl font-semibold tracking-tight">Retermina</h1>
            <p className="rt-text-muted text-sm">
              A customizable terminal workspace
            </p>
          </header>

          <section>
            <h2 className="rt-text-muted mb-3 text-xs font-semibold uppercase tracking-wider">
              Start
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {actions.map((action) => (
                <LaunchActionCard key={action.id} action={action} />
              ))}
            </div>

            {/* Inline action form — appears below cards when an action is pending */}
            {pending && meta && (
              <div className="rt-surface mt-4 flex flex-col gap-3 rounded-xl p-4">
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
                {status && (
                  <p className={`text-xs ${status.ok ? "rt-text-muted" : "text-red-500"}`}>
                    {status.msg}
                  </p>
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
