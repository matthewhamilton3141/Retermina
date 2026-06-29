/**
 * LoomPreview — a live thumbnail of a Loom, drawn entirely from its JSON.
 *
 * Mirrors the website's marketplace preview: the engine's backdrop (incl. the
 * saved gradient) behind a single mock terminal window — traffic-light chrome
 * plus a few faux command lines in the theme's accent. All from the Loom's
 * theme data; no screenshots, no live cascade.
 */
import { previewAccent, previewBackdropCss, previewPalette } from "../lib/themePreview";
import type { PresetTheme } from "../lib/preset";

export interface LoomPreviewProps {
  theme: PresetTheme;
  className?: string;
}

const TRAFFIC = ["#f87171", "#fbbf24", "#34d399"];

export default function LoomPreview({ theme, className }: LoomPreviewProps) {
  const palette = previewPalette(theme.themeId);
  const accent = previewAccent(theme.themeId, theme.accentColor);
  const backdrop = previewBackdropCss(theme.backdropStyle, theme.customBackdrop, accent);
  const isBrutalism = theme.themeId === "brutalism";

  const windowBorder = isBrutalism ? "2px solid #000" : `1px solid ${palette.text}1f`;
  const windowRadius = isBrutalism ? 0 : 5;
  const windowShadow = isBrutalism ? "3px 3px 0 #000" : "0 4px 14px rgba(0,0,0,0.14)";
  const muted = `${palette.text}99`;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        backgroundColor: palette.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      aria-hidden
    >
      {backdrop && <div style={{ position: "absolute", inset: 0, backgroundImage: backdrop }} />}

      <div
        style={{
          position: "relative",
          width: "86%",
          height: "74%",
          backgroundColor: palette.surface,
          border: windowBorder,
          borderRadius: windowRadius,
          boxShadow: windowShadow,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: "0.5rem",
          lineHeight: 1.5,
        }}
      >
        {/* macOS-style chrome */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            padding: "3px 5px",
            borderBottom: `1px solid ${palette.text}14`,
            flexShrink: 0,
          }}
        >
          {TRAFFIC.map((c) => (
            <span key={c} style={{ width: 5, height: 5, borderRadius: isBrutalism ? 0 : "50%", backgroundColor: c }} />
          ))}
        </div>

        {/* Faux terminal body, tinted by the Loom's accent. */}
        <div style={{ flex: 1, padding: "5px 6px", color: muted, overflow: "hidden" }}>
          <div><span style={{ color: accent }}>$</span> <span style={{ color: palette.text }}>iris run dev</span></div>
          <div>✦ ready in 312ms</div>
          <div style={{ color: accent }}>→ localhost:1420</div>
        </div>
      </div>
    </div>
  );
}
