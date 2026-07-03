import { useRef, useState } from "react";

import Icon from "../Icon";
import { usePresetsStore } from "../../store/presets";
import { useWorkspaceStore } from "../../store/workspace";
import { useWorkspacesStore } from "../../store/workspaces";

/**
 * Named workspace preset picker.
 *
 * Save — snapshots the current panels + grid under a user-chosen name.
 * Load  — applies a saved preset instantly; panels and positions swap in, and
 *         newly opened tabs inherit the layout too (via the layout template).
 * Delete — removes a preset with a single click on its × button.
 *
 * Duplicate names overwrite the existing preset rather than creating a copy.
 */
export function PresetsMenu() {
  const presets    = usePresetsStore((s) => s.presets);
  const save       = usePresetsStore((s) => s.save);
  const remove     = usePresetsStore((s) => s.remove);

  const panels     = useWorkspaceStore((s) => s.panels);
  const grid       = useWorkspaceStore((s) => s.grid);
  const loadLayout = useWorkspaceStore((s) => s.loadLayout);

  const [open, setOpen]       = useState(false);
  const [saving, setSaving]   = useState(false);
  const [name, setName]       = useState("");
  const inputRef              = useRef<HTMLInputElement>(null);

  function dismiss() {
    setOpen(false);
    setSaving(false);
    setName("");
  }

  function handleSave() {
    if (!name.trim()) return;
    save(name, panels, grid);
    dismiss();
  }

  function handleLoad(id: string) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    loadLayout(preset.panels, preset.grid);
    // An applied preset should follow the user across newly opened / reopened
    // tabs instead of snapping back to the default grid.
    useWorkspacesStore.getState().setLayoutTemplate({
      panels: preset.panels,
      grid: preset.grid,
      panelFontSizes: {},
    });
    dismiss();
  }

  function openSave() {
    setSaving(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? dismiss() : setOpen(true))}
        title="Workspace presets"
        className={`rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium ${
          open ? "rt-btn-active" : ""
        }`}
      >
        <Icon name="files" size={14} />
        <span className="hidden sm:inline">Presets</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={dismiss} />
          <div className="rt-menu absolute right-0 top-full z-50 mt-1 w-64">
            {/* Saved presets list */}
            {presets.length > 0 ? (
              <ul className="max-h-56 overflow-y-auto p-1">
                {presets.map((preset) => (
                  <li key={preset.id} className="group/preset flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleLoad(preset.id)}
                      className="rt-menu-item flex min-w-0 flex-1 flex-col items-start px-3 py-2 text-left"
                    >
                      <span className="block truncate text-sm font-medium">
                        {preset.name}
                      </span>
                      <span className="rt-text-faint text-[11px]">
                        {preset.panels.length} panel{preset.panels.length !== 1 ? "s" : ""}
                        {" · "}
                        {formatAge(preset.createdAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(preset.id)}
                      title="Delete preset"
                      className="rt-btn mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover/preset:opacity-100"
                    >
                      <Icon name="close" size={11} aria-label="Delete" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rt-text-faint px-3 py-3 text-xs">
                No saved presets yet.
              </p>
            )}

            {/* Divider + save section */}
            <div className="rt-divider-b mx-1 mt-0.5" />
            <div className="p-2">
              {saving ? (
                <div className="flex gap-1.5">
                  <input
                    ref={inputRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSave();
                      if (e.key === "Escape") { setSaving(false); setName(""); }
                    }}
                    placeholder="Preset name…"
                    className="rt-input min-w-0 flex-1 px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!name.trim()}
                    className="rt-btn-outline px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={openSave}
                  className="rt-menu-item flex w-full items-center gap-2 px-3 py-2 text-sm"
                >
                  <Icon name="plus" size={14} className="rt-text-muted shrink-0" />
                  Save current layout…
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatAge(ts: number): string {
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return "just now";
  if (hours <  1) return `${mins}m ago`;
  if (days  <  1) return `${hours}h ago`;
  if (days  < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default PresetsMenu;
