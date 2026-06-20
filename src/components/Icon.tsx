/**
 * Centralized, reusable Icon system for Retermina.
 *
 * Why this exists:
 * - The UI must never use emojis (they break cross-platform layout rendering).
 * - Every icon flows through one wrapper so that when the active theme changes
 *   (e.g. Neo-Brutalism vs. Soft Pastel) we can morph stroke weight, size, and
 *   color from a single place.
 *
 * lucide-react renders an <svg> whose paths use `stroke="currentColor"`, so any
 * Tailwind `text-*` class applied via `className` cascades into the SVG paths.
 * That is what lets icon accents/strokes change instantly with the theme.
 *
 * lucide-react is used strictly as a development placeholder set; swapping in a
 * bespoke icon set later only requires editing `iconMap` below.
 */
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  File,
  FilePlus,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Globe,
  GripVertical,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Sparkles,
  Square,
  Store,
  Terminal,
  Trash2,
  Upload,
  Download,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Semantic name -> concrete glyph. Consumers reference intent ("launch",
 * "terminate") rather than a specific lucide component, so the underlying
 * artwork can be replaced without touching call sites.
 */
export const iconMap = {
  // Launch hub actions
  launch: Play,
  newTerminal: Terminal,
  newFile: FilePlus,
  openFolder: FolderOpen,
  newFolder: FolderPlus,
  gitClone: GitBranch,

  // Iris
  iris: Sparkles,
  bot: Bot,
  spark: Zap,

  // Localhost tracker
  server: Server,
  localhost: Server,
  terminate: Square,
  stop: Square,

  // Workspace chrome
  terminal: Terminal,
  explorer: Files,
  files: Files,
  folder: Folder,
  folderOpen: FolderOpen,
  file: File,
  code: Code2,
  preview: Globe,
  settings: Settings,
  palette: Palette,
  theme: Palette,
  marketplace: Store,
  drag: GripVertical,
  search: Search,
  back: ArrowLeft,
  close: X,
  plus: Plus,
  trash: Trash2,
  dot: Circle,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,

  // Git macros
  push: ArrowUp,
  pull: ArrowDown,
  sync: RefreshCw,

  // Preset marketplace
  export: Upload,
  apply: Download,
  import: Download,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof iconMap;

export interface IconProps {
  /** Semantic icon name from {@link iconMap}. */
  name: IconName;
  /** Pixel size (number) or any CSS length (string). Defaults to 20. */
  size?: number | string;
  /**
   * Explicit stroke weight. When omitted, the active theme supplies the default
   * via the `.rt-icon` CSS rule (a CSS `stroke-width` overrides lucide's
   * presentation attribute), so strokes thicken/thin per engine automatically.
   * Passing this prop applies an inline width that overrides the theme default.
   */
  strokeWidth?: number;
  /**
   * Tailwind / CSS classes forwarded to the underlying <svg>. Because lucide
   * paths use `currentColor`, `text-*` classes here recolor the strokes.
   */
  className?: string;
  /** Explicit color override; prefer `className` text-* utilities when theming. */
  color?: string;
  /** Keep stroke width visually constant regardless of size. */
  absoluteStrokeWidth?: boolean;
  /** Accessible label. When omitted the icon is treated as decorative. */
  "aria-label"?: string;
  /** Optional click handler for interactive icon buttons. */
  onClick?: React.MouseEventHandler<SVGSVGElement>;
}

/**
 * The single entry point for rendering icons across the app.
 */
export function Icon({
  name,
  size = 20,
  strokeWidth,
  className,
  color,
  absoluteStrokeWidth,
  onClick,
  ...rest
}: IconProps) {
  const Glyph = iconMap[name];

  if (!Glyph) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[Icon] Unknown icon name: "${String(name)}"`);
    }
    return null;
  }

  const label = rest["aria-label"];

  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      absoluteStrokeWidth={absoluteStrokeWidth}
      // `rt-icon` lets the active theme set the default stroke weight in CSS;
      // an explicit `strokeWidth` becomes an inline style that overrides it.
      className={className ? `rt-icon ${className}` : "rt-icon"}
      style={strokeWidth !== undefined ? { strokeWidth } : undefined}
      onClick={onClick}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
    />
  );
}

export default Icon;
