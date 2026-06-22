import { useEffect, useState } from "react";

import LaunchHub from "./views/LaunchHub";
import TerminalWorkspace from "./views/TerminalWorkspace";
import ThemeProvider from "./theme/ThemeProvider";
import TitleBar from "./components/TitleBar";
import CommandPalette from "./components/CommandPalette";
import FileSearch from "./components/FileSearch";
import UpdateBanner from "./components/UpdateBanner";
import { useAppStore } from "./store/app";
import { useSessionStore } from "./store/session";
import { useUpdaterStore } from "./store/updater";

function App() {
  const view          = useAppStore((s) => s.view);
  const workspaceCwd  = useAppStore((s) => s.workspaceCwd);
  const openTerminal  = useAppStore((s) => s.openTerminal);
  const goToLaunch    = useAppStore((s) => s.goToLaunch);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);

  // ── Session reconnect — run once on mount ────────────────────────────────
  useEffect(() => {
    const lastCwd = useSessionStore.getState().lastCwd;
    if (lastCwd) openTerminal(lastCwd);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Check for updates on launch — silent so an unreachable endpoint is a
  //    no-op. A found update surfaces via the dismissible UpdateBanner. ──────
  useEffect(() => {
    useUpdaterStore.getState().check({ silent: true });
  }, []);

  // ── Global shortcuts — Cmd/Ctrl+K (commands), Cmd/Ctrl+P (file search) ────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
            <TerminalWorkspace cwd={workspaceCwd} onLeave={goToLaunch} />
          ) : (
            <LaunchHub />
          )}
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <FileSearch open={fileSearchOpen} onClose={() => setFileSearchOpen(false)} cwd={workspaceCwd} />
      <UpdateBanner />
    </ThemeProvider>
  );
}

export default App;
