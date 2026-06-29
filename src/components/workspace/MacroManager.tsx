/**
 * MacroManager — add/edit/delete user-defined Iris macros.
 *
 * A small modal opened from the Iris bar. Each macro is a title + match
 * keywords + a shell command; Iris merges them into its suggestion catalog
 * (always available, run as typed).
 */
import { useRef, useState } from "react";

import Icon from "../Icon";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useMacrosStore } from "../../store/macros";

export interface MacroManagerProps {
  open: boolean;
  onClose: () => void;
}

export default function MacroManager({ open, onClose }: MacroManagerProps) {
  const macros      = useMacrosStore((s) => s.macros);
  const addMacro    = useMacrosStore((s) => s.addMacro);
  const removeMacro = useMacrosStore((s) => s.removeMacro);

  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("");
  const [keywords, setKeywords] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  const canAdd = title.trim() && command.trim();
  const add = () => {
    if (!canAdd) return;
    addMacro({ title: title.trim(), command: command.trim(), keywords: keywords.trim() });
    setTitle(""); setCommand(""); setKeywords("");
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Manage Iris macros"
    >
      <div ref={dialogRef} className="rt-card flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--rt-border)] px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="spark" size={16} className="rt-accent-text" /> Iris macros
          </h2>
          <button type="button" onClick={onClose} title="Close" className="rt-btn flex h-7 w-7 items-center justify-center">
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {/* New macro */}
          <section className="rt-card flex flex-col gap-2 p-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Name (e.g. Deploy staging)"
              className="rt-input px-2.5 py-1.5 text-sm"
            />
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              placeholder="Command (e.g. npm run deploy:staging)"
              className="rt-input px-2.5 py-1.5 font-mono text-sm"
              spellCheck={false}
            />
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Extra keywords (optional, space-separated)"
              className="rt-input px-2.5 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={add}
              disabled={!canAdd}
              className="rt-btn-outline rt-btn-active flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              <Icon name="plus" size={13} /> Add macro
            </button>
          </section>

          {/* Existing */}
          {macros.length === 0 ? (
            <p className="rt-text-faint text-center text-xs">
              No macros yet. Add one above — it'll show in Iris (⌘ the bar at the bottom) ranked by your keywords.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {macros.map((m) => (
                <li key={m.id} className="rt-card flex items-center gap-2 p-2.5">
                  <Icon name="spark" size={14} className="rt-accent-text shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <p className="rt-text-faint truncate font-mono text-[11px]">{m.command}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMacro(m.id)}
                    title="Delete macro"
                    className="rt-btn rt-btn-danger flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                  >
                    <Icon name="trash" size={13} aria-label="Delete" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
