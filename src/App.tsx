import LaunchHub from "./views/LaunchHub";
import TerminalWorkspace from "./views/TerminalWorkspace";
import ThemeProvider from "./theme/ThemeProvider";
import { useAppStore } from "./store/app";

function App() {
  const view = useAppStore((state) => state.view);
  const workspaceCwd = useAppStore((state) => state.workspaceCwd);
  const goToLaunch = useAppStore((state) => state.goToLaunch);

  return (
    <ThemeProvider>
      {view === "workspace" ? (
        <TerminalWorkspace cwd={workspaceCwd} onLeave={goToLaunch} />
      ) : (
        <LaunchHub />
      )}
    </ThemeProvider>
  );
}

export default App;
