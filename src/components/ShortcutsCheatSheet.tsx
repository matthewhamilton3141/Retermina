/**
 * A read-only keyboard-shortcuts overlay (⌘/), so the bindings are
 * discoverable without digging into Settings. Reflects live custom overrides
 * and the fixed ⌘1–9 tab jumps. Edit bindings in Settings ▸ Shortcuts.
 */
import { useEffect, useMemo, useRef } from "react";

import Icon from "./Icon";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { COMMANDS, formatChord, IS_MAC } from "../lib/keybindings";
import { useKeybindingsStore, resolveBinding } from "../store/keybindings";

export interface ShortcutsCheatSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function ShortcutsCheatSheet({ open, onClose }: ShortcutsCheatSheetProps) {
  const overrides = useKeybindingsStore((s) => s.overrides);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Group commands (that currently have a binding) by their group label, then
  // append the fixed tab-jump row that lives outside the rebindable registry.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, { label: string; chord: string }[]>();
    for (const cmd of COMMANDS) {
      const chord = resolveBinding(cmd.id, overrides);
      if (!chord) continue;
      if (!byGroup.has(cmd.group)) { byGroup.set(cmd.group, []); order.push(cmd.group); }
      byGroup.get(cmd.group)!.push({ label: cmd.label, chord: formatChord(chord) });
    }
    if (byGroup.has("Tabs")) {
      byGroup.get("Tabs")!.push({ label: "Jump to tab 1–9", chord: `${IS_MAC ? "⌘" : "Ctrl+"}1…9` });
    }
    return order.map((g) => ({ group: g, rows: byGroup.get(g)! }));
  }, [overrides]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div ref={dialogRef} className="rt-card flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--rt-border)] px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="keyboard" size={16} className="rt-accent-text" /> Keyboard shortcuts
          </h2>
          <button type="button" onClick={onClose} title="Close" className="rt-btn flex h-7 w-7 items-center justify-center">
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {groups.map(({ group, rows }) => (
            <section key={group}>
              <p className="rt-text-faint mb-2 text-[10px] font-semibold uppercase tracking-widest">{group}</p>
              <div className="flex flex-col gap-1">
                {rows.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-4 py-0.5 text-sm">
                    <span>{r.label}</span>
                    <kbd className="rt-chip px-2 py-0.5 font-mono text-xs tabular-nums">{r.chord}</kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="rt-text-faint border-t border-[var(--rt-border)] px-5 py-2 text-center text-xs">
          Customize these in Settings ▸ Shortcuts
        </footer>
      </div>
    </div>
  );
}
