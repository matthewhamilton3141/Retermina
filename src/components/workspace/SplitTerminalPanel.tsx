/**
 * SplitTerminalPanel — a terminal panel that can be divided into multiple
 * independent panes, each running its own PTY session.
 *
 * Hover over the panel to reveal the split controls (top-right corner).
 * Click "H" to split side-by-side, "V" to split top/bottom. Drag the
 * divider between panes to resize. Each pane shows an × close button on
 * hover; closing a pane gives its space back to its neighbour.
 *
 * Split state is local to this component so it survives grid drags and
 * theme changes without remounting (the memo key in WorkspaceLayout
 * stays stable).
 */
import { Fragment, memo, useCallback, useRef, useState } from "react";

import Icon from "../Icon";
import TerminalViewport, { type TerminalControls } from "./TerminalViewport";
import { claudeBus, useClaudeTarget } from "../../lib/claudeBus";
import { useToastStore } from "../../store/toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Pane {
  id: string;
  /** Percentage of the container (0–100). All panes sum to 100. */
  size: number;
}

type Direction = "h" | "v"; // horizontal (side-by-side) | vertical (stacked)

let _counter = 0;
const uid = () => `sp-${++_counter}`;

// ---------------------------------------------------------------------------
// Draggable divider
// ---------------------------------------------------------------------------

