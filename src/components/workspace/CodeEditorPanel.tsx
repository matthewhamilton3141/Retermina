import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import Icon from "../Icon";
import { highlightCode } from "../../lib/highlight";
import { renderMarkdown } from "../../lib/markdown";
import { useEditorLayoutStore, useEditorStore } from "../../store/editor";
import DiffViewer from "./DiffViewer";
import FileExplorerPanel from "./FileExplorerPanel";

function displayPath(path: string | null, cwd: string | null): string {
  if (!path) return "No file open";
  if (cwd && path.startsWith(`${cwd.replace(/\/$/, "")}/`)) {
    return path.slice(cwd.replace(/\/$/, "").length + 1);
  }
  return path;
}

function CodeSurface({
  cwd,
  explorerVisible,
  onToggleExplorer,
}: {
  cwd: string | null;
  explorerVisible: boolean;
  onToggleExplorer: () => void;
}) {
  const selectedPath = useEditorStore((state) => state.selectedPath);
  const content = useEditorStore((state) => state.content);
  const loading = useEditorStore((state) => state.loading);
  const error = useEditorStore((state) => state.error);
  const diffMode = useEditorStore((state) => state.diffMode);
  const isEditing = useEditorStore((state) => state.isEditing);
  const editDraft = useEditorStore((state) => state.editDraft);
  const saving = useEditorStore((state) => state.saving);
  const saveError = useEditorStore((state) => state.saveError);
  const startEditing = useEditorStore((state) => state.startEditing);
  const setDraft = useEditorStore((state) => state.setDraft);
  const cancelEditing = useEditorStore((state) => state.cancelEditing);
  const saveEdits = useEditorStore((state) => state.saveEdits);
  const close = useEditorStore((state) => state.close);
  const revealLine = useEditorStore((state) => state.revealLine);
  const clearReveal = useEditorStore((state) => state.clearReveal);

  const fileName = selectedPath ? selectedPath.split("/").pop() : null;
  const pathLabel = displayPath(selectedPath, cwd);
  const canEdit = !!selectedPath && !loading && !error;
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(selectedPath ?? "");
  const [markdownPreview, setMarkdownPreview] = useState(true);
  const showMarkdown =
    isMarkdown && markdownPreview && !isEditing && !diffMode;

  const preRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (revealLine === null || content === null || diffMode || isEditing) return;
    const pre = preRef.current;
    if (!pre) return;
    const lineHeight = parseFloat(getComputedStyle(pre).lineHeight) || 19.5;
    pre.scrollTop = Math.max(0, (revealLine - 4) * lineHeight);
    clearReveal();
  }, [clearReveal, content, diffMode, isEditing, revealLine]);

  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editPreRef = useRef<HTMLPreElement | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);

  const syncOverlayScroll = useCallback(() => {
    const textarea = editTextareaRef.current;
    if (textarea && editPreRef.current) {
      editPreRef.current.scrollTop = textarea.scrollTop;
      editPreRef.current.scrollLeft = textarea.scrollLeft;
    }
  }, []);

  const matches = useMemo(() => {
    if (!isEditing || !findQuery) return [];
    const haystack = (editDraft ?? "").toLowerCase();
    const needle = findQuery.toLowerCase();
    const offsets: number[] = [];
    for (
      let index = haystack.indexOf(needle);
      index !== -1;
      index = haystack.indexOf(needle, index + needle.length)
    ) {
      offsets.push(index);
    }
    return offsets;
  }, [editDraft, findQuery, isEditing]);

  useEffect(() => {
    if (activeMatch !== 0 && activeMatch >= matches.length) setActiveMatch(0);
  }, [activeMatch, matches.length]);

  useEffect(() => {
    if (!isEditing) {
      setFindOpen(false);
      setFindQuery("");
      setReplaceQuery("");
      setActiveMatch(0);
    }
  }, [isEditing, selectedPath]);

  const selectMatch = useCallback(
    (nextIndex: number) => {
      const textarea = editTextareaRef.current;
      if (!textarea || matches.length === 0) return;
      const index = ((nextIndex % matches.length) + matches.length) % matches.length;
      const start = matches[index];
      textarea.focus();
      textarea.setSelectionRange(start, start + findQuery.length);
      requestAnimationFrame(syncOverlayScroll);
      setActiveMatch(index);
    },
    [findQuery, matches, syncOverlayScroll],
  );

  const replaceCurrent = useCallback(() => {
    if (matches.length === 0) return;
    const index = ((activeMatch % matches.length) + matches.length) % matches.length;
    const start = matches[index];
    const draft = editDraft ?? "";
    setDraft(
      draft.slice(0, start) +
        replaceQuery +
        draft.slice(start + findQuery.length),
    );
  }, [activeMatch, editDraft, findQuery, matches, replaceQuery, setDraft]);

  const replaceAll = useCallback(() => {
    if (!findQuery) return;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    setDraft((editDraft ?? "").replace(new RegExp(escaped, "gi"), replaceQuery));
  }, [editDraft, findQuery, replaceQuery, setDraft]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    editTextareaRef.current?.focus();
  }, []);

  return (
    <section className="rt-subsurface flex h-full min-w-0 flex-1 flex-col">
      <div className="rt-divider-b flex min-h-9 shrink-0 items-center gap-1.5 px-2.5 py-1.5">
        <button
          type="button"
          onClick={onToggleExplorer}
          title={`${explorerVisible ? "Hide" : "Show"} Explorer (⌘B)`}
          aria-pressed={explorerVisible}
          className={`rt-btn flex h-6 w-6 shrink-0 items-center justify-center ${
            explorerVisible ? "rt-btn-active" : ""
          }`}
        >
          <Icon name="explorer" size={13} aria-label="Toggle Explorer" />
        </button>
        <span className="rt-text-faint">/</span>
        <span
          className="rt-text-muted min-w-0 flex-1 truncate text-xs font-medium"
          title={selectedPath ?? undefined}
        >
          {pathLabel}
        </span>

        {canEdit && isMarkdown && !isEditing && !diffMode && (
          <button
            type="button"
            onClick={() => setMarkdownPreview((value) => !value)}
            title={markdownPreview ? "View Markdown source" : "Preview Markdown"}
            className={`rt-btn-outline flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium ${
              markdownPreview ? "rt-btn-active" : ""
            }`}
          >
            <Icon name="preview" size={11} />
            {markdownPreview ? "Preview" : "Source"}
          </button>
        )}

        {canEdit && !isEditing && !diffMode && <DiffViewer headerOnly />}

        {canEdit && !isEditing && (
          <button
            type="button"
            onClick={startEditing}
            title="Unlock file for editing"
            className="rt-btn-outline flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium"
          >
            <Icon name="file" size={11} />
            Edit
          </button>
        )}

        {canEdit && isEditing && (
          <>
            <button
              type="button"
              onClick={() => setFindOpen((value) => !value)}
              title="Find and replace (⌘F)"
              className={`rt-btn flex h-6 w-6 shrink-0 items-center justify-center ${
                findOpen ? "rt-btn-active" : ""
              }`}
            >
              <Icon name="search" size={12} aria-label="Find and replace" />
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={saving}
              title="Discard changes and lock"
              className="rt-btn-outline flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium"
            >
              <Icon name="close" size={11} />
              Cancel
            </button>
            <button
              type="button"
              onClick={saveEdits}
              disabled={saving}
              title="Save and lock"
              className="rt-btn-outline rt-btn-active flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium"
            >
              <Icon
                name={saving ? "sync" : "file"}
                size={11}
                className={saving ? "animate-spin" : ""}
              />
              {saving ? "Saving…" : "Lock"}
            </button>
          </>
        )}

        {selectedPath && !isEditing && (
          <button
            type="button"
            onClick={close}
            title="Close file"
            className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center"
          >
            <Icon name="close" size={11} aria-label="Close file" />
          </button>
        )}
      </div>

      {saveError && (
        <div className="shrink-0 bg-red-500/10 px-3 py-1.5">
          <p className="text-[11px] text-red-500">{saveError}</p>
        </div>
      )}

      {isEditing ? (
        <div
          className="flex min-h-0 flex-1 flex-col"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
              event.preventDefault();
              setFindOpen(true);
            }
          }}
        >
          {findOpen && (
            <div className="rt-divider-b flex shrink-0 flex-wrap items-center gap-1.5 px-2.5 py-1.5">
              <input
                autoFocus
                value={findQuery}
                onChange={(event) => setFindQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    selectMatch(activeMatch + (event.shiftKey ? -1 : 1));
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    closeFind();
                  }
                }}
                placeholder="Find"
                spellCheck={false}
                className="rt-input w-36 px-2 py-1 text-[12px]"
              />
              <input
                value={replaceQuery}
                onChange={(event) => setReplaceQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeFind();
                  }
                }}
                placeholder="Replace"
                spellCheck={false}
                className="rt-input w-36 px-2 py-1 text-[12px]"
              />
              <span className="rt-text-faint min-w-12 text-center text-[11px] tabular-nums">
                {matches.length
                  ? `${activeMatch + 1}/${matches.length}`
                  : findQuery
                    ? "0/0"
                    : ""}
              </span>
              <button
                type="button"
                onClick={() => selectMatch(activeMatch - 1)}
                disabled={!matches.length}
                title="Previous match"
                className="rt-btn flex h-6 w-6 items-center justify-center disabled:opacity-40"
              >
                <Icon name="chevronDown" size={12} className="rotate-180" />
              </button>
              <button
                type="button"
                onClick={() => selectMatch(activeMatch + 1)}
                disabled={!matches.length}
                title="Next match"
                className="rt-btn flex h-6 w-6 items-center justify-center disabled:opacity-40"
              >
                <Icon name="chevronDown" size={12} />
              </button>
              <button
                type="button"
                onClick={replaceCurrent}
                disabled={!matches.length}
                className="rt-btn-outline px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={replaceAll}
                disabled={!matches.length}
                className="rt-btn-outline px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
              >
                All
              </button>
              <button
                type="button"
                onClick={closeFind}
                title="Close"
                className="rt-btn ml-auto flex h-6 w-6 items-center justify-center"
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          )}
          <div className="relative min-h-0 flex-1 overflow-hidden ring-1 ring-inset ring-[var(--rt-accent)]">
            <pre
              ref={editPreRef}
              aria-hidden
              className="rt-code pointer-events-none absolute inset-0 m-0 overflow-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre"
            >
              {highlightCode(editDraft ?? "", fileName ?? "")}
              {"\n"}
            </pre>
            <textarea
              ref={editTextareaRef}
              value={editDraft ?? ""}
              onChange={(event) => setDraft(event.target.value)}
              onScroll={syncOverlayScroll}
              spellCheck={false}
              wrap="off"
              className="rt-code-editor absolute inset-0 resize-none overflow-auto whitespace-pre bg-transparent p-3 font-mono text-[12px] leading-relaxed outline-none"
              style={{ colorScheme: "inherit" }}
            />
          </div>
        </div>
      ) : diffMode && selectedPath && !loading && !error ? (
        <DiffViewer />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {!selectedPath ? (
            <div className="flex h-full items-start px-5 pt-12">
              <div className="max-w-sm">
                <span className="rt-accent-text mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--rt-accent-soft)]">
                  <Icon name="code" size={17} />
                </span>
                <p className="text-sm font-medium">Choose a file to start editing.</p>
                <p className="rt-text-muted mt-1 text-[11px] leading-relaxed">
                  The Explorer now lives beside the editor. Use ⌘B whenever you
                  want more room for code.
                </p>
              </div>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center gap-2">
              <Icon name="sync" size={14} className="rt-text-faint animate-spin" />
              <span className="rt-text-faint text-xs">Loading…</span>
            </div>
          ) : error ? (
            <div className="px-3 py-2">
              <p className="rt-text-muted text-[11px] leading-snug">{error}</p>
            </div>
          ) : showMarkdown ? (
            <div className="h-full w-full overflow-auto px-5 py-4">
              {renderMarkdown(content ?? "")}
            </div>
          ) : (
            <pre
              ref={preRef}
              className="rt-code h-full w-full overflow-auto p-4 font-mono text-[12px] leading-relaxed whitespace-pre"
            >
              {highlightCode(content, fileName ?? "")}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

export interface CodeEditorPanelProps {
  cwd: string | null;
}

export const CodeEditorPanel = memo(function CodeEditorPanel({
  cwd,
}: CodeEditorPanelProps) {
  const explorerVisible = useEditorLayoutStore((state) => state.explorerVisible);
  const explorerWidth = useEditorLayoutStore((state) => state.explorerWidth);
  const setExplorerVisible = useEditorLayoutStore(
    (state) => state.setExplorerVisible,
  );
  const setExplorerWidth = useEditorLayoutStore((state) => state.setExplorerWidth);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [resizing, setResizing] = useState(false);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const toggleExplorer = useCallback(
    () => setExplorerVisible(!explorerVisible),
    [explorerVisible, setExplorerVisible],
  );

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      resizeCleanupRef.current?.();
      const startX = event.clientX;
      const startWidth = explorerWidth;
      const previousCursor = document.body.style.cursor;
      const previousSelection = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setResizing(true);

      const onMove = (moveEvent: PointerEvent) => {
        setExplorerWidth(startWidth + moveEvent.clientX - startX);
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousSelection;
        setResizing(false);
        resizeCleanupRef.current = null;
      };
      resizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [explorerWidth, setExplorerWidth],
  );

  return (
    <div
      className="rt-code-workbench flex h-full w-full min-w-0 overflow-hidden"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
          event.preventDefault();
          toggleExplorer();
        }
      }}
    >
      {explorerVisible && (
        <>
          <aside
            className="rt-code-explorer h-full shrink-0 overflow-hidden"
            style={{ width: explorerWidth }}
          >
            <FileExplorerPanel cwd={cwd} />
          </aside>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Explorer"
            onPointerDown={beginResize}
            className={`rt-code-explorer-resizer relative z-10 h-full w-1 shrink-0 cursor-col-resize ${
              resizing ? "rt-code-explorer-resizing" : ""
            }`}
          />
        </>
      )}
      <CodeSurface
        cwd={cwd}
        explorerVisible={explorerVisible}
        onToggleExplorer={toggleExplorer}
      />
    </div>
  );
});

export default CodeEditorPanel;
