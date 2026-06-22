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
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Columns,
  File,
  FilePlus,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitCompare,
  Globe,
  GripVertical,
  Info,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Rows,
  Search,
  Server,
  Settings,
  Sparkles,
  Square,
  Store,
  Terminal,
  Trash2,
  Type,
  Upload,
  Download,
  X,
  Zap,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

/** Claude logo SVG — stroke-based to match Lucide's outlined icon style. */
const ClaudeLogo = ({ size = 24, className, strokeWidth = 1.5, ...rest }: LucideProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden={rest["aria-hidden"]}
    aria-label={rest["aria-label"]}
    role={rest.role as string | undefined}
    style={rest.style as React.CSSProperties | undefined}
    onClick={rest.onClick as React.MouseEventHandler<SVGSVGElement> | undefined}
  >
    <path d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949z" />
    <path d="M6 10.949h1.488V8.102H6v2.847z" />
    <path d="M16.51 10.949H18V8.102h-1.49v2.847z" />
  </svg>
);

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

  // Iris / AI
  iris: Sparkles,
  bot: Bot,
  claudeLogo: ClaudeLogo,
  spark: Zap,

  // Localhost tracker
  server: Server,
  localhost: Server,
  terminate: Square,
  stop: Square,

  // Workspace chrome
  layoutGrid: LayoutGrid,
  terminal: Terminal,
  explorer: Files,
  files: Files,
  folder: Folder,
  folderOpen: FolderOpen,
  file: File,
  code: Code2,
  gitDiff: GitCompare,
  preview: Globe,
  settings: Settings,
  palette: Palette,
  theme: Palette,
  font: Type,
  info: Info,
  marketplace: Store,
  drag: GripVertical,
  columns: Columns,
  rows: Rows,
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
} satisfies Record<string, LucideIcon | typeof ClaudeLogo>;

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
