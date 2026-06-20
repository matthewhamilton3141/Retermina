import Icon from "../components/Icon";
import ThemeSwitcher from "../components/ThemeSwitcher";
import CommandMenu from "../components/workspace/CommandMenu";
import IrisBar from "../components/workspace/IrisBar";
import WorkspaceLayout from "../components/workspace/WorkspaceLayout";
import { prettyPath } from "../lib/format";
import { PANEL_KINDS, PANEL_META } from "../lib/workspaceLayout";
import { useWorkspaceStore } from "../store/workspace";

export interface TerminalWorkspaceProps {
  /** Working directory the terminal opened in (null = blank). */
  cwd?: string | null;
  /** Return to the Launch Hub. */
  onLeave: () => void;
}

/**
 * The Terminal Workspace. A slim top bar (navigation + panel toolbar) sits above
 * a modular drag-and-drop panel grid hosting the file explorer, terminal, and
 * localhost tracker widgets.
 */
export function TerminalWorkspace({ cwd = null, onLeave }: TerminalWorkspaceProps) {
  const title = cwd ? prettyPath(cwd) : "Blank Terminal";
  const panels = useWorkspaceStore((state) => state.panels);
  const togglePanel = useWorkspaceStore((state) => state.togglePanel);
  const resetLayout = useWorkspaceStore((state) => state.resetLayout);
  const visibleKinds = new Set(panels.map((panel) => panel.kind));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="rt-toolbar relative z-50 flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onLeave}
          title="Back to Launch Hub"
          className="rt-btn flex h-7 w-7 shrink-0 items-center justify-center"
        >
          <Icon name="back" size={16} aria-label="Back to Launch Hub" />
        </button>
        <Icon name="terminal" size={15} className="rt-accent-text shrink-0" />
        <span className="truncate text-sm font-medium" title={cwd ?? undefined}>
          {title}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {PANEL_KINDS.map((kind) => {
            const meta = PANEL_META[kind];
            const active = visibleKinds.has(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => togglePanel(kind)}
                aria-pressed={active}
                title={`${active ? "Hide" : "Show"} ${meta.label}`}
                className={`rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium ${
                  active ? "rt-btn-active" : ""
                }`}
              >
                <Icon name={meta.icon} size={14} />
                <span className="hidden sm:inline">{meta.label}</span>
              </button>
            );
          })}
          <div className="rt-divider mx-1 h-5 w-px" />
          <button
            type="button"
            onClick={resetLayout}
            title="Reset layout to default"
            className="rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium"
          >
            <Icon name="sync" size={14} />
            <span className="hidden sm:inline">Reset</span>
          </button>
          <div className="rt-divider mx-1 h-5 w-px" />
          <CommandMenu cwd={cwd} />
          <div className="rt-divider mx-1 h-5 w-px" />
          <ThemeSwitcher align="right" />
        </div>
      </header>

      <div className="min-h-0 flex-1 p-2">
        <WorkspaceLayout cwd={cwd} />
      </div>

      <IrisBar cwd={cwd} />
    </div>
  );
}

export default TerminalWorkspace;
