/** Settings ▸ Font — terminal typeface + size, plus the UI font picker. */
import { useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import Icon from "../Icon";
import { SectionTitle } from "./primitives";
import { useTheme } from "../../theme/ThemeProvider";
import { useAppStore, type CustomFont } from "../../store/app";
import {
  FONTS,
  FONT_CATEGORIES,
  THEME_FONT_CATEGORY,
  TERMINAL_FONTS,
  TERMINAL_FONT_SIZE,
  customFontStack,
  resolveTerminalFontStack,
} from "../../lib/fonts";
import { registerCustomFont } from "../../lib/fontRegistry";

/** Convert an ArrayBuffer to a base64 string in safe-sized chunks. */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface PendingUpload {
  fileName: string;
  base64: string;
  name: string;
  category: string;
}

// ── Terminal typeface section ────────────────────────────────────────────────

function TerminalFontSection() {
  const terminalFontId      = useAppStore((s) => s.terminalFontId);
  const setTerminalFontId   = useAppStore((s) => s.setTerminalFontId);
  const terminalFontSize    = useAppStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useAppStore((s) => s.setTerminalFontSize);
  const customFonts         = useAppStore((s) => s.customFonts);

  // Built-in mono options plus any uploaded fonts the user filed under the
  // "Terminal" category — sans-serif uploads stay out of the terminal picker.
  const options = useMemo(
    () => [
      ...TERMINAL_FONTS.map((f) => ({ id: f.id, name: f.name })),
      ...customFonts
        .filter((f) => f.category === "Terminal")
        .map((f) => ({ id: f.id, name: f.name })),
    ],
    [customFonts],
  );

  const previewStack = resolveTerminalFontStack(terminalFontId, customFonts);

  return (
    <section>
      <SectionTitle>Terminal</SectionTitle>
      <div className="rt-card flex flex-col gap-3 p-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Typeface</span>
          <select
            value={terminalFontId}
            onChange={(e) => setTerminalFontId(e.target.value)}
            className="rt-input px-2 py-1.5 text-sm"
            title="Monospace font for the terminal and Claude Code panels"
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--rt-border)] pt-3">
          <span className="text-sm font-medium">Size</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTerminalFontSize(terminalFontSize - 1)}
              disabled={terminalFontSize <= TERMINAL_FONT_SIZE.min}
              title="Smaller"
              className="rt-btn-outline flex h-7 w-7 items-center justify-center text-sm font-semibold leading-none disabled:opacity-40"
            >
              −
            </button>
            <span className="w-14 text-center text-sm font-medium tabular-nums">{terminalFontSize}px</span>
            <button
              type="button"
              onClick={() => setTerminalFontSize(terminalFontSize + 1)}
              disabled={terminalFontSize >= TERMINAL_FONT_SIZE.max}
              title="Larger"
              className="rt-btn-outline flex h-7 w-7 items-center justify-center text-sm font-semibold leading-none disabled:opacity-40"
            >
              +
            </button>
            {terminalFontSize !== TERMINAL_FONT_SIZE.default && (
              <button
                type="button"
                onClick={() => setTerminalFontSize(TERMINAL_FONT_SIZE.default)}
                className="rt-btn-outline ml-1 px-2 py-1 text-xs"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Live preview in the chosen face + size. */}
        <div
          className="rt-output overflow-x-auto whitespace-nowrap px-3 py-2"
          style={{ fontFamily: previewStack, fontSize: `${terminalFontSize}px`, lineHeight: 1.4 }}
        >
          <span className="rt-text-muted">$ </span>echo "The quick brown fox" 0123456789 =&gt;|
        </div>
      </div>
    </section>
  );
}

// ── UI font picker ───────────────────────────────────────────────────────────

