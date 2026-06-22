/**
 * Standalone preview window manager.
 *
 * Instead of embedding an iframe (sandboxed, no cross-origin WebSockets),
 * the Live Preview panel spawns a real native Tauri WebviewWindow pointed
 * directly at the localhost URL. This means:
 *   - HMR WebSockets connect natively — no sandbox restrictions
 *   - The user gets a resizable, focusable OS window rather than a panel pane
 *   - We can intercept the close event to kill the underlying dev server
 *
 * Only one preview window is allowed at a time (label "preview"). If one is
 * already open, openPreviewWindow() brings it to the front and navigates it.
 */

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listListeningPorts, killProcess } from "./system";

const PREVIEW_LABEL = "preview";

// Whether closing the preview window should also terminate the dev server bound
// to its port. Defaults to true (owning the server's lifecycle is the window's
// whole reason for existing), but the panel can flip it off when you want the
// server to keep running after the preview closes. Module-scoped so the value
// the native close button reads stays in sync with the panel toggle, even
// across panel remounts.
let killServerOnClose = true;

/** Current "stop the dev server when the preview closes" preference. */
export function getPreviewKillServerOnClose(): boolean {
  return killServerOnClose;
}

/** Set whether closing the preview also kills its dev server. */
export function setPreviewKillServerOnClose(value: boolean): void {
  killServerOnClose = value;
}

/** Extract the port number from a localhost URL, or null if unparseable. */
export function portFromUrl(url: string): number | null {
  try {
    const { port } = new URL(url);
    return port ? parseInt(port, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Open (or focus) the standalone preview window for `url`.
 *
 * On close the window's `onCloseRequested` handler closes the window, then —
 * if `killServerOnClose` is set and the port isn't Retermina's own dev server —
 * kills the dev server bound to `url`'s port so nothing lingers.
 */
export async function openPreviewWindow(url: string): Promise<void> {
  // If the window already exists, close it first so we can reopen at the new URL.
  const existing = await WebviewWindow.getByLabel(PREVIEW_LABEL);
  if (existing) {
    await existing.destroy();
    // Small yield so the label is freed before we recreate.
    await new Promise((r) => setTimeout(r, 80));
  }

  const portNum = portFromUrl(url);
  const hostname = url.replace(/^https?:\/\//, "").split("/")[0];

  const win = new WebviewWindow(PREVIEW_LABEL, {
    url,
    title: `Preview — ${hostname}`,
    width: 1280,
    height: 800,
    minWidth: 400,
    minHeight: 300,
    resizable: true,
    decorations: true,   // use native chrome so it feels like a real browser tab
    center: true,
  });

  // Take over the close so our cleanup runs deterministically. Re-entrancy
  // guard: a second close request (impatient double-click, or our own
  // closePreviewWindow racing the native button) would otherwise double-destroy
  // and bounce window focus — the flicker that looked like a Focus-mode toggle.
  let closing = false;
  win.onCloseRequested(async (event) => {
    // preventDefault MUST be called synchronously, before any await, or Tauri
    // has already resolved the close by the time we get back to it.
    event.preventDefault();
    if (closing) return;
    closing = true;

    // Destroy first so the window always closes promptly, regardless of whether
    // the best-effort server kill below succeeds.
    try {
      await win.destroy();
    } catch {
      // Already gone — nothing to do.
    }

    if (killServerOnClose && portNum !== null && !servesThisApp(portNum)) {
      try {
        const ports = await listListeningPorts();
        const match = ports.find((p) => p.port === portNum);
        if (match) await killProcess(match.pid);
      } catch {
        // Best-effort; the window is already closed.
      }
    }
  });
}

/**
 * True when `port` is the origin serving Retermina itself — i.e. the Vite dev
 * server during `tauri dev`. Killing that on close would tear down the main
 * window's own dev server and make the app reload, so we never do it.
 */
function servesThisApp(port: number): boolean {
  const own = window.location.port;
  return own !== "" && parseInt(own, 10) === port;
}

/** True if the preview window is currently open. */
export async function isPreviewOpen(): Promise<boolean> {
  const win = await WebviewWindow.getByLabel(PREVIEW_LABEL);
  return win !== null;
}

/**
 * Close the preview window if open. Routes through `win.close()` so the
 * `onCloseRequested` handler runs — meaning the dev server is killed or kept
 * per the current `killServerOnClose` preference, same as the native button.
 */
export async function closePreviewWindow(): Promise<void> {
  const win = await WebviewWindow.getByLabel(PREVIEW_LABEL);
  if (win) {
    await win.close();
  }
}
