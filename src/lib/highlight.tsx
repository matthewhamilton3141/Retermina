/**
 * Read-only source highlighting for the Code panel.
 *
 * Prism tokenizes the file, and we render its token tree to React nodes (rather
 * than an HTML string) so the existing inline hex-colour swatches survive: every
 * plain-text leaf is still scanned for colour literals. Token colours come from
 * `--rt-syn-*` CSS variables (see index.css), so highlighting re-themes along
 * with the rest of the app and stays legible on both light and dark engines.
 *
 * Anything without a known grammar — or past the size cap — falls back to plain
 * text + swatches, never a crash.
 */
import type { ReactNode } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-toml";

// ── Hex colour swatches ──────────────────────────────────────────────────────

const HEX_COLOR_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;

/** Skip decoration above this size so huge files stay responsive. */
const MAX_SWATCH_CHARS = 200_000;
/** Tokenizing very large files is costly; above this we render plain text. */
const MAX_HIGHLIGHT_CHARS = 120_000;

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="mr-[0.35em] inline-block h-[0.85em] w-[0.85em] rounded-[2px] border border-[rgba(127,127,127,0.45)] align-[-0.1em]"
      style={{ backgroundColor: color }}
    />
  );
}

/** Render a plain string, inserting a swatch before each hex colour literal. */
function renderStringWithSwatches(text: string, keyBase: string): ReactNode {
  if (!text || text.length > MAX_SWATCH_CHARS || !text.includes("#")) return text;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  HEX_COLOR_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = HEX_COLOR_RE.exec(text)) !== null) {
    const hex = match[0];
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(<ColorSwatch key={`${keyBase}-sw-${key++}`} color={hex} />);
    nodes.push(hex);
    lastIndex = match.index + hex.length;
  }
  if (nodes.length === 0) return text;
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

// ── Prism token tree → React ─────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json",
  css: "css", scss: "css", sass: "css", less: "css",
  html: "markup", htm: "markup", xml: "markup", svg: "markup", vue: "markup",
  md: "markdown", markdown: "markdown",
  sh: "bash", bash: "bash", zsh: "bash",
  py: "python", rs: "rust",
  yml: "yaml", yaml: "yaml", toml: "toml",
};

function renderToken(token: string | Prism.Token, key: string): ReactNode {
  if (typeof token === "string") return renderStringWithSwatches(token, key);

  const aliases = Array.isArray(token.alias) ? token.alias.join(" ") : token.alias ?? "";
  const className = `token ${token.type}${aliases ? ` ${aliases}` : ""}`;

  const content = token.content;
  const children: ReactNode = Array.isArray(content)
    ? content.map((c, i) => renderToken(c, `${key}-${i}`))
    : renderToken(content, `${key}-0`);

  return <span key={key} className={className}>{children}</span>;
}

/**
 * Highlight `code` for `fileName`, returning React nodes for a <pre>. Falls back
 * to plain text (+ swatches) when the language is unknown or the file is large.
 */
export function highlightCode(code: string | null, fileName: string): ReactNode {
  if (!code) return code;

  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const lang = EXT_LANG[ext];
  const grammar = lang ? Prism.languages[lang] : undefined;

  if (!grammar || code.length > MAX_HIGHLIGHT_CHARS) {
    return renderStringWithSwatches(code, "plain");
  }

  return Prism.tokenize(code, grammar).map((t, i) => renderToken(t, String(i)));
}

export default highlightCode;
