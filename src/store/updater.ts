import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Update } from "@tauri-apps/plugin-updater";

/** Transient phase of the update check/install flow. */
export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "downloading"; pct: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

// The resolved `Update` handle isn't serializable and must not be persisted,
// so it lives module-scoped rather than in the store. There's only ever one
// pending update at a time.
let pendingUpdate: Update | null = null;

interface UpdaterState {
  phase: UpdatePhase;
  /** Version the user dismissed; persisted so the banner doesn't re-nag for it. */
  dismissedVersion: string | null;
  /**
   * Hit the update endpoint. `silent` keeps a failed check quiet (phase stays
   * idle) — used for the check-on-launch, where an unreachable endpoint
   * shouldn't surface an error to the user.
   */
  check: (opts?: { silent?: boolean }) => Promise<void>;
  /** Download + install the pending update, then relaunch. */
  install: () => Promise<void>;
  /** Hide the banner for the currently-available version. */
  dismiss: () => void;
}

export const useUpdaterStore = create<UpdaterState>()(
  persist(
    (set, get) => ({
      phase: { kind: "idle" },
      dismissedVersion: null,

      check: async ({ silent = false } = {}) => {
        const phase = get().phase.kind;
        if (phase === "checking" || phase === "downloading") return;
        set({ phase: { kind: "checking" } });
        pendingUpdate = null;
        try {
          const { check } = await import("@tauri-apps/plugin-updater");
          const update = await check();
          if (update) {
            pendingUpdate = update;
            set({ phase: { kind: "available", version: update.version, notes: update.body } });
          } else {
            set({ phase: { kind: "uptodate" } });
          }
        } catch (err) {
          console.error("Update check failed:", err);
          set({
            phase: silent
              ? { kind: "idle" }
              : {
                  kind: "error",
                  message:
                    "Could not reach the update server. This build may not have an update channel configured yet.",
                },
          });
        }
      },

      install: async () => {
        const update = pendingUpdate;
        if (!update) return;
        try {
          let total = 0;
          let received = 0;
          set({ phase: { kind: "downloading", pct: 0 } });
          await update.downloadAndInstall((event) => {
            if (event.event === "Started") {
              total = event.data.contentLength ?? 0;
            } else if (event.event === "Progress") {
              received += event.data.chunkLength;
              const pct = total > 0 ? Math.round((received / total) * 100) : 0;
              set({ phase: { kind: "downloading", pct } });
            } else if (event.event === "Finished") {
              set({ phase: { kind: "ready" } });
            }
          });
          set({ phase: { kind: "ready" } });
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        } catch (err) {
          console.error("Update install failed:", err);
          set({ phase: { kind: "error", message: "The update could not be installed." } });
        }
      },

      dismiss: () =>
        set((s) => ({
          dismissedVersion:
            s.phase.kind === "available" ? s.phase.version : s.dismissedVersion,
          phase: { kind: "idle" },
        })),
    }),
    {
      name: "retermina.updater",
      // Only the dismissal memory survives reloads; phase is always transient.
      partialize: (s) => ({ dismissedVersion: s.dismissedVersion }),
    },
  ),
);
