import type { ReactNode } from "react";

import Icon, { type IconName } from "../Icon";

export interface PanelFrameProps {
  /** Glyph shown beside the title. */
  icon: IconName;
  /** Panel title shown in the drag bar. */
  title: string;
  /** Remove this panel from the workspace. Omit to hide the close button. */
  onClose?: () => void;
  children: ReactNode;
}

/**
 * Chrome shared by every workspace widget.
 *
 * The title bar carries the `panel-drag-handle` class, which react-grid-layout
 * uses as the drag handle, so panels only move when grabbed by their header
 * (leaving the body free for terminal input, scrolling, etc.). The close button
 * carries `panel-no-drag` so clicking it never starts a drag.
 */
export function PanelFrame({ icon, title, onClose, children }: PanelFrameProps) {
  return (
    <div className="rt-panel flex h-full w-full flex-col overflow-hidden">
      <div className="rt-panel-header panel-drag-handle flex cursor-move select-none items-center gap-2 px-2.5 py-1.5">
        <Icon name="drag" size={14} className="rt-text-faint shrink-0" />
        <Icon name={icon} size={14} className="rt-accent-text shrink-0" />
        <span className="truncate text-xs font-medium">{title}</span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            title={`Close ${title}`}
            className="rt-btn panel-no-drag ml-auto flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center"
          >
            <Icon name="close" size={13} aria-label={`Close ${title}`} />
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

export default PanelFrame;
