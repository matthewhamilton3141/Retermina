import { useEffect, useRef, useState } from "react";

import Icon from "./Icon";
import { useTheme } from "../theme/ThemeProvider";

export interface ThemeSwitcherProps {
  className?: string;
  /**
   * Which edge of the menu lines up with the trigger. Use "right" when the
   * trigger sits near the right edge of the screen so the menu opens inward.
   */
  align?: "left" | "right";
}

/**
 * Compact engine picker. The trigger shows the active engine; the dropdown
 * lists all engines with a one-line description and marks the current one.
 * Selecting an engine flows through {@link useTheme}, which persists it and
 * swaps the global `data-theme` attribute.
 */
export function ThemeSwitcher({ className, align = "right" }: ThemeSwitcherProps) {
  const { themeId, theme, themes, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click or Escape while the menu is open.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change theme"
        className="rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium"
      >
        <Icon name="palette" size={14} />
        <span className="hidden sm:inline">{theme.label}</span>
        <Icon name="chevronDown" size={13} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Theme engine"
          className={`rt-menu absolute z-50 mt-2 w-60 p-1 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {themes.map((engine) => {
            const active = engine.id === themeId;
            return (
              <button
                key={engine.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(engine.id);
                  setOpen(false);
                }}
                className="rt-menu-item flex w-full items-start gap-2.5 px-2.5 py-2 text-left"
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {active ? (
                    <Icon name="dot" size={10} className="fill-current" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{engine.label}</span>
                  <span className="rt-text-muted mt-0.5 block text-xs leading-snug">
                    {engine.description}
                  </span>
                </span>
                <span
                  className="rt-theme-swatch mt-1 shrink-0"
                  style={{ backgroundColor: engine.accentColor }}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default ThemeSwitcher;
