/**
 * ScheduleMenu — the top-bar clock button that queues "timed prompts."
 *
 * Pick an exact local date/time, type a prompt, and it fires into the selected
 * workspace's Claude Code panel (see ScheduledPromptRunner + scheduledPrompts
 * store). Claude limit notices can open this menu with both fields prefilled.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import Icon from "../Icon";
import { useWorkspacesStore } from "../../store/workspaces";
import { useClaudeTarget } from "../../lib/claudeBus";
import {
  defaultScheduleAt,
  fromLocalDateTimeInput,
  toLocalDateTimeInput,
  useScheduleDraft,
  useScheduledPrompts,
  type ScheduledPrompt,
} from "../../store/scheduledPrompts";
import { prettyPath } from "../../lib/format";

/** "Today 3:00 AM" / "Tomorrow 9:15 PM" / "Aug 3 6:00 AM". */
export function formatFireAt(ts: number): string {
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

function localDateAtOffset(dayOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return toLocalDateTimeInput(date.getTime()).slice(0, 10);
}

export function ScheduleMenu({ showLabel }: { showLabel: boolean }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [dateTime, setDateTime] = useState(() => toLocalDateTimeInput(defaultScheduleAt()));
  const [prompt, setPrompt] = useState("");
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string | null>(null);
  const [targetCwd, setTargetCwd] = useState<string | null>(null);
  const [targetLabel, setTargetLabel] = useState("");
  const [position, setPosition] = useState({ top: 56, right: 8 });

  const activeId = useWorkspacesStore((s) => s.activeId);
  const activeTab = useWorkspacesStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const activeLabel = activeTab ? (activeTab.cwd ? prettyPath(activeTab.cwd) : activeTab.title) : "";
  const destinationId = targetWorkspaceId ?? activeId;
  const workspaceLabel = targetLabel || activeLabel;
  const hasClaude = useClaudeTarget(destinationId ?? "");

  const prompts = useScheduledPrompts((s) => s.prompts);
  const schedule = useScheduledPrompts((s) => s.schedule);
  const remove = useScheduledPrompts((s) => s.remove);
  const scheduleDraft = useScheduleDraft((s) => s.draft);
  const clearScheduleDraft = useScheduleDraft((s) => s.clearDraft);

  useEffect(() => {
    if (!scheduleDraft) return;
    setPrompt(scheduleDraft.prompt);
    setDateTime(
      toLocalDateTimeInput(scheduleDraft.fireAt ?? defaultScheduleAt()),
    );
    setTargetWorkspaceId(scheduleDraft.workspaceId);
    setTargetCwd(scheduleDraft.cwd);
    setTargetLabel(scheduleDraft.workspaceLabel);
    setOpen(true);
    clearScheduleDraft();
  }, [clearScheduleDraft, scheduleDraft]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        top: Math.min(window.innerHeight - 12, rect.bottom + 5),
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Pending first (soonest-first), then recently fired.
  const pending = useMemo(
    () => prompts.filter((p) => p.status === "pending").sort((a, b) => a.fireAt - b.fireAt),
    [prompts],
  );
  const finished = useMemo(
    () => prompts.filter((p) => p.status !== "pending").sort((a, b) => (b.firedAt ?? 0) - (a.firedAt ?? 0)),
    [prompts],
  );

  const [selectedDate = "", selectedTime = ""] = dateTime.split("T");
  const todayDate = localDateAtOffset(0);
  const tomorrowDate = localDateAtOffset(1);
  const fireAt = fromLocalDateTimeInput(dateTime);
  const validTime = Number.isFinite(fireAt);
  const inPast = validTime && fireAt <= Date.now();
  const hasCustomDate =
    !!selectedDate &&
    selectedDate !== todayDate &&
    selectedDate !== tomorrowDate;
  const canSchedule =
    prompt.trim().length > 0 && validTime && !inPast && !!destinationId;

  function selectDate(nextDate: string) {
    const fallbackTime =
      toLocalDateTimeInput(defaultScheduleAt()).split("T")[1] ?? "09:00";
    setDateTime(`${nextDate}T${selectedTime || fallbackTime}`);
  }

  function submit() {
    if (!canSchedule || !destinationId) return;
    schedule({
      prompt: prompt.trim(),
      fireAt,
      workspaceId: destinationId,
      cwd: targetWorkspaceId ? targetCwd : (activeTab?.cwd ?? null),
      workspaceLabel,
    });
    setPrompt("");
  }

  function toggleOpen() {
    setOpen((current) => {
      const next = !current;
      if (next) {
        setTargetWorkspaceId(activeId);
        setTargetCwd(activeTab?.cwd ?? null);
        setTargetLabel(activeLabel);
      }
      return next;
    });
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        title="Schedule a prompt"
        aria-expanded={open}
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

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[1190]" onClick={() => setOpen(false)} />
            <div
              className="rt-menu fixed z-[1200] w-80 max-w-[calc(100vw-1rem)]"
              style={{
                top: position.top,
                right: position.right,
                maxHeight: `calc(100vh - ${position.top + 8}px)`,
                overflowY: "auto",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
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

              <div className="flex flex-col gap-1.5">
                <span className="rt-text-faint text-[10px] font-medium uppercase tracking-wide">
                  Send at
                </span>
                <span className="flex items-center gap-2">
                  <span className="flex min-w-0 overflow-hidden rounded border border-[var(--rt-border)]">
                    {[
                      { label: "Today", value: todayDate },
                      { label: "Tomorrow", value: tomorrowDate },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => selectDate(option.value)}
                        className={`px-2.5 py-1.5 text-xs font-medium ${
                          selectedDate === option.value ? "rt-btn-active" : "rt-btn"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                    {hasCustomDate && (
                      <span className="rt-btn-active flex items-center px-2.5 py-1.5 text-xs font-medium">
                        {validTime
                          ? new Date(fireAt).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                            })
                          : selectedDate}
                      </span>
                    )}
                  </span>
                  <input
                    type="time"
                    value={selectedTime}
                    onChange={(event) =>
                      setDateTime(
                        `${selectedDate || todayDate}T${event.target.value}`,
                      )
                    }
                    className="rt-input min-w-0 flex-1 rounded px-2 py-1.5 text-sm"
                    aria-label="Schedule time"
                  />
                </span>
              </div>

              <div className="rt-text-faint text-[11px] leading-snug">
                Fires{" "}
                <span className="rt-text-muted font-medium">
                  {validTime ? formatFireAt(fireAt) : "after you choose a valid time"}
                </span>{" "}
                into{" "}
                <span className="rt-text-muted font-medium">{workspaceLabel || "this workspace"}</span>.
                {inPast && <span className="text-red-500"> That time has already passed.</span>}
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
          </>,
          document.body,
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
