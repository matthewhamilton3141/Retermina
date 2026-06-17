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
 *
 * The ThemeSwitcher lives in a sticky top bar (not absolutely positioned inside
 * a scrollable container) so:
 *   1. The dropdown is never clipped by overflow-y-auto.
 *   2. It mirrors the exact position used in TerminalWorkspace's toolbar,
 *      keeping the UI consistent across views.
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
    // rt-app drives the per-theme background / foreground tokens.
    // flex-col + h-screen keeps the sticky header at the top while the body
    // scrolls independently beneath it.
    <div className="rt-app flex h-screen flex-col">
      {/*
       * Sticky top bar — matches the same rt-toolbar / px-3 py-2 rhythm used
       * in TerminalWorkspace so the ThemeSwitcher button sits in the same
       * visual slot regardless of which view is active.
       */}
      <header className="rt-toolbar flex items-center gap-2 px-3 py-2">
        {/* Left: branding mark */}
        <Icon name="terminal" size={15} className="rt-accent-text shrink-0" />
        <span className="text-sm font-medium">Retermina</span>

        {/* Right: theme switcher — align="right" opens the menu leftward */}
        <div className="ml-auto">
          <ThemeSwitcher align="right" />
        </div>
      </header>

      {/*
       * Scrollable body. overflow-y-auto is on this inner div, NOT on the
       * outer wrapper, so the sticky header (and its dropdown) are never
       * clipped.
       */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-12 px-6 py-16">
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
    </div>
  );
}

export default LaunchHub;