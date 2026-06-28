import { useEffect, useState } from "react";

import LaunchHub from "./views/LaunchHub";
import TerminalWorkspace from "./views/TerminalWorkspace";
import ThemeProvider from "./theme/ThemeProvider";
import TitleBar from "./components/TitleBar";
import CommandPalette from "./components/CommandPalette";
import FileSearch from "./components/FileSearch";
import ContentSearch from "./components/ContentSearch";
import UpdateBanner from "./components/UpdateBanner";
import { useAppStore } from "./store/app";
import { useEditorStore } from "./store/editor";
import { useSessionStore } from "./store/session";
import { useUpdaterStore } from "./store/updater";
import { useWorkspacesStore } from "./store/workspaces";

function App() {
  const view          = useAppStore((s) => s.view);
  const goToLaunch    = useAppStore((s) => s.goToLaunch);
  // cwd of the foreground workspace tab — drives the file/content search scope.
  const workspaceCwd  = useWorkspacesStore(
    (s) => s.tabs.find((t) => t.id === s.activeId)?.cwd ?? null,
  );

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [contentSearchOpen, setContentSearchOpen] = useState(false);

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

  // ── Global shortcuts — Cmd/Ctrl+K (commands), Cmd/Ctrl+P (file search),
  //    Cmd/Ctrl+Shift+F (content search) ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setContentSearchOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setFileSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <ThemeProvider>
      <div className="rt-app flex h-screen flex-col overflow-hidden">
        <TitleBar />
        <div className="flex-1 min-h-0">
          {view === "workspace" ? (
            <TerminalWorkspace onLeave={goToLaunch} />
          ) : (
            <LaunchHub />
          )}
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <FileSearch open={fileSearchOpen} onClose={() => setFileSearchOpen(false)} cwd={workspaceCwd} />
      <ContentSearch open={contentSearchOpen} onClose={() => setContentSearchOpen(false)} cwd={workspaceCwd} />
      <UpdateBanner />
    </ThemeProvider>
  );
}

export default App;
