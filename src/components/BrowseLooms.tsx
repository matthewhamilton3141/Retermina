/**
 * BrowseLooms — the community gallery (read path), shown inside the Loom tab.
 * Fetches the published catalog, renders each Loom as a live preview tile, and
 * installs one on click (fetch → parsePreset → add + apply, all defended).
 */
import { useEffect, useState } from "react";

import Icon from "./Icon";
import LoomPreview from "./LoomPreview";
import { fetchCatalog, type CatalogLoom } from "../lib/marketplace";
import { useLoomStore } from "../store/loom";

type FetchState =
  | { kind: "loading" }
  | { kind: "error"; msg: string }
  | { kind: "ok"; looms: CatalogLoom[] };

export default function BrowseLooms({ onBack }: { onBack: () => void }) {
  const installPreset = useLoomStore((s) => s.installPreset);
  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [installing, setInstalling] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchCatalog(ac.signal)
      .then((looms) => setState({ kind: "ok", looms }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState({ kind: "error", msg: e instanceof Error ? e.message : "Failed to load the gallery." });
      });
    return () => ac.abort();
  }, []);

  const install = async (c: CatalogLoom) => {
    setInstalling(c.preset.id);
    setNotice(null);
    try {
      await installPreset(c.preset);
      setNotice(`Installed & applied "${c.preset.name}".`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Install failed.");
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} title="Back to your Looms" className="rt-btn flex h-7 w-7 items-center justify-center">
          <Icon name="back" size={16} aria-label="Back" />
        </button>
        <p className="text-sm font-semibold">Community Looms</p>
      </div>

      {state.kind === "loading" && (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rt-skeleton aspect-[12/10] w-full rounded-md" />
          ))}
        </div>
      )}

      {state.kind === "error" && (
        <div className="rt-empty p-6 text-center">
          <p className="rt-text-muted text-xs">{state.msg}</p>
          <p className="rt-text-faint mt-1 text-[11px]">
            The gallery is published from GitHub — check your connection, or it may not be set up yet.
          </p>
        </div>
      )}

      {state.kind === "ok" && state.looms.length === 0 && (
        <div className="rt-empty p-6 text-center">
          <p className="rt-text-faint text-xs">No community Looms yet — be the first to share one.</p>
        </div>
      )}

      {state.kind === "ok" && state.looms.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {state.looms.map((c) => (
            <div key={c.preset.id} className="rt-card flex flex-col overflow-hidden">
              <LoomPreview
                theme={c.preset.theme}
                panels={c.preset.workspace.panels}
                grid={c.preset.workspace.grid}
                className="aspect-[12/10] w-full border-b border-[var(--rt-border)]"
              />
              <div className="flex flex-col gap-2 p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.preset.name}</p>
                  <p className="rt-text-faint truncate text-[11px]">
                    {c.author ? `by ${c.author}` : "community"}
                    {c.description ? ` · ${c.description}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => install(c)}
                  disabled={installing === c.preset.id}
                  className="rt-btn-outline rt-btn-active px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                >
                  {installing === c.preset.id ? "Installing…" : "Install"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {notice && <p className="text-xs text-[var(--rt-accent)]">{notice}</p>}
    </div>
  );
}