function PaneDivider({
  direction,
  onDrag,
}: {
  direction: Direction;
  onDrag: (incrementalDeltaPx: number) => void;
}) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      let last = direction === "h" ? e.clientX : e.clientY;

      const onMove = (ev: MouseEvent) => {
        const cur = direction === "h" ? ev.clientX : ev.clientY;
        onDrag(cur - last);
        last = cur;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [direction, onDrag],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      className={`group/div shrink-0 transition-colors hover:bg-[var(--rt-accent)] ${
        direction === "h"
          ? "w-[3px] cursor-col-resize bg-[var(--rt-border)]"
          : "h-[3px] cursor-row-resize bg-[var(--rt-border)]"
      }`}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SplitTerminalPanel = memo(function SplitTerminalPanel({
  cwd,
  active = true,
  workspaceId,
  onPopOut,
}: {
  cwd: string | null;
  /** Whether the owning workspace tab is in the foreground. */
  active?: boolean;
  /** The tab this terminal lives in — used to reach its Claude Code panel. */
  workspaceId: string;
  /**
   * Detach a pane into its own terminal panel on the workspace grid. Called
   * with no arguments — the caller adds a fresh terminal panel; this component
   * removes the popped pane so the remaining pane reclaims the freed space.
   */
  onPopOut?: () => void;
}) {
  const [panes, setPanes] = useState<Pane[]>([{ id: uid(), size: 100 }]);
  const [direction, setDirection] = useState<Direction>("h");
  const containerRef = useRef<HTMLDivElement>(null);

  // Broadcast: when on, input typed in any pane is mirrored to all the others.
  const [broadcast, setBroadcast] = useState(false);
  const broadcastRef = useRef(broadcast);
  broadcastRef.current = broadcast;
  // Each pane's live PTY write fn, keyed by pane id.
  const writesRef = useRef<Map<string, (d: string) => void>>(new Map());
  const handlePaneInput = useCallback((paneId: string, data: string) => {
    if (!broadcastRef.current) return;
    writesRef.current.forEach((write, id) => {
      if (id !== paneId) write(data);
    });
  }, []);
  // Each pane's control handle, in insertion order, for "send to Claude".
  const controlsRef = useRef<Map<string, TerminalControls>>(new Map());
  const hasClaude = useClaudeTarget(workspaceId);

  // Send the terminal's text to the workspace's Claude Code panel: a live
  // selection (in any pane) wins, else the last pane's last command output.
  const sendToClaude = useCallback(() => {
    let text = "";
    for (const controls of controlsRef.current.values()) {
      if (controls.getSelection().trim()) {
        text = controls.getSelection();
        break;
      }
    }
    if (!text.trim()) {
      const panesControls = [...controlsRef.current.values()];
      text = panesControls[panesControls.length - 1]?.getLastOutput() ?? "";
    }
    const toast = useToastStore.getState();
    if (!text.trim()) {
      toast.push({ message: "Nothing to send yet — run a command or select some text." });
      return;
    }
    toast.push(
      claudeBus.send(workspaceId, text)
        ? { message: "Sent to Claude Code" }
        : { message: "Open a Claude Code panel in this workspace to send output." },
    );
  }, [workspaceId]);
  // Live pointer-drag state for a pane being dragged out of the split.
  const [popout, setPopout] = useState<{ paneId: string; x: number; y: number; outside: boolean } | null>(null);

  const multi = panes.length > 1;

  // ── Split ──────────────────────────────────────────────────────────────────

  const split = useCallback((dir: Direction) => {
    setDirection(dir);
    setPanes((prev) => {
      // Split the last pane in half.
      const last = prev[prev.length - 1];
      const half = last.size / 2;
      return [
        ...prev.slice(0, -1),
        { ...last, size: half },
        { id: uid(), size: half },
      ];
    });
  }, []);

  // ── Close pane ─────────────────────────────────────────────────────────────

  const closePane = useCallback((id: string) => {
    setPanes((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((p) => p.id === id);
      const removed = prev[idx];
      const next = prev.filter((p) => p.id !== id);
      // Give the closed pane's space to its neighbour.
      const neighbour = Math.min(idx, next.length - 1);
      next[neighbour] = { ...next[neighbour], size: next[neighbour].size + removed.size };
      return next;
    });
  }, []);

  // ── Pop a pane out into its own grid panel ─────────────────────────────────
  // The detached pane starts a fresh terminal in a new panel (its live session
  // can't be carried across React trees), and closePane hands its space back to
  // the remaining pane. Guarded to multi-pane only — the caller also requires it.

  const popPaneOut = useCallback(
    (paneId: string) => {
      if (panes.length <= 1) return;
      onPopOut?.();
      closePane(paneId);
    },
    [panes.length, onPopOut, closePane],
  );

  // Drag the grip; release outside the panel (or a plain click) pops the pane.
  const startPopDrag = useCallback(
    (paneId: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;
      setPopout({ paneId, x: startX, y: startY, outside: false });

      const isOutside = (x: number, y: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return false;
        return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
      };

      const onMove = (ev: MouseEvent) => {
        if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) moved = true;
        setPopout({ paneId, x: ev.clientX, y: ev.clientY, outside: isOutside(ev.clientX, ev.clientY) });
      };
      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setPopout(null);
        // A plain click (no real drag) pops out too; a drag only pops if it
        // ends outside the split panel, so an accidental in-panel drag cancels.
        if (!moved || isOutside(ev.clientX, ev.clientY)) popPaneOut(paneId);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [popPaneOut],
  );

  // ── Divider drag ───────────────────────────────────────────────────────────

  const onDividerDrag = useCallback(
    (idx: number, deltaPixels: number) => {
      const container = containerRef.current;
      if (!container) return;
      const totalPx =
        direction === "h" ? container.clientWidth : container.clientHeight;
      const deltaPct = (deltaPixels / totalPx) * 100;

      setPanes((prev) => {
        const next = [...prev];
        const minPct = 15; // each pane must stay ≥15%
        const combined = next[idx].size + next[idx + 1].size;
        const newLeft = Math.max(
          minPct,
          Math.min(combined - minPct, next[idx].size + deltaPct),
        );
        next[idx]     = { ...next[idx],     size: newLeft };
        next[idx + 1] = { ...next[idx + 1], size: combined - newLeft };
        return next;
      });
    },
    [direction],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const flexDir = direction === "h" ? "flex-row" : "flex-col";

  return (
    <div className="rt-terminal-surface relative flex h-full w-full flex-col overflow-hidden">
      {/* ── Split toolbar — pinned to the top of the terminal panel ── */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--rt-border)] px-2 py-1">
        <span className="rt-text-faint mr-auto text-[10px] font-medium uppercase tracking-wider">
          Split
        </span>
        <button
          type="button"
          onClick={sendToClaude}
          disabled={!hasClaude}
          title={
            hasClaude
              ? "Send your selection — or the last command's output — to Claude Code"
              : "Open a Claude Code panel in this workspace to send output to it"
          }
          className="rt-btn-outline flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-40"
        >
          <Icon name="claudeLogo" size={11} />
          <span>Send</span>
        </button>
        <button
          type="button"
          onClick={() => split("h")}
          title="Split horizontally (side-by-side)"
          className="rt-btn-outline flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium"
        >
          <Icon name="columns" size={11} />
          <span>H</span>
        </button>
        <button
          type="button"
          onClick={() => split("v")}
          title="Split vertically (stacked)"
          className="rt-btn-outline flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium"
        >
          <Icon name="rows" size={11} />
          <span>V</span>
        </button>
        {multi && (
          <button
            type="button"
            onClick={() => setBroadcast((v) => !v)}
            title="Broadcast input to all panes"
            aria-pressed={broadcast}
            className={`rt-btn-outline flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium ${broadcast ? "rt-btn-active" : ""}`}
          >
            <Icon name="iris" size={11} />
            <span>All</span>
          </button>
        )}
        {multi && (
          <button
            type="button"
            onClick={() => setPanes([{ id: uid(), size: 100 }])}
            title="Merge all panes back into one"
            className="rt-btn-outline px-1.5 py-0.5 text-[10px] font-medium"
          >
            Merge
          </button>
        )}
      </div>

      {/* ── Panes ── */}
      <div ref={containerRef} className={`flex min-h-0 flex-1 ${flexDir}`}>
        {panes.map((pane, idx) => (
          <Fragment key={pane.id}>
            <div
              className="group/pane relative min-h-0 min-w-0 p-1"
              style={{ flexBasis: `${pane.size}%`, flexShrink: 0, flexGrow: 0 }}
            >
              {/* Per-pane controls — pop out + close */}
              {multi && (
                <div className="absolute right-2 top-2 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/pane:opacity-100">
                  <button
                    type="button"
                    onMouseDown={startPopDrag(pane.id)}
                    title="Pop out into its own panel — drag out or click"
                    className={`rt-btn flex h-5 w-5 cursor-grab items-center justify-center active:cursor-grabbing ${
                      popout?.paneId === pane.id ? "rt-btn-active" : ""
                    }`}
                  >
                    <Icon name="popOut" size={10} aria-label="Pop out pane" />
                  </button>
                  <button
                    type="button"
                    onClick={() => closePane(pane.id)}
                    title="Close this pane"
                    className="rt-btn flex h-5 w-5 items-center justify-center"
                  >
                    <Icon name="close" size={10} aria-label="Close pane" />
                  </button>
                </div>
              )}
              <TerminalViewport
                cwd={cwd}
                active={active}
                className="h-full w-full"
                onInput={(data) => handlePaneInput(pane.id, data)}
                registerWrite={(write) => {
                  if (write) writesRef.current.set(pane.id, write);
                  else writesRef.current.delete(pane.id);
                }}
                registerControls={(controls) => {
                  if (controls) controlsRef.current.set(pane.id, controls);
                  else controlsRef.current.delete(pane.id);
                }}
              />
            </div>

            {idx < panes.length - 1 && (
              <PaneDivider
                direction={direction}
                onDrag={(delta) => onDividerDrag(idx, delta)}
              />
            )}
          </Fragment>
        ))}
      </div>

      {/* Drag hint — follows the cursor while a pane is being popped out. */}
      {popout && (
        <div
          className="rt-panel pointer-events-none fixed z-[300] flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium shadow-lg"
          style={{
            left: popout.x + 12,
            top: popout.y + 12,
            background: "var(--rt-surface)",
            color: popout.outside ? "var(--rt-accent)" : "var(--rt-text-muted)",
          }}
        >
          <Icon name="popOut" size={12} />
          {popout.outside ? "Release to pop out" : "Drag outside to pop out"}
        </div>
      )}
    </div>
  );
});

export default SplitTerminalPanel;
