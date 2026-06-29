/**
 * SettingsModal — the centralized, frosted-glass settings overlay.
 *
 * A single centered dialog organized into tabs: Theme, Appearance, Font,
 * Version. Each tab lives in its own file under ./settings; this module is just
 * the shell (tab rail + body + close handling). Every control writes straight to
 * the persisted Zustand app store, so changes survive restarts (the store is
 * mirrored to settings.json by the persist middleware).
 */
import { useEffect, useMemo, useRef, useState } from "react";

import Icon, { type IconName } from "./Icon";
import { useFocusTrap } from "../hooks/useFocusTrap";
import ThemeTab from "./settings/ThemeTab";
import AppearanceTab from "./settings/AppearanceTab";
import AccessibilityTab from "./settings/AccessibilityTab";
import FontTab from "./settings/FontTab";
import ShortcutsTab from "./settings/ShortcutsTab";
import VersionTab from "./settings/VersionTab";

type TabId = "theme" | "appearance" | "accessibility" | "font" | "shortcuts" | "version";

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: "theme",         label: "Theme",         icon: "palette" },
  { id: "appearance",    label: "Appearance",    icon: "layoutGrid" },
  { id: "accessibility", label: "Accessibility", icon: "accessibility" },
  { id: "font",          label: "Font",          icon: "font" },
  { id: "shortcuts",     label: "Shortcuts",     icon: "keyboard" },
  { id: "version",       label: "Version",       icon: "info" },
];

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<TabId>("theme");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Trap focus inside the dialog while open and restore it to the opener on
  // close (the gear button), so keyboard users don't tab into the app behind.
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const content = useMemo(() => {
    switch (tab) {
      case "theme":         return <ThemeTab />;
      case "appearance":    return <AppearanceTab />;
      case "accessibility": return <AccessibilityTab />;
      case "font":          return <FontTab />;
      case "shortcuts":     return <ShortcutsTab />;
      case "version":       return <VersionTab />;
    }
  }, [tab]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div ref={dialogRef} className="rt-card flex h-[34rem] max-h-[88vh] w-full max-w-3xl overflow-hidden shadow-2xl">
        {/* Tab rail */}
        <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-[var(--rt-border)] bg-[var(--rt-surface-strong)] p-3">
          <p className="rt-text-faint mb-2 px-2 text-sm font-semibold">Settings</p>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rt-menu-item flex items-center gap-2.5 px-3 py-2 text-left text-sm ${active ? "rt-btn-active" : ""}`}
              >
                <Icon name={t.icon} size={15} />
                <span className="font-medium">{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Tab body */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-[var(--rt-border)] px-5 py-3">
            <h2 className="text-sm font-semibold capitalize">{tab}</h2>
            <button type="button" onClick={onClose} title="Close settings" className="rt-btn flex h-7 w-7 items-center justify-center">
              <Icon name="close" size={15} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {content}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
