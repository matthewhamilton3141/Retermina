/**
 * Settings ▸ Loom — the preset library. Save the current theme + layout as a
 * Loom, browse saved Looms as a grid of live-rendered tiles (two across), and
 * apply / export / delete / import them.
 */
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import Icon from "../Icon";
import LoomPreview from "../LoomPreview";
import BrowseLooms from "../BrowseLooms";
import { SectionTitle } from "./primitives";
import { useLoomStore } from "../../store/loom";
import { resolveTheme } from "../../lib/theme";
import { shareUrl } from "../../lib/marketplace";

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

export default function LoomTab() {
  const presets             = useLoomStore((s) => s.presets);
  const saveCurrentAsPreset = useLoomStore((s) => s.saveCurrentAsPreset);
  const loadPreset          = useLoomStore((s) => s.loadPreset);
  const deletePreset        = useLoomStore((s) => s.deletePreset);
  const exportPreset        = useLoomStore((s) => s.exportPreset);
  const importPreset        = useLoomStore((s) => s.importPreset);

  const [name, setName]     = useState("");
  const [busy, setBusy]     = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [browsing, setBrowsing] = useState(false);

  if (browsing) return <BrowseLooms onBack={() => setBrowsing(false)} />;

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
    <div className="flex flex-col gap-6">
      {/* Community gallery entry */}
      <button
        type="button"
        onClick={() => setBrowsing(true)}
        className="rt-btn-outline rt-btn-active flex w-full items-center justify-center gap-2 px-3 py-2 text-sm font-medium"
      >
        <Icon name="marketplace" size={15} /> Browse community Looms
      </button>

      {/* Save current setup */}
      <section>
        <SectionTitle>Save current setup</SectionTitle>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            placeholder="Name this Loom…"
            className="rt-input min-w-0 flex-1 px-2.5 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={save}
            disabled={!name.trim()}
            className="rt-btn-outline flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            <Icon name="plus" size={13} /> Save
          </button>
        </div>
      </section>

      {/* Library — two tiles across */}
      <section>
        <SectionTitle>Your Looms</SectionTitle>
        {presets.length === 0 ? (
          <div className="rt-empty p-6 text-center">
            <p className="rt-text-faint text-xs">
              No saved Looms yet. Name your current theme + layout above, or import one below.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {presets.map((p) => (
              <div key={p.id} className="rt-card flex flex-col overflow-hidden">
                <LoomPreview
                  theme={p.theme}
                  className="aspect-[16/10] w-full border-b border-[var(--rt-border)]"
                />
                <div className="flex flex-col gap-2 p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="rt-text-faint truncate text-[11px]">
                      {p.workspace.panels.length} panel{p.workspace.panels.length !== 1 ? "s" : ""}
                      {" · "}{p.scope === "layout" ? "Layout only" : resolveTheme(p.theme.themeId).label}
                      {" · "}{formatAge(p.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => { loadPreset(p.id); setNotice({ kind: "ok", text: `Applied "${p.name}".` }); }}
                      className="rt-btn-outline flex-1 px-2.5 py-1 text-xs font-medium"
                      title="Apply this Loom"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => void openUrl(shareUrl(p))}
                      title="Share to the community gallery"
                      className="rt-btn flex h-7 w-7 shrink-0 items-center justify-center"
                    >
                      <Icon name="popOut" size={13} aria-label="Share to gallery" />
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
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Import */}
      <section>
        <button
          type="button"
          onClick={onImport}
          disabled={busy}
          className="rt-btn-outline rt-btn-active flex w-full items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          <Icon name="import" size={15} />
          {busy ? "Working…" : "Import from Loom file"}
        </button>

        {notice && (
          <p className={`mt-2 text-xs ${notice.kind === "ok" ? "text-[var(--rt-accent)]" : "text-red-500"}`}>
            {notice.text}
          </p>
        )}

        <p className="rt-text-faint mt-3 text-[11px] leading-relaxed">
          A Loom bundles your theme, accent, fonts, terminal &amp; accessibility
          settings, the backdrop, and the full panel layout. Live terminal
          sessions aren't captured — panels reopen empty.
        </p>
      </section>
    </div>
  );
}
