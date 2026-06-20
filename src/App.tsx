import LaunchHub from "./views/LaunchHub";
import TerminalWorkspace from "./views/TerminalWorkspace";
import ThemeProvider from "./theme/ThemeProvider";
import TitleBar from "./components/TitleBar";
import { useAppStore } from "./store/app";

function App() {
  const view = useAppStore((state) => state.view);
  const workspaceCwd = useAppStore((state) => state.workspaceCwd);
  const goToLaunch = useAppStore((state) => state.goToLaunch);

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
    </ThemeProvider>
  );
}

export default App;
