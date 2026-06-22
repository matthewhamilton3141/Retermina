/**
 * LoomManager — "Manage Presets" UI for the Settings → Theme / Retermina Loom
 * tab. Names + saves the current layout, lists saved Looms with quick-apply /
 * export / delete, and imports an external `.json` Loom file.
 */
import { useState } from "react";

import Icon from "./Icon";
import { useLoomStore } from "../store/loom";
import { resolveTheme } from "../lib/theme";

/** Relative-age label for a preset's creation timestamp. */
function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "just now";
  if (hours < 1) return `${mins}m ago`;
  if (days < 1) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Notice = { kind: "ok" | "err"; text: string } | null;

export function LoomManager() {
  const presets             = useLoomStore((s) => s.presets);
  const saveCurrentAsPreset = useLoomStore((s) => s.saveCurrentAsPreset);
  const loadPreset          = useLoomStore((s) => s.loadPreset);
  const deletePreset        = useLoomStore((s) => s.deletePreset);
  const exportPreset        = useLoomStore((s) => s.exportPreset);
  const importPreset        = useLoomStore((s) => s.importPreset);

  const [name, setName]     = useState("");
  const [busy, setBusy]     = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const save = () => {
    if (!name.trim()) return;
    saveCurrentAsPreset(name);
    setNotice({ kind: "ok", text: `Saved "${name.trim()}".` });
    setName("");
  };

  const onExport = async (id: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const path = await exportPreset(id);
      if (path) setNotice({ kind: "ok", text: "Exported Loom file." });
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Export failed." });
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const preset = await importPreset();
      if (preset) setNotice({ kind: "ok", text: `Imported "${preset.name}" and applied it.` });
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Import failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Save current layout */}
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Name this layout…"
          className="rt-input min-w-0 flex-1 px-2.5 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={save}
          disabled={!name.trim()}
          className="rt-btn-outline flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          <Icon name="plus" size={13} /> Save Current Layout
        </button>
      </div>

      {/* Saved presets */}
      {presets.length === 0 ? (
        <div className="rt-empty p-4 text-center">
          <p className="rt-text-faint text-xs">
            No saved Looms yet. Name your current theme + layout above, or import one below.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {presets.map((p) => (
            <li key={p.id} className="rt-card flex items-center gap-2 p-2.5">
              <span className="rt-card-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <Icon name="layoutGrid" size={15} className="rt-accent-text" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="rt-text-faint truncate text-[11px]">
                  {p.workspace.panels.length} panel{p.workspace.panels.length !== 1 ? "s" : ""}
                  {" · "}{resolveTheme(p.theme.themeId).label}
                  {" · "}{formatAge(p.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { loadPreset(p.id); setNotice({ kind: "ok", text: `Applied "${p.name}".` }); }}
                className="rt-btn-outline shrink-0 px-2.5 py-1 text-xs font-medium"
                title="Apply this Loom"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => onExport(p.id)}
                disabled={busy}
                title="Export to a .json file"
                className="rt-btn flex h-7 w-7 shrink-0 items-center justify-center disabled:opacity-40"
              >
                <Icon name="export" size={13} aria-label="Export" />
              </button>
              <button
                type="button"
                onClick={() => deletePreset(p.id)}
                title="Delete this Loom"
                className="rt-btn rt-btn-danger flex h-7 w-7 shrink-0 items-center justify-center"
              >
                <Icon name="trash" size={13} aria-label="Delete" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Import */}
      <button
        type="button"
        onClick={onImport}
        disabled={busy}
        className="rt-btn-outline rt-btn-active flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50"
      >
        <Icon name="import" size={15} />
        {busy ? "Working…" : "Import from Loom"}
      </button>

      {notice && (
        <p className={`text-xs ${notice.kind === "ok" ? "text-[var(--rt-accent)]" : "text-red-500"}`}>
          {notice.text}
        </p>
      )}

      <p className="rt-text-faint text-[11px] leading-relaxed">
        A Loom bundles your theme, accent, fonts and the full panel layout. Live
        terminal sessions aren't captured — panels reopen empty.
      </p>
    </div>
  );
}

export default LoomManager;
