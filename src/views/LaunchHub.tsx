import Icon from "../components/Icon";
import ThemeSwitcher from "../components/ThemeSwitcher";
import LaunchActionCard, {
  type LaunchAction,
} from "../components/launch/LaunchActionCard";
import RecentWorkspacesPanel from "../components/launch/RecentWorkspacesPanel";
import type { RecentWorkspace } from "../types";
import { useAppStore } from "../store/app";

/**
 * The clean, distraction-free start screen shown before any terminal session
 * exists. Primary actions and recent-workspace selection are placeholders here
 * and get wired to the PTY workspace / dialogs in Step 3.
 */
export function LaunchHub() {
  const openTerminal = useAppStore((state) => state.openTerminal);

  const actions: LaunchAction[] = [
    {
      id: "blank-terminal",
      icon: "launch",
      label: "Launch Blank Terminal",
      description: "Start a fresh shell session",
      onSelect: () => openTerminal(null),
    },
    {
      id: "new-file",
      icon: "newFile",
      label: "New File",
      description: "Create and edit a new file",
      onSelect: () => console.info("[launch] new file"),
    },
    {
      id: "open-folder",
      icon: "openFolder",
      label: "Open Folder",
      description: "Open an existing project",
      onSelect: () => console.info("[launch] open folder"),
    },
    {
      id: "clone-repo",
      icon: "gitClone",
      label: "Clone Git Repository",
      description: "Clone from a remote URL",
      onSelect: () => console.info("[launch] clone repository"),
    },
  ];

  const openWorkspace = (workspace: RecentWorkspace) => {
    openTerminal(workspace.path);
  };

  return (
    <main className="rt-app relative min-h-screen overflow-y-auto">
      <ThemeSwitcher className="absolute right-4 top-4" align="right" />
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-12 px-6 py-16">
        <header className="flex flex-col items-center gap-3 text-center">
          <span className="rt-surface flex h-14 w-14 items-center justify-center">
            <Icon name="terminal" size={28} className="rt-accent-text" />
          </span>
          <h1 className="text-3xl font-semibold tracking-tight">Retermina</h1>
          <p className="rt-text-muted text-sm">
            A customizable terminal workspace
          </p>
        </header>

        <section>
          <h2 className="rt-text-muted mb-3 text-xs font-semibold uppercase tracking-wider">
            Start
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {actions.map((action) => (
              <LaunchActionCard key={action.id} action={action} />
            ))}
          </div>
        </section>

        <RecentWorkspacesPanel onOpen={openWorkspace} />
      </div>
    </main>
  );
}

export default LaunchHub;
