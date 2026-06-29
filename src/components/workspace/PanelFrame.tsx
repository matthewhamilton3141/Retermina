import type { ReactNode } from "react";

import Icon, { type IconName } from "../Icon";
import { useWorkspacesStore } from "../../store/workspaces";

export interface PanelFrameProps {
  icon: IconName;
  title: string;
  /** The tab this panel belongs to — font sizes are stored per tab. */
  workspaceId: string;
  /** Used to read/write per-panel font size from the workspace store. */
  panelId: string;
  onClose?: () => void;
  /** Whether this panel is currently maximized (focus mode). */
  focused?: boolean;
  /** Toggle focus mode for this panel. */
  onToggleFocus?: () => void;
  children: ReactNode;
}

const STEP = 10;
const MIN  = 70;
const MAX  = 150;

export function PanelFrame({ icon, title, workspaceId, panelId, onClose, focused, onToggleFocus, children }: PanelFrameProps) {
  const fontSize = useWorkspacesStore(
    (s) => s.tabs.find((t) => t.id === workspaceId)?.panelFontSizes[panelId] ?? 100,
  );
  const setFont = useWorkspacesStore((s) => s.setPanelFontSize);
  const setPanelFontSize = (id: string, size: number) => setFont(workspaceId, id, size);

  const zoomOut = () => setPanelFontSize(panelId, fontSize - STEP);
  const zoomIn  = () => setPanelFontSize(panelId, fontSize + STEP);

  return (
    <div className="rt-panel flex h-full w-full flex-col overflow-hidden">
      <div
        className="rt-panel-header panel-drag-handle flex cursor-move select-none items-center gap-2 px-2.5 py-1.5"
        onDoubleClick={onToggleFocus}
        title={onToggleFocus ? (focused ? "Double-click to restore" : "Double-click to maximize") : undefined}
      >
        <Icon name="drag" size={14} className="rt-text-faint shrink-0" />
        <Icon name={icon} size={14} className="rt-accent-text shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>

        {/* Zoom controls — panel-no-drag so clicks don't start a grid drag.
            stopPropagation on double-click so using the controls never toggles
            focus mode via the header's dblclick handler. */}
        <div
          className="panel-no-drag flex shrink-0 items-center gap-0.5"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={zoomOut}
            disabled={fontSize <= MIN}
            title="Decrease text size"
            className="rt-btn flex h-4 w-4 items-center justify-center text-[11px] font-semibold leading-none disabled:opacity-30"
          >
            −
          </button>
          {fontSize !== 100 && (
            <button
              type="button"
              onClick={() => setPanelFontSize(panelId, 100)}
              title="Reset text size"
              className="rt-text-faint min-w-[26px] text-center text-[9px] tabular-nums hover:opacity-70"
            >
              {fontSize}%
            </button>
          )}
          <button
            type="button"
            onClick={zoomIn}
            disabled={fontSize >= MAX}
            title="Increase text size"
            className="rt-btn flex h-4 w-4 items-center justify-center text-[11px] font-semibold leading-none disabled:opacity-30"
          >
            +
          </button>
        </div>

        {onToggleFocus && (
          <button
            type="button"
            onClick={onToggleFocus}
            onDoubleClick={(e) => e.stopPropagation()}
            title={focused ? "Restore panel" : "Maximize panel"}
            className="rt-btn panel-no-drag flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center"
          >
            <Icon name={focused ? "minimize" : "maximize"} size={13} aria-label={focused ? "Restore panel" : "Maximize panel"} />
          </button>
        )}

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            onDoubleClick={(e) => e.stopPropagation()}
            title={`Close ${title}`}
            className="rt-btn panel-no-drag flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center"
          >
            <Icon name="close" size={13} aria-label={`Close ${title}`} />
          </button>
        )}
      </div>

      {/* Content: zoom scales rem-based Tailwind utilities (unlike fontSize %).
          overflow-hidden lets each panel's own internal scroller handle overflow. */}
      <div
        className="min-h-0 flex-1 overflow-hidden"
        style={fontSize !== 100 ? { zoom: fontSize / 100 } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

export default PanelFrame;
