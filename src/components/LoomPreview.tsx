/**
 * LoomPreview — a live thumbnail of a Loom, drawn entirely from its JSON.
 *
 * Paints the engine's backdrop (incl. the saved gradient) and a scaled-down
 * copy of the actual panel grid in the theme's own colors. Each panel shows its
 * kind icon and skeleton "content" (a prompt line for terminals, indented lines
 * for code, rows for the file tree) so the thumbnail reads like the real
 * product — all mockup, no screenshots, no live cascade.
 */
import Icon from "./Icon";
import {
  GRID_COLS,
  GRID_ROWS,
  PANEL_META,
  type PanelKind,
  type WorkspaceGridItem,
  type WorkspacePanel,
} from "../lib/workspaceLayout";
import { previewAccent, previewBackdropCss, previewPalette } from "../lib/themePreview";
import type { PresetTheme } from "../lib/preset";

export interface LoomPreviewProps {
  theme: PresetTheme;
  panels: WorkspacePanel[];
  grid: WorkspaceGridItem[];
  className?: string;
}

type BodyStyle = "terminal" | "code" | "list" | "plain";

function bodyStyleFor(kind: PanelKind | undefined): BodyStyle {
  switch (kind) {
    case "terminal":
    case "claudeCode":
      return "terminal";
    case "codeView":
      return "code";
    case "fileExplorer":
    case "localhost":
      return "list";
    default:
      return "plain";
  }
}

/** A faint horizontal "text" bar. */
function Bar({ w, color, opacity = 0.18 }: { w: string; color: string; opacity?: number }) {
  return <span style={{ display: "block", height: 1.5, width: w, borderRadius: 1, backgroundColor: color, opacity }} />;
}

/** The skeleton body for one panel, varied by its kind. */
function PanelBody({ style, text, accent }: { style: BodyStyle; text: string; accent: string }) {
  if (style === "terminal") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <span style={{ height: 1.5, width: "8%", borderRadius: 1, backgroundColor: accent, opacity: 0.9 }} />
          <Bar w="55%" color={text} opacity={0.22} />
        </div>
        <Bar w="38%" color={text} />
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <span style={{ height: 1.5, width: "8%", borderRadius: 1, backgroundColor: accent, opacity: 0.9 }} />
          <Bar w="30%" color={text} opacity={0.22} />
        </div>
      </div>
    );
  }
  if (style === "code") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Bar w="45%" color={text} opacity={0.22} />
        <div style={{ paddingLeft: "12%" }}><Bar w="55%" color={text} /></div>
        <div style={{ paddingLeft: "12%", display: "flex", gap: 2 }}>
          <span style={{ height: 1.5, width: "18%", borderRadius: 1, backgroundColor: accent, opacity: 0.7 }} />
          <Bar w="30%" color={text} />
        </div>
        <div style={{ paddingLeft: "6%" }}><Bar w="40%" color={text} opacity={0.14} /></div>
      </div>
    );
  }
  if (style === "list") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {["70%", "55%", "62%", "48%"].map((w, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 2, paddingLeft: i === 1 || i === 2 ? "10%" : 0 }}>
            <span style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: text, opacity: 0.3, flexShrink: 0 }} />
            <Bar w={w} color={text} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Bar w="60%" color={text} opacity={0.2} />
      <Bar w="42%" color={text} />
      <Bar w="50%" color={text} opacity={0.14} />
    </div>
  );
}

export default function LoomPreview({ theme, panels, grid, className }: LoomPreviewProps) {
  const palette = previewPalette(theme.themeId);
  const accent = previewAccent(theme.themeId, theme.accentColor);
  const backdrop = previewBackdropCss(theme.backdropStyle, theme.customBackdrop, accent);
  const isBrutalism = theme.themeId === "brutalism";
  const panelRadius = isBrutalism ? 0 : 2;
  const panelBorder = isBrutalism ? "1px solid #000" : `1px solid ${palette.text}1f`;

  const kindById = new Map(panels.map((p) => [p.id, p.kind]));

  return (
    <div
      className={className}
      style={{ position: "relative", overflow: "hidden", backgroundColor: palette.bg }}
      aria-hidden
    >
      {backdrop && <div style={{ position: "absolute", inset: 0, backgroundImage: backdrop }} />}

      {grid.map((item) => {
        const kind = kindById.get(item.i);
        const meta = kind ? PANEL_META[kind] : undefined;
        return (
          <div
            key={item.i}
            style={{
              position: "absolute",
              left: `${(item.x / GRID_COLS) * 100}%`,
              top: `${(item.y / GRID_ROWS) * 100}%`,
              width: `${(item.w / GRID_COLS) * 100}%`,
              height: `${(item.h / GRID_ROWS) * 100}%`,
              padding: 1,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                height: "100%",
                backgroundColor: palette.surface,
                border: panelBorder,
                borderRadius: panelRadius,
                overflow: "hidden",
              }}
            >
              {/* Header: panel icon + a faint title bar. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  padding: "2px 3px",
                  borderBottom: `1px solid ${palette.text}14`,
                }}
              >
                {meta && (
                  <span style={{ display: "flex", color: accent, opacity: 0.85 }}>
                    <Icon name={meta.icon} size={7} strokeWidth={2.5} />
                  </span>
                )}
                <Bar w="45%" color={palette.text} opacity={0.28} />
              </div>
              {/* Body: kind-specific skeleton content. */}
              <div style={{ flex: 1, padding: 3, overflow: "hidden" }}>
                <PanelBody style={bodyStyleFor(kind)} text={palette.text} accent={accent} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
