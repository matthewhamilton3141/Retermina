import Icon from "./Icon";
import { useUpdaterStore } from "../store/updater";

/**
 * Floating toast surfaced when a check finds a newer version. Mounted at the
 * app root so it shows on both the Launch Hub and inside a workspace. The
 * check itself runs on launch (App.tsx); this only renders the result.
 *
 * Dismissing remembers the version (persisted), so the same update won't
 * re-nag on the next launch — but a newer one will.
 */
export function UpdateBanner() {
  const phase            = useUpdaterStore((s) => s.phase);
  const dismissedVersion = useUpdaterStore((s) => s.dismissedVersion);
  const install          = useUpdaterStore((s) => s.install);
  const dismiss          = useUpdaterStore((s) => s.dismiss);

  // Available but already dismissed → stay hidden until a newer version shows.
  const hidden =
    phase.kind === "idle" ||
    phase.kind === "checking" ||
    phase.kind === "uptodate" ||
    phase.kind === "error" ||
    (phase.kind === "available" && phase.version === dismissedVersion);

  if (hidden) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)]">
      <div className="rt-card pointer-events-auto flex w-full flex-col gap-3 rounded-xl p-4 shadow-lg">
        {phase.kind === "available" && (
          <>
            <div className="flex items-start gap-3">
              <span className="rt-card-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                <Icon name="sync" size={16} className="rt-accent-text" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  Update available
                  <span className="rt-text-faint ml-1.5 font-mono text-xs">
                    {phase.version}
                  </span>
                </p>
                {phase.notes && (
                  <p className="rt-text-faint mt-0.5 line-clamp-3 whitespace-pre-line text-xs">
                    {phase.notes}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={dismiss}
                title="Dismiss"
                className="rt-btn flex h-6 w-6 shrink-0 items-center justify-center"
              >
                <Icon name="close" size={12} aria-label="Dismiss" />
              </button>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={dismiss}
                className="rt-btn px-2.5 py-1 text-xs font-medium"
              >
                Later
              </button>
              <button
                type="button"
                onClick={install}
                className="rt-btn-outline rt-btn-active flex items-center gap-1.5 px-3 py-1 text-xs font-medium"
              >
                <Icon name="apply" size={13} /> Update &amp; Restart
              </button>
            </div>
          </>
        )}

        {phase.kind === "downloading" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Downloading update…</p>
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--rt-surface-hover)]">
                <div
                  className="h-full rounded-full bg-[var(--rt-accent)] transition-all"
                  style={{ width: `${phase.pct}%` }}
                />
              </div>
              <span className="text-xs tabular-nums">{phase.pct}%</span>
            </div>
          </div>
        )}

        {phase.kind === "ready" && (
          <p className="text-sm text-[var(--rt-accent)]">
            Update installed — relaunching…
          </p>
        )}
      </div>
    </div>
  );
}

export default UpdateBanner;
