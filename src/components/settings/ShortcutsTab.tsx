/** Settings ▸ Shortcuts — view and customize keyboard bindings. */
import { useEffect, useMemo, useState } from "react";

import Icon from "../Icon";
import { SectionTitle } from "./primitives";
import { COMMANDS, eventToChord, formatChord, type CommandId } from "../../lib/keybindings";
import { useKeybindingsStore, resolveBinding } from "../../store/keybindings";

export default function ShortcutsTab() {
  const overrides    = useKeybindingsStore((s) => s.overrides);
  const setBinding   = useKeybindingsStore((s) => s.setBinding);
  const resetBinding = useKeybindingsStore((s) => s.resetBinding);
  const resetAll     = useKeybindingsStore((s) => s.resetAll);

  // The command currently capturing a new chord, or null.
  const [recordingId, setRecordingId] = useState<CommandId | null>(null);

  // While recording, swallow keydowns (capture phase, before the global
  // handler) and turn the first real chord into a binding. Escape cancels.
  useEffect(() => {
    if (!recordingId) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") { setRecordingId(null); return; }
      const chord = eventToChord(e);
      if (!chord) return; // needs a modifier + key — keep waiting
      setBinding(recordingId, chord);
      setRecordingId(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recordingId, setBinding]);

  // Group commands in declaration order by their group label.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, typeof COMMANDS[number][]>();
    for (const cmd of COMMANDS) {
      if (!byGroup.has(cmd.group)) { byGroup.set(cmd.group, []); order.push(cmd.group); }
      byGroup.get(cmd.group)!.push(cmd);
    }
    return order.map((g) => ({ group: g, commands: byGroup.get(g)! }));
  }, []);

  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <div className="flex flex-col gap-6">
      <p className="rt-text-faint text-xs">
        Click a shortcut to record a new one. Bindings are kept unique — assigning
        a key already in use clears it from the other command.
      </p>

      {groups.map(({ group, commands }) => (
        <section key={group}>
          <SectionTitle>{group}</SectionTitle>
          <div className="flex flex-col gap-2">
            {commands.map((cmd) => {
              const chord = resolveBinding(cmd.id, overrides);
              const recording = recordingId === cmd.id;
              const overridden = cmd.id in overrides;
              return (
                <div key={cmd.id} className="rt-card flex items-center gap-3 p-3">
                  <span className="min-w-0 flex-1 text-sm font-medium">{cmd.label}</span>

                  {overridden && (
                    <button
                      type="button"
                      onClick={() => resetBinding(cmd.id)}
                      title="Reset to default"
                      className="rt-btn flex h-6 w-6 shrink-0 items-center justify-center"
                    >
                      <Icon name="sync" size={12} aria-label="Reset to default" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setRecordingId(recording ? null : cmd.id)}
                    className={`rt-btn-outline min-w-[5.5rem] shrink-0 px-2.5 py-1 text-center text-xs font-medium tabular-nums ${recording ? "rt-btn-active" : ""}`}
                    title="Click to record a shortcut"
                  >
                    {recording ? "Press keys…" : formatChord(chord)}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {hasOverrides && (
        <div>
          <button
            type="button"
            onClick={resetAll}
            className="rt-btn-outline flex items-center gap-2 px-3 py-1.5 text-sm"
          >
            <Icon name="sync" size={13} /> Reset all to defaults
          </button>
        </div>
      )}
    </div>
  );
}
