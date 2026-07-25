import { useEffect, useRef, type RefObject } from "react";

import FloatingMenu from "../FloatingMenu";
import Icon from "../Icon";
import type {
  ClaudeSettingKind,
  ClaudeSettingOption,
} from "../../lib/claudeCommands";

export interface ClaudeSettingMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  kind: ClaudeSettingKind;
  options: readonly ClaudeSettingOption[];
  selectedIndex: number;
  activeValue: string;
  onSelectedIndexChange: (index: number) => void;
  onPick: (option: ClaudeSettingOption) => void;
  onClose: () => void;
}

/**
 * Inline picker for `/model` and `/mode` in the Agent composer — the same choices
 * as the bottom-dock pickers, but presented as a keyboard-driven menu that reads
 * as part of the agent surface rather than dropping into the raw CLI menu.
 */
export function ClaudeSettingMenu({
  anchorRef,
  kind,
  options,
  selectedIndex,
  activeValue,
  onSelectedIndexChange,
  onPick,
  onClose,
}: ClaudeSettingMenuProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const rect = anchorRef.current?.getBoundingClientRect();

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!rect) return null;

  return (
    <FloatingMenu
      x={rect.left}
      y={rect.top - 8}
      placement="above"
      onClose={onClose}
      className="rt-claude-menu w-[min(440px,calc(100vw-16px))] overflow-hidden"
    >
      <div className="rt-divider-b flex items-center gap-2 px-3 py-2">
        <span className="rt-accent-text flex h-6 w-6 items-center justify-center rounded-md bg-[var(--rt-accent-soft)]">
          <Icon name={kind === "model" ? "claudeLogo" : "spark"} size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            {kind === "model" ? "Switch model" : "Switch mode"}
          </p>
          <p className="rt-text-faint text-[10px]">
            {kind === "model"
              ? "Restarts the agent on the chosen model, same conversation"
              : "How much Claude may do on its own"}
          </p>
        </div>
      </div>

      <div className="max-h-[min(360px,52vh)] overflow-y-auto p-1.5">
        {options.length === 0 ? (
          <div className="px-3 py-5 text-center">
            <p className="text-xs font-medium">No matching {kind}</p>
          </div>
        ) : (
          options.map((option, index) => {
            const selected = index === selectedIndex;
            const active = option.value === activeValue;
            return (
              <button
                key={option.value}
                ref={selected ? activeRef : undefined}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                aria-selected={selected}
                onMouseEnter={() => onSelectedIndexChange(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(option);
                }}
                className="rt-menu-item flex w-full items-start gap-2.5 px-2.5 py-2 text-left"
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    active ? "bg-[var(--rt-accent)]" : "bg-[var(--rt-border)]"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[11px] font-semibold ${
                      selected || active ? "rt-accent-text" : ""
                    }`}
                  >
                    {option.label}
                  </span>
                  <span className="rt-text-muted mt-0.5 line-clamp-2 block text-[10px] leading-snug">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="rt-divider-b rt-text-faint flex items-center gap-3 px-3 py-1.5 text-[9px]">
        <span>↑↓ navigate</span>
        <span>↵ apply</span>
        <span>esc close</span>
      </div>
    </FloatingMenu>
  );
}

export default ClaudeSettingMenu;
