/**
 * ScheduledPromptRunner — polls the scheduledPrompts queue and fires due
 * prompts into their workspace's Claude Code panel, then pops a card over the
 * workspace to say it happened.
 *
 * A 15s poll (plus a check on window focus / tab visibility) means a prompt
 * whose time passed while the machine slept fires on the next wake rather than
 * being lost. Mount this once inside the workspace view.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import Icon from "../Icon";
import { claudeBus } from "../../lib/claudeBus";
import { useWorkspacesStore } from "../../store/workspaces";
import { useScheduledPrompts, type ScheduledPrompt } from "../../store/scheduledPrompts";

interface FiredCard extends ScheduledPrompt {
  delivered: boolean;
}

/**
 * Resolve which open tab should receive a scheduled prompt, keeping it bound to
 * its directory:
 *   1. its original tab, if still open with a Claude Code panel; else
 *   2. any open tab on the same cwd with a Claude Code panel (the folder was
 *      reopened in a fresh tab).
 * Returns the target tab id, or null when nothing can receive it.
 */
function resolveTargetTab(p: ScheduledPrompt): string | null {
  if (claudeBus.has(p.workspaceId)) return p.workspaceId;
  if (p.cwd) {
    const match = useWorkspacesStore
      .getState()
      .tabs.find((t) => t.cwd === p.cwd && claudeBus.has(t.id));
    if (match) return match.id;
  }
  return null;
}

export function ScheduledPromptRunner() {
  const [fired, setFired] = useState<FiredCard[]>([]);

  const dismiss = useCallback((id: string) => {
    setFired((cur) => cur.filter((c) => c.id !== id));
  }, []);

  useEffect(() => {
    const check = () => {
      const { prompts, markFired } = useScheduledPrompts.getState();
      const now = Date.now();
      for (const p of prompts) {
        if (p.status !== "pending" || p.fireAt > now) continue;
        const targetId = resolveTargetTab(p);
        const delivered = targetId ? claudeBus.run(targetId, p.prompt) : false;
        markFired(p.id, delivered);
        setFired((cur) => [
          ...cur,
          { ...p, status: delivered ? "done" : "failed", delivered, firedAt: now },
        ]);
      }
    };
    check(); // sweep anything already due (e.g. after the machine wakes)
    const interval = window.setInterval(check, 15000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // Auto-dismiss delivered cards after a beat; keep undelivered ones (they hold
  // the only surviving copy of the prompt) until the user closes them.
  useEffect(() => {
    const timers = fired
      .filter((c) => c.delivered)
      .map((c) => window.setTimeout(() => dismiss(c.id), 14000));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [fired, dismiss]);

  if (fired.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[1200] flex flex-col items-center gap-2 px-4">
      {fired.map((c) => (
        <div key={c.id} className="rt-panel pointer-events-auto w-full max-w-md rounded-lg p-3 shadow-xl">
          <div className="flex items-start gap-2">
            <Icon name="clock" size={16} className="rt-accent-text mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                {c.delivered ? "Scheduled prompt sent to Claude Code" : "Scheduled prompt fired"}
              </div>
              <div className="rt-text-muted mt-0.5 whitespace-pre-wrap break-words text-xs">
                {c.prompt}
              </div>
              {!c.delivered && (
                <>
                  <div className="mt-1 text-[11px] text-red-500">
                    No Claude Code panel was open in {c.workspaceLabel}. Copy it and send it yourself.
                  </div>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(c.prompt).catch(() => {})}
                    className="rt-btn-outline mt-1.5 rounded px-2 py-0.5 text-[11px] font-medium"
                  >
                    Copy prompt
                  </button>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(c.id)}
              title="Dismiss"
              className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center"
            >
              <Icon name="close" size={12} aria-label="Dismiss" />
            </button>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export default ScheduledPromptRunner;
