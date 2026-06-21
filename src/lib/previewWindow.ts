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
 * On close the window's `onCloseRequested` handler fires; we find the PID
 * bound to `url`'s port and kill it so no zombie dev-server processes linger.
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

  // Intercept close: kill the associated dev server before the window destroys.
  win.onCloseRequested(async (event) => {
    if (portNum !== null) {
      try {
        const ports = await listListeningPorts();
        const match = ports.find((p) => p.port === portNum);
        if (match) {
          await killProcess(match.pid);
        }
      } catch {
        // Best-effort; don't block the close if the kill fails.
      }
    }
    // Allow the window to close normally.
    event.preventDefault();  // prevent default so we can control the flow
    await win.destroy();
  });
}

/** True if the preview window is currently open. */
export async function isPreviewOpen(): Promise<boolean> {
  const win = await WebviewWindow.getByLabel(PREVIEW_LABEL);
  return win !== null;
}

/** Close the preview window and kill its server, if open. */
export async function closePreviewWindow(): Promise<void> {
  const win = await WebviewWindow.getByLabel(PREVIEW_LABEL);
  if (win) {
    await win.close();
  }
}
