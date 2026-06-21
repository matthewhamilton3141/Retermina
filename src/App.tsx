import { useEffect, useState } from "react";

import LaunchHub from "./views/LaunchHub";
import TerminalWorkspace from "./views/TerminalWorkspace";
import ThemeProvider from "./theme/ThemeProvider";
import TitleBar from "./components/TitleBar";
import CommandPalette from "./components/CommandPalette";
import { useAppStore } from "./store/app";
import { useSessionStore } from "./store/session";

function App() {
  const view          = useAppStore((s) => s.view);
  const workspaceCwd  = useAppStore((s) => s.workspaceCwd);
  const openTerminal  = useAppStore((s) => s.openTerminal);
  const goToLaunch    = useAppStore((s) => s.goToLaunch);

  const [paletteOpen, setPaletteOpen] = useState(false);

  // ── Session reconnect — run once on mount ────────────────────────────────
  useEffect(() => {
    const lastCwd = useSessionStore.getState().lastCwd;
    if (lastCwd) openTerminal(lastCwd);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cmd+K / Ctrl+K — open command palette ───────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
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
    </ThemeProvider>
  );
}

export default App;
