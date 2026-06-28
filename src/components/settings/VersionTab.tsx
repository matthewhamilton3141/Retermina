/** Settings ▸ Version — app version + updater controls. */
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

import Icon from "../Icon";
import { SectionTitle } from "./primitives";
import { useUpdaterStore } from "../../store/updater";

export default function VersionTab() {
  const [version, setVersion] = useState<string>("…");
  // Shared with the launch-time check + the UpdateBanner, so a found update
  // stays consistent wherever it's surfaced.
  const state             = useUpdaterStore((s) => s.phase);
  const checkForUpdates   = useUpdaterStore((s) => s.check);
  const installUpdate     = useUpdaterStore((s) => s.install);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <section className="rt-card flex items-center gap-4 p-5">
        <div className="rt-card-icon flex h-12 w-12 items-center justify-center rounded-xl">
          <Icon name="terminal" size={24} className="rt-accent-text" />
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold">Retermina</p>
          <p className="rt-text-faint text-sm">Version <span className="font-mono">{version}</span></p>
        </div>
      </section>

      <section>
        <SectionTitle>Updates</SectionTitle>
        <div className="rt-card flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => checkForUpdates()}
              disabled={state.kind === "checking" || state.kind === "downloading"}
              className="rt-btn-outline flex items-center gap-2 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              <Icon name="sync" size={14} className={state.kind === "checking" ? "animate-spin" : ""} />
              {state.kind === "checking" ? "Checking…" : "Check for Updates"}
            </button>

            {state.kind === "available" && (
              <button type="button" onClick={installUpdate} className="rt-btn-outline rt-btn-active flex items-center gap-2 px-3 py-1.5 text-sm">
                <Icon name="apply" size={14} /> Download & Install {state.version}
              </button>
            )}
          </div>

          {state.kind === "uptodate" && (
            <p className="text-sm text-[var(--rt-accent)]">You're on the latest version.</p>
          )}
          {state.kind === "available" && state.notes && (
            <p className="rt-text-faint whitespace-pre-line text-xs">{state.notes}</p>
          )}
          {state.kind === "downloading" && (
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--rt-surface-hover)]">
                <div className="h-full rounded-full bg-[var(--rt-accent)] transition-all" style={{ width: `${state.pct}%` }} />
              </div>
              <span className="text-xs tabular-nums">{state.pct}%</span>
            </div>
          )}
          {state.kind === "ready" && (
            <p className="text-sm text-[var(--rt-accent)]">Update installed — relaunching…</p>
          )}
          {state.kind === "error" && (
            <p className="rt-text-faint text-xs">{state.message}</p>
          )}
        </div>
      </section>

      <p className="rt-text-faint text-center text-xs">
        Retermina · Built with Tauri, React &amp; xterm.js
      </p>
    </div>
  );
}
