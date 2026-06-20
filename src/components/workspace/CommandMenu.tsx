import { useRef, useState } from "react";
import Icon from "../Icon";
import { useAppStore } from "../../store/app";
import { createFile } from "../../lib/fs";
import { runBackgroundCommand } from "../../lib/system";

type CommandId = "newFile" | "openFolder" | "clone";

interface CommandDef {
  id: CommandId;
  label: string;
  icon: "newFile" | "openFolder" | "gitClone";
  placeholder: string;
  hint: string;
}

const COMMANDS: CommandDef[] = [
  {
    id: "newFile",
    label: "New File",
    icon: "newFile",
    placeholder: "filename.ts",
    hint: "Path relative to current workspace",
  },
  {
    id: "openFolder",
    label: "Open Folder",
    icon: "openFolder",
    placeholder: "/path/to/project",
    hint: "Absolute path to a directory",
  },
  {
    id: "clone",
    label: "Clone Git Repository",
    icon: "gitClone",
    placeholder: "https://github.com/user/repo.git",
    hint: "Clones into the current workspace directory",
  },
];

export interface CommandMenuProps {
  cwd: string | null;
}

/**
 * Dropdown toolbar menu for workspace-level actions: New File, Open Folder,
 * and Clone Git Repository. Each command opens an inline input rather than a
 * native dialog so no extra Tauri plugin is required.
 */
export function CommandMenu({ cwd }: CommandMenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<CommandId | null>(null);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [running, setRunning] = useState(false);
  const openTerminal = useAppStore((s) => s.openTerminal);
  const inputRef = useRef<HTMLInputElement>(null);

  function dismiss() {
    setOpen(false);
    setActive(null);
    setInput("");
    setStatus(null);
    setRunning(false);
  }

  function selectCommand(id: CommandId) {
    setActive(id);
    setInput("");
    setStatus(null);
    setRunning(false);
    // Focus the input on next tick after it mounts
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function run() {
    const val = input.trim();
    if (!val || running) return;
    setRunning(true);
    setStatus(null);

    try {
      if (active === "openFolder") {
        openTerminal(val);
        dismiss();
        return;
      }

      if (active === "newFile") {
        const path = cwd ? `${cwd}/${val}` : val;
        await createFile(path);
        setStatus({ ok: true, msg: `Created ${path}` });
        setTimeout(dismiss, 1400);
        return;
      }

      if (active === "clone") {
        const result = await runBackgroundCommand(`git clone ${val}`, cwd);
        if (result.code === 0) {
          setStatus({ ok: true, msg: "Cloned successfully." });
          setTimeout(dismiss, 1400);
        } else {
          setStatus({ ok: false, msg: result.stderr.trim() || "Clone failed." });
        }
        return;
      }
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setRunning(false);
    }
  }

  const activeDef = COMMANDS.find((c) => c.id === active);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? dismiss() : setOpen(true))}
        title="Workspace commands"
        className={`rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium ${
          open ? "rt-btn-active" : ""
        }`}
      >
        <Icon name="plus" size={14} />
        <span className="hidden sm:inline">Commands</span>
      </button>

      {open && (
        <>
          {/* Invisible backdrop — click outside to close */}
          <div className="fixed inset-0 z-40" onClick={dismiss} />

          <div className="rt-menu absolute right-0 top-full mt-1 w-72 z-50">
            {active === null ? (
              <ul className="p-1">
                {COMMANDS.map((cmd) => (
                  <li key={cmd.id}>
                    <button
                      type="button"
                      onClick={() => selectCommand(cmd.id)}
                      className="rt-menu-item flex w-full items-center gap-2.5 px-3 py-2 text-sm text-left"
                    >
                      <Icon
                        name={cmd.icon}
                        size={15}
                        className="rt-text-muted shrink-0"
                      />
                      {cmd.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setActive(null); setInput(""); setStatus(null); }}
                    className="rt-btn flex items-center gap-1 px-1.5 py-1 text-xs"
                  >
                    <Icon name="back" size={12} />
                  </button>
                  <span className="text-xs font-semibold">{activeDef?.label}</span>
                </div>

                {activeDef?.hint && (
                  <p className="text-xs rt-text-faint">{activeDef.hint}</p>
                )}

                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") run();
                    if (e.key === "Escape") dismiss();
                  }}
                  placeholder={activeDef?.placeholder}
                  disabled={running}
                  className="rt-input w-full px-2.5 py-1.5 text-xs"
                />

                {status && (
                  <p
                    className={`text-xs ${
                      status.ok ? "rt-text-muted" : "text-red-500"
                    }`}
                  >
                    {status.msg}
                  </p>
                )}

                <button
                  type="button"
                  onClick={run}
                  disabled={!input.trim() || running}
                  className="rt-btn-outline px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                >
                  {running ? "Running…" : "Run"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default CommandMenu;
