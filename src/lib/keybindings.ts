/**
 * Keyboard command registry + chord utilities.
 *
 * Every globally-bindable action is declared once here as a {@link CommandDef}
 * with a default chord. The App-level handler matches keydown events against
 * the resolved bindings (defaults overlaid with the user's overrides from
 * store/keybindings) and dispatches the matching command id.
 *
 * Chords are stored in a normalized, platform-neutral string form using `mod`
 * for the primary accelerator (⌘ on macOS, Ctrl elsewhere), e.g. "mod+shift+k".
 * Matching keys off `event.code` (physical key) rather than `event.key` keeps
 * chords stable regardless of Shift remapping the produced character (so
 * "mod+shift+[" works even though Shift+[ types "{").
 */

export type CommandId =
  | "command-palette"
  | "file-search"
  | "content-search"
  | "open-settings"
  | "new-tab"
  | "close-tab"
  | "next-tab"
  | "prev-tab"
  | "reset-layout"
  | "back-to-launch";

export interface CommandDef {
  id: CommandId;
  label: string;
  group: string;
  /** Normalized default chord, or null for an action that ships unbound. */
  defaultBinding: string | null;
}

export const COMMANDS: readonly CommandDef[] = [
  { id: "command-palette", label: "Command palette",      group: "General",   defaultBinding: "mod+k" },
  { id: "file-search",     label: "Search files",         group: "General",   defaultBinding: "mod+p" },
  { id: "content-search",  label: "Search in files",      group: "General",   defaultBinding: "mod+shift+f" },
  { id: "open-settings",   label: "Open settings",        group: "General",   defaultBinding: "mod+," },
  { id: "new-tab",         label: "New workspace tab",    group: "Tabs",      defaultBinding: "mod+t" },
  { id: "close-tab",       label: "Close workspace tab",  group: "Tabs",      defaultBinding: "mod+w" },
  { id: "next-tab",        label: "Next tab",             group: "Tabs",      defaultBinding: "mod+shift+]" },
  { id: "prev-tab",        label: "Previous tab",         group: "Tabs",      defaultBinding: "mod+shift+[" },
  { id: "reset-layout",    label: "Reset panel layout",   group: "Workspace", defaultBinding: null },
  { id: "back-to-launch",  label: "Back to Launch Hub",   group: "Workspace", defaultBinding: null },
];

export const COMMAND_BY_ID: Record<CommandId, CommandDef> = Object.fromEntries(
  COMMANDS.map((c) => [c.id, c]),
) as Record<CommandId, CommandDef>;

export const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent || "");

/** Map a physical key code to a normalized chord token, or null if unusable. */
function normalizeCode(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3).toLowerCase(); // KeyK -> k
  if (code.startsWith("Digit")) return code.slice(5);             // Digit1 -> 1
  const map: Record<string, string> = {
    BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".",
    Slash: "/", Backslash: "\\", Minus: "-", Equal: "=",
    Semicolon: ";", Quote: "'", Backquote: "`", Space: "space",
    Enter: "enter", Tab: "tab",
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  };
  return map[code] ?? null;
}

const MODIFIER_CODES = new Set([
  "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
  "AltLeft", "AltRight", "MetaLeft", "MetaRight",
]);

/**
 * Build a normalized chord string from a keyboard event, or null if the event
 * carries no usable key, no modifier, or is a bare modifier press. Requiring at
 * least the primary accelerator keeps us from hijacking plain typing.
 */
export function eventToChord(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  // The non-primary base modifier (Ctrl on mac, ⌘ elsewhere) — rarely used but
  // captured so a chord that relies on it round-trips.
  const altMod = IS_MAC ? e.ctrlKey : e.metaKey;
  if (!mod && !altMod) return null;

  const key = normalizeCode(e.code);
  if (!key) return null;

  const parts: string[] = [];
  if (mod) parts.push("mod");
  if (altMod) parts.push(IS_MAC ? "ctrl" : "meta");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

const KEY_SYMBOLS: Record<string, string> = {
  up: "↑", down: "↓", left: "←", right: "→",
  space: "Space", enter: "↵", tab: "⇥",
};

/** Render a chord for display, e.g. "mod+shift+k" → "⌘⇧K" (mac) / "Ctrl+Shift+K". */
export function formatChord(chord: string | null): string {
  if (!chord) return "—";
  const tokens = chord.split("+");
  const key = tokens[tokens.length - 1];
  const mods = tokens.slice(0, -1);

  const label = (t: string) => KEY_SYMBOLS[t] ?? (t.length === 1 ? t.toUpperCase() : t);

  if (IS_MAC) {
    const order = ["ctrl", "alt", "shift", "mod"]; // ⌃⌥⇧⌘ then key
    const sym: Record<string, string> = { mod: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" };
    const prefix = order.filter((m) => mods.includes(m)).map((m) => sym[m]).join("");
    return prefix + label(key);
  }
  const sym: Record<string, string> = { mod: "Ctrl", meta: "Win", alt: "Alt", shift: "Shift", ctrl: "Ctrl" };
  const order = ["mod", "ctrl", "alt", "shift"];
  return [...order.filter((m) => mods.includes(m)).map((m) => sym[m]), label(key)].join("+");
}
