import { useEffect, useRef, type RefObject } from "react";

import FloatingMenu from "../FloatingMenu";
import Icon from "../Icon";
import type { ClaudeSlashCommand } from "../../lib/claudeCommands";

export interface ClaudeSlashMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  commands: readonly ClaudeSlashCommand[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onPick: (command: ClaudeSlashCommand) => void;
  onClose: () => void;
}

export function ClaudeSlashMenu({
  anchorRef,
  commands,
  selectedIndex,
  onSelectedIndexChange,
  onPick,
  onClose,
}: ClaudeSlashMenuProps) {
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
        <span className="rt-accent-text flex h-6 w-6 items-center justify-center rounded-md bg-[var(--rt-accent-soft)] font-mono text-sm font-semibold">
          /
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Claude commands</p>
          <p className="rt-text-faint text-[10px]">Built-ins and skills from this session</p>
        </div>
        <span className="rt-text-faint text-[10px] tabular-nums">{commands.length}</span>
      </div>

      <div className="max-h-[min(360px,52vh)] overflow-y-auto p-1.5">
        {commands.length === 0 ? (
          <div className="px-3 py-5 text-center">
            <p className="text-xs font-medium">No matching command</p>
            <p className="rt-text-faint mt-1 text-[10px]">
              Custom slash commands can still be submitted directly.
            </p>
          </div>
        ) : (
          commands.map((command, index) => {
            const selected = index === selectedIndex;
            return (
              <button
                key={command.command}
                ref={selected ? activeRef : undefined}
                type="button"
                role="menuitem"
                aria-selected={selected}
                onMouseEnter={() => onSelectedIndexChange(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(command);
                }}
                className="rt-menu-item flex w-full items-start gap-2.5 px-2.5 py-2 text-left"
              >
                <Icon
                  name={command.group === "Skill" ? "spark" : command.behavior === "cli" ? "terminal" : "claudeLogo"}
                  size={13}
                  className={selected ? "rt-accent-text mt-0.5 shrink-0" : "rt-text-faint mt-0.5 shrink-0"}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={`font-mono text-[11px] font-semibold ${selected ? "rt-accent-text" : ""}`}>
                      {command.usage}
                    </span>
                    <span className="rt-text-faint ml-auto shrink-0 text-[9px] uppercase tracking-[0.1em]">
                      {command.group}
                    </span>
                  </span>
                  <span className="rt-text-muted mt-0.5 line-clamp-2 block text-[10px] leading-snug">
                    {command.description}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="rt-divider-b rt-text-faint flex items-center gap-3 px-3 py-1.5 text-[9px]">
        <span>↑↓ navigate</span>
        <span>↵ insert</span>
        <span>esc close</span>
      </div>
    </FloatingMenu>
  );
}

export default ClaudeSlashMenu;