export default function FontTab() {
  const { themeId }     = useTheme();
  const fontId          = useAppStore((s) => s.fontId);
  const setFontId       = useAppStore((s) => s.setFontId);
  const customFonts     = useAppStore((s) => s.customFonts);
  const addCustomFont   = useAppStore((s) => s.addCustomFont);
  const removeCustomFont = useAppStore((s) => s.removeCustomFont);

  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".ttf") && !lower.endsWith(".otf")) {
      setError("Only .ttf and .otf files are supported.");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      const baseName = file.name.replace(/\.(ttf|otf)$/i, "");
      setPending({ fileName: file.name, base64, name: baseName, category: "Uncategorized" });
    } catch {
      setError("Could not read that font file.");
    }
  };

  const confirmUpload = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      // Persist the bytes to disk and register the face for immediate use.
      const storedName = await invoke<string>("save_font", {
        fileName: pending.fileName,
        data: pending.base64,
      });
      const id = `cf-${Date.now()}`;
      const family = `rt-custom-${Date.now()}`;
      await registerCustomFont({ family, fileName: storedName }, pending.base64);
      const font: CustomFont = {
        id,
        name: pending.name.trim() || "Custom font",
        family,
        fileName: storedName,
        category: pending.category,
      };
      addCustomFont(font);
      setFontId(id);
      setPending(null);
    } catch (err) {
      setError(typeof err === "string" ? err : "Could not save the font.");
    } finally {
      setBusy(false);
    }
  };

  const renderFontRow = (
    id: string,
    name: string,
    description: string,
    stack: string | undefined,
    onRemove?: () => void,
  ) => {
    const active = fontId === id;
    return (
      <div key={id} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setFontId(id)}
          className={`rt-card flex flex-1 items-center gap-3 p-3 text-left ${active ? "rt-btn-active" : ""}`}
        >
          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            active ? "border-[var(--rt-accent)] bg-[var(--rt-accent)]" : "border-[var(--rt-border)]"
          }`}>
            {active && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--rt-accent-contrast, #fff)" }} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium" style={stack ? { fontFamily: stack } : undefined}>{name}</span>
            <span className="rt-text-faint block truncate text-xs">{description}</span>
          </span>
          <span className="rt-text-faint text-base" style={stack ? { fontFamily: stack } : undefined}>Ag</span>
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Delete font"
            className="rt-btn rt-btn-danger flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          >
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
    );
  };

  // Category that belongs to the active theme — its group gets a badge.
  const themeCategory = THEME_FONT_CATEGORY[themeId];
  const defaultFont = FONTS.find((f) => f.id === "default");

  // Bucket every font (built-in + uploaded) under its category, in the
  // canonical category order; only non-empty groups are shown. Unknown custom
  // categories fall back to "Uncategorized" so a font never disappears.
  const groups = FONT_CATEGORIES.map((cat) => ({
    cat,
    builtIns: FONTS.filter((f) => f.category === cat),
    customs: customFonts.filter(
      (f) => (FONT_CATEGORIES.includes(f.category) ? f.category : "Uncategorized") === cat,
    ),
  })).filter((g) => g.builtIns.length > 0 || g.customs.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Terminal typeface (drives the xterm canvas, not the UI chrome). */}
      <TerminalFontSection />

      {/* Upload */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Add a font</SectionTitle>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rt-btn-outline flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium"
          >
            <Icon name="export" size={13} /> Upload .ttf / .otf
          </button>
          <input ref={fileRef} type="file" accept=".ttf,.otf" className="hidden" onChange={onPick} />
        </div>

        {error && <p className="mb-2 text-xs text-red-500">{error}</p>}

        {/* Pending upload — name + category before commit */}
        {pending && (
          <div className="rt-card flex flex-col gap-3 p-3">
            <p className="text-xs font-medium">New font · <span className="rt-text-faint font-mono">{pending.fileName}</span></p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={pending.name}
                onChange={(e) => setPending({ ...pending, name: e.target.value })}
                placeholder="Display name"
                className="rt-input flex-1 px-2 py-1.5 text-sm"
              />
              <select
                value={pending.category}
                onChange={(e) => setPending({ ...pending, category: e.target.value })}
                className="rt-input px-2 py-1.5 text-sm"
                title="Assign this font to a thematic category"
              >
                {FONT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} onClick={confirmUpload} className="rt-btn-outline rt-btn-active px-3 py-1.5 text-sm disabled:opacity-50">
                {busy ? "Saving…" : "Add font"}
              </button>
              <button type="button" disabled={busy} onClick={() => setPending(null)} className="rt-btn px-2 py-1.5 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* System / default */}
      {defaultFont && (
        <section>
          <SectionTitle>System</SectionTitle>
          {renderFontRow(defaultFont.id, defaultFont.name, defaultFont.description, defaultFont.stack ?? undefined)}
        </section>
      )}

      {/* Grouped by thematic category */}
      {groups.map((g) => (
        <section key={g.cat}>
          <p className="rt-text-faint mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest">
            {g.cat}
            {g.cat === themeCategory && (
              <span className="rt-badge rounded px-1.5 py-0 text-[9px] normal-case tracking-normal">
                Theme match
              </span>
            )}
          </p>
          <div className="flex flex-col gap-2">
            {g.builtIns.map((f) => renderFontRow(f.id, f.name, f.description, f.stack ?? undefined))}
            {g.customs.map((f) =>
              renderFontRow(f.id, f.name, "Uploaded", customFontStack(f.family), () => removeCustomFont(f.id)),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
