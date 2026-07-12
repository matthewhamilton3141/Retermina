import { useEffect, useState } from "react";

import LaunchHub from "./views/LaunchHub";
import TerminalWorkspace from "./views/TerminalWorkspace";
import ThemeProvider from "./theme/ThemeProvider";
import TitleBar from "./components/TitleBar";
import CommandPalette from "./components/CommandPalette";
import FileSearch from "./components/FileSearch";
import ContentSearch from "./components/ContentSearch";
import UpdateBanner from "./components/UpdateBanner";
import Toaster from "./components/Toaster";
import ShortcutsCheatSheet from "./components/ShortcutsCheatSheet";
import { useAppStore } from "./store/app";
import { useEditorStore } from "./store/editor";
import { useSessionStore } from "./store/session";
import { useUpdaterStore } from "./store/updater";
import { useWorkspacesStore } from "./store/workspaces";
import { useKeybindingsStore, buildChordMap } from "./store/keybindings";
import { eventToChord, IS_MAC, type CommandId } from "./lib/keybindings";

function App() {
  const view          = useAppStore((s) => s.view);
  const goToLaunch    = useAppStore((s) => s.goToLaunch);
  // cwd of the foreground workspace tab — drives the file/content search scope.
  const workspaceCwd  = useWorkspacesStore(
    (s) => s.tabs.find((t) => t.id === s.activeId)?.cwd ?? null,
  );
  const hasTabs       = useWorkspacesStore((s) => s.tabs.length > 0);

  // Keep the workspace view mounted (just hidden) while on the Launch Hub, so a
  // trip back to the hub — e.g. to open another folder — doesn't unmount every
  // tab and tear down its live terminals, only to respawn them on return.
  // Latched per session so a fresh launch on the hub still spawns nothing until
  // the user actually enters a workspace; drops once no tabs remain to preserve.
  const [enteredWorkspace, setEnteredWorkspace] = useState(view === "workspace");
  useEffect(() => {
    if (view === "workspace") setEnteredWorkspace(true);
    else if (!hasTabs) setEnteredWorkspace(false);
  }, [view, hasTabs]);
  const keepWorkspaceMounted = view === "workspace" || (enteredWorkspace && hasTabs);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [contentSearchOpen, setContentSearchOpen] = useState(false);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

  // ── Session reconnect — run once on mount ────────────────────────────────
  // The view (Launch Hub vs. workspace) is restored by the persisted app store,
  // and the workspace's tabs + panel layout by the persisted workspaces store.
  // All that's left is re-opening the file that was showing in the Code panel
  // (its *path* only — never its contents), and only when a workspace is shown.
  useEffect(() => {
    if (useAppStore.getState().view !== "workspace") return;
    const { openFilePath } = useSessionStore.getState();
    if (openFilePath) void useEditorStore.getState().openFile(openFilePath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Check for updates on launch — silent so an unreachable endpoint is a
  //    no-op. A found update surfaces via the dismissible UpdateBanner. ──────
  useEffect(() => {
    useUpdaterStore.getState().check({ silent: true });
  }, []);

  // ── Global shortcuts ─────────────────────────────────────────────────────
  // Bindings come from the keybindings registry (defaults overlaid with the
  // user's persisted overrides). We match each keydown to a command id and
  // dispatch. Workspace-scoped commands are ignored on the Launch Hub so their
  // chords fall through there instead of being swallowed.
  const kbOverrides = useKeybindingsStore((s) => s.overrides);
  useEffect(() => {
    const chordMap = buildChordMap(kbOverrides);
    const workspaceOnly = new Set<CommandId>([
      "open-settings", "new-tab", "close-tab", "next-tab", "prev-tab",
      "reset-layout", "back-to-launch",
    ]);

    const dispatch = (id: CommandId) => {
      switch (id) {
        case "command-palette": setPaletteOpen((v) => !v); break;
        case "file-search":     setFileSearchOpen((v) => !v); break;
        case "content-search":  setContentSearchOpen((v) => !v); break;
        case "shortcuts-help":  setCheatSheetOpen((v) => !v); break;
        case "open-settings": {
          const s = useAppStore.getState();
          s.setSettingsOpen(!s.settingsOpen);
          break;
        }
        case "new-tab": useWorkspacesStore.getState().newWorkspace(null); break;
        case "close-tab": {
          // Route through the confirmation dialog, same as the tab close
          // button — closing tears down the tab's live PTYs.
          const { activeId, requestCloseWorkspace } = useWorkspacesStore.getState();
          if (activeId) requestCloseWorkspace(activeId);
          break;
        }
        case "next-tab":
        case "prev-tab": {
          const { tabs, activeId, setActive } = useWorkspacesStore.getState();
          if (tabs.length < 2) break;
          const i = Math.max(0, tabs.findIndex((t) => t.id === activeId));
          const delta = id === "next-tab" ? 1 : -1;
          setActive(tabs[(i + delta + tabs.length) % tabs.length].id);
          break;
        }
        case "reset-layout": {
          const { activeId, resetLayout } = useWorkspacesStore.getState();
          if (activeId) resetLayout(activeId);
          break;
        }
        case "back-to-launch": useAppStore.getState().goToLaunch(); break;
      }
    };

    const handler = (e: KeyboardEvent) => {
      // ⌘1–9 / Ctrl+1–9 jump straight to a tab (9 = last). Fixed, not in the
      // rebindable registry — conventional and would bloat the Shortcuts list.
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
        if (useAppStore.getState().view !== "workspace") return;
        e.preventDefault();
        const n = Number(e.code.slice(5));
        const { tabs, setActive } = useWorkspacesStore.getState();
        const target = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
        if (target) setActive(target.id);
        return;
      }

      const chord = eventToChord(e);
      if (!chord) return;
      const id = chordMap.get(chord);
      if (!id) return;
      if (workspaceOnly.has(id) && useAppStore.getState().view !== "workspace") return;
      e.preventDefault();
      dispatch(id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [kbOverrides]);

  return (
    <ThemeProvider>
      <div className="rt-app flex h-screen flex-col overflow-hidden">
        <TitleBar />
        <div className="relative flex-1 min-h-0">
          {/* Workspace stays mounted across a Launch Hub visit so live terminals
              survive; hidden (not unmounted) when the hub is showing. Use
              `display: none`, not `visibility: hidden` — the active tab inside
              sets `visibility: visible`, and a descendant's visibility overrides
              an ancestor's, so a merely-hidden workspace would paint straight
              through the hub. `display: none` can't be overridden, and React
              keeps the subtree mounted so the PTYs live on. */}
          {keepWorkspaceMounted && (
            <div
              className="absolute inset-0"
              style={{
                display: view === "workspace" ? undefined : "none",
                zIndex: 1,
              }}
              aria-hidden={view !== "workspace"}
            >
              <TerminalWorkspace onLeave={goToLaunch} />
            </div>
          )}
          {view !== "workspace" && (
            <div className="absolute inset-0 z-[2]">
              <LaunchHub />
            </div>
          )}
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <FileSearch open={fileSearchOpen} onClose={() => setFileSearchOpen(false)} cwd={workspaceCwd} />
      <ContentSearch open={contentSearchOpen} onClose={() => setContentSearchOpen(false)} cwd={workspaceCwd} />
      <UpdateBanner />
      <Toaster />
      <ShortcutsCheatSheet open={cheatSheetOpen} onClose={() => setCheatSheetOpen(false)} />
    </ThemeProvider>
  );
}

export default App;
