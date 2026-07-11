/**
 * ScheduleMenu — the top-bar clock button that queues "timed prompts."
 *
 * Pick Today/Tomorrow + a time, type a prompt, and it fires into the active
 * workspace's Claude Code panel at that time (see ScheduledPromptRunner +
 * scheduledPrompts store). Handy for firing a prompt the moment a usage limit
 * resets overnight.
 */
import { useMemo, useState } from "react";

import Icon from "../Icon";
import { useWorkspacesStore } from "../../store/workspaces";
import { useClaudeTarget } from "../../lib/claudeBus";
import {
  computeFireAt,
  useScheduledPrompts,
  type ScheduledPrompt,
} from "../../store/scheduledPrompts";
import { prettyPath } from "../../lib/format";

/** "Today 3:00 AM" / "Tomorrow 9:15 PM" / "Aug 3 6:00 AM". */
function formatFireAt(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day =
    d.toDateString() === now.toDateString()
      ? "Today"
      : d.toDateString() === tomorrow.toDateString()
        ? "Tomorrow"
        : d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day} ${time}`;
}

/** Current wall-clock time as an <input type="time"> value. */
function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ScheduleMenu({ showLabel }: { showLabel: boolean }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<"today" | "tomorrow">("tomorrow");
  const [time, setTime] = useState(nowHHMM);
  const [prompt, setPrompt] = useState("");

  const activeId = useWorkspacesStore((s) => s.activeId);
  const activeTab = useWorkspacesStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const workspaceLabel = activeTab ? (activeTab.cwd ? prettyPath(activeTab.cwd) : activeTab.title) : "";
  const hasClaude = useClaudeTarget(activeId ?? "");

  const prompts = useScheduledPrompts((s) => s.prompts);
  const schedule = useScheduledPrompts((s) => s.schedule);
  const remove = useScheduledPrompts((s) => s.remove);

  // Pending first (soonest-first), then recently fired.
  const pending = useMemo(
    () => prompts.filter((p) => p.status === "pending").sort((a, b) => a.fireAt - b.fireAt),
    [prompts],
  );
  const finished = useMemo(
    () => prompts.filter((p) => p.status !== "pending").sort((a, b) => (b.firedAt ?? 0) - (a.firedAt ?? 0)),
    [prompts],
  );

  const fireAt = computeFireAt(day, time);
  const inPast = fireAt <= Date.now();
  const canSchedule = prompt.trim().length > 0 && !!time && !!activeId;

  function submit() {
    if (!canSchedule || !activeId) return;
    schedule({
      prompt: prompt.trim(),
      fireAt,
      workspaceId: activeId,
      cwd: activeTab?.cwd ?? null,
      workspaceLabel,
    });
    setPrompt("");
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Schedule a prompt"
        aria-pressed={open}
        className={`rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium ${open ? "rt-btn-active" : ""}`}
      >
        <Icon name="clock" size={14} />
        {showLabel && <span>Schedule</span>}
        {pending.length > 0 && (
          <span
            className="ml-0.5 rounded-full px-1.5 text-[10px] font-semibold"
            style={{ background: "var(--rt-accent)", color: "var(--rt-accent-contrast, #fff)" }}
          >
            {pending.length}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="rt-menu absolute right-0 top-full z-50 mt-1 w-80">
            <div className="flex flex-col gap-3 p-3">
              <div className="flex items-center gap-2">
                <Icon name="clock" size={14} className="rt-accent-text" />
                <span className="text-sm font-semibold">Schedule a prompt</span>
              </div>

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
                }}
                rows={3}
                placeholder="Prompt to send to Claude Code…"
                className="rt-input w-full resize-none rounded px-2 py-1.5 text-sm"
              />

              {/* Day + time */}
              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded border border-[var(--rt-border)]">
                  {(["today", "tomorrow"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDay(d)}
                      className={`px-2.5 py-1 text-xs font-medium capitalize ${day === d ? "rt-btn-active" : "rt-btn"}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="rt-input rounded px-2 py-1 text-sm"
                />
              </div>

              <div className="rt-text-faint text-[11px] leading-snug">
                Fires <span className="rt-text-muted font-medium">{formatFireAt(fireAt)}</span> into{" "}
                <span className="rt-text-muted font-medium">{workspaceLabel || "this workspace"}</span>.
                {inPast && <span className="text-red-500"> That time has already passed today.</span>}
                {!hasClaude && (
                  <span className="block">Open a Claude Code panel here so it has somewhere to land.</span>
                )}
              </div>

              <button
                type="button"
                onClick={submit}
                disabled={!canSchedule}
                className="flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--rt-accent)", color: "var(--rt-accent-contrast, #fff)" }}
              >
                <Icon name="clock" size={13} />
                Schedule
              </button>
            </div>

            {(pending.length > 0 || finished.length > 0) && (
              <div className="max-h-56 overflow-y-auto border-t border-[var(--rt-border)] p-2">
                {pending.map((p) => (
                  <ScheduledRow key={p.id} p={p} onRemove={() => remove(p.id)} />
                ))}
                {finished.map((p) => (
                  <ScheduledRow key={p.id} p={p} onRemove={() => remove(p.id)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ScheduledRow({ p, onRemove }: { p: ScheduledPrompt; onRemove: () => void }) {
  const statusDot =
    p.status === "pending"
      ? "bg-[var(--rt-accent)]"
      : p.status === "done"
        ? "bg-green-500"
        : "bg-red-500";
  return (
    <div className="group flex items-start gap-2 rounded px-1.5 py-1.5 hover:bg-[var(--rt-surface-hover)]">
      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">{p.prompt}</div>
        <div className="rt-text-faint text-[10px]">
          {formatFireAt(p.fireAt)} · {p.workspaceLabel}
          {p.status === "failed" && " · not delivered"}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        title={p.status === "pending" ? "Cancel" : "Remove"}
        className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Icon name="close" size={11} aria-label="Remove scheduled prompt" />
      </button>
    </div>
  );
}

export default ScheduleMenu;
