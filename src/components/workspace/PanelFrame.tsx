import type { CSSProperties, ReactNode } from "react";

import Icon, { type IconName } from "../Icon";
import { useWorkspacesStore } from "../../store/workspaces";
import { PanelZoomContext } from "./panelZoom";

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
  /**
   * When true, the panel scales its own content (via {@link PanelZoomContext})
   * instead of being CSS-scaled. Used for the terminal, whose xterm canvas
   * breaks selection under any scaled ancestor. See panelZoom.ts.
   */
  selfZoom?: boolean;
  children: ReactNode;
}

const STEP = 10;
const MIN  = 70;
const MAX  = 150;

export function PanelFrame({ icon, title, workspaceId, panelId, onClose, focused, onToggleFocus, selfZoom, children }: PanelFrameProps) {
  const fontSize = useWorkspacesStore(
    (s) => s.tabs.find((t) => t.id === workspaceId)?.panelFontSizes[panelId] ?? 100,
  );
  const setFont = useWorkspacesStore((s) => s.setPanelFontSize);
  const setPanelFontSize = (id: string, size: number) => setFont(workspaceId, id, size);

  const zoomOut = () => setPanelFontSize(panelId, fontSize - STEP);
  const zoomIn  = () => setPanelFontSize(panelId, fontSize + STEP);

  const scale = fontSize / 100;
  // CSS-scale the content for panels that use native browser selection. We use
  // `transform` (not `zoom`): WebKit hit-tests selection correctly under a
  // transform, but computes it in unscaled coords under `zoom`, so highlighting
  // lands offset. Origin top-left + a compensating 1/scale box makes the scaled
  // content fill the panel exactly, matching how `zoom` reflowed layout.
  const contentStyle: CSSProperties | undefined =
    selfZoom || scale === 1
      ? undefined
      : {
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          width: `${100 / scale}%`,
          height: `${100 / scale}%`,
        };

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
          {/* Fixed-width slot so the readout appearing at non-100% never
              shoves −/+ sideways (which made a double-click on a button land
              on the number instead). Sits to the left of both buttons so −/+
              stay adjacent. */}
          <div className="flex h-4 w-[30px] items-center justify-center">
            {fontSize !== 100 && (
              <button
                type="button"
                onClick={() => setPanelFontSize(panelId, 100)}
                title="Reset text size"
                className="rt-text-faint text-[9px] tabular-nums leading-none hover:opacity-70"
              >
                {fontSize}%
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={zoomOut}
            disabled={fontSize <= MIN}
            title="Decrease text size"
            className="rt-btn flex h-4 w-4 items-center justify-center text-[11px] font-semibold leading-none disabled:opacity-30"
          >
            −
          </button>
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

      {/* Content: transform-scaled for native-selection panels; self-zooming
          panels (terminal) read the factor from context and scale their font.
          overflow-hidden lets each panel's own internal scroller handle overflow. */}
      <div className="min-h-0 flex-1 overflow-hidden" style={contentStyle}>
        <PanelZoomContext.Provider value={scale}>
          {children}
        </PanelZoomContext.Provider>
      </div>
    </div>
  );
}

export default PanelFrame;
