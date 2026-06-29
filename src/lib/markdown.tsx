/**
 * Minimal, dependency-free Markdown → React renderer for the Code panel's
 * preview toggle. Renders to React nodes (never an HTML string), so user file
 * content can't inject markup — text is escaped automatically by React, and
 * link hrefs are restricted to safe schemes.
 *
 * Supports a practical subset: ATX headings, fenced code, blockquotes, bullet
 * and numbered lists, horizontal rules, paragraphs, and inline bold / italic /
 * code / links.
 */
import { createElement, type ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)]+\))/;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length) {
    const m = INLINE.exec(rest);
    if (!m) { out.push(rest); break; }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={key++} className="rt-chip px-1 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("[")) {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      const href = /^(https?:|mailto:|\/|#)/.test(mm[2]) ? mm[2] : "#";
      out.push(
        <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="rt-accent-text underline">
          {mm[1]}
        </a>,
      );
    } else {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

const BLOCK_BREAK = /^(#{1,6}\s|```|>\s?|\s*[-*+]\s+|\s*\d+\.\s+|(?:-{3,}|\*{3,}|_{3,})\s*$)/;
const HEADING_SIZE = ["text-xl", "text-lg", "text-base", "text-sm", "text-sm", "text-xs"];

export function renderMarkdown(src: string): ReactNode {
  const lines = src.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      blocks.push(
        <pre key={key++} className="rt-code my-2 overflow-auto rounded p-2 font-mono text-[12px] whitespace-pre">
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      blocks.push(
        createElement(
          `h${level}`,
          { key: key++, className: `mt-3 mb-1 font-semibold ${HEADING_SIZE[level - 1]}` },
          renderInline(h[2]),
        ),
      );
      i++;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-3 border-[var(--rt-border)]" />);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push(
        <blockquote key={key++} className="rt-text-muted my-2 border-l-2 border-[var(--rt-accent)] pl-3">
          {renderInline(buf.join(" "))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      blocks.push(
        <ul key={key++} className="my-2 list-disc space-y-0.5 pl-5">
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      blocks.push(
        <ol key={key++} className="my-2 list-decimal space-y-0.5 pl-5">
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ol>,
      );
      continue;
    }

    if (line.trim() === "") { i++; continue; }

    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !BLOCK_BREAK.test(lines[i])) { buf.push(lines[i]); i++; }
    blocks.push(<p key={key++} className="my-2 leading-relaxed">{renderInline(buf.join(" "))}</p>);
  }

  return <div className="rt-md text-[13px]">{blocks}</div>;
}
