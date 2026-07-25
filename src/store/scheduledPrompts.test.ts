import { beforeEach, describe, expect, it } from "vitest";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const {
  defaultScheduleAt,
  fromLocalDateTimeInput,
  toLocalDateTimeInput,
  useScheduleDraft,
  useScheduledPrompts,
} = await import("./scheduledPrompts");

describe("scheduled prompt time helpers", () => {
  it("round-trips a local date and minute", () => {
    const timestamp = new Date(2026, 6, 29, 20, 15, 0, 0).getTime();
    expect(fromLocalDateTimeInput(toLocalDateTimeInput(timestamp))).toBe(timestamp);
  });

  it("defaults to the same local minute tomorrow", () => {
    const now = new Date(2026, 6, 23, 21, 26, 42, 120).getTime();
    const result = new Date(defaultScheduleAt(now));
    expect(result.getDate()).toBe(24);
    expect(result.getHours()).toBe(21);
    expect(result.getMinutes()).toBe(26);
    expect(result.getSeconds()).toBe(0);
  });

  it("rejects an empty datetime value", () => {
    expect(Number.isNaN(fromLocalDateTimeInput(""))).toBe(true);
  });
});

describe("schedule hand-off and queue", () => {
  beforeEach(() => {
    useScheduleDraft.setState({ draft: null });
    useScheduledPrompts.setState({ prompts: [] });
  });

  it("carries the detected reset, prompt, and workspace into the menu draft", () => {
    const draft = {
      prompt: "Continue the refactor",
      fireAt: 1_800_000_000_000,
      workspaceId: "workspace-a",
      cwd: "/repo",
      workspaceLabel: "repo",
    };
    useScheduleDraft.getState().openDraft(draft);
    expect(useScheduleDraft.getState().draft).toEqual(draft);
    useScheduleDraft.getState().clearDraft();
    expect(useScheduleDraft.getState().draft).toBeNull();
  });

  it("keeps queued prompts bound to both workspace id and cwd fallback", () => {
    useScheduledPrompts.getState().schedule({
      prompt: "Continue",
      fireAt: 1_800_000_000_000,
      workspaceId: "workspace-a",
      cwd: "/repo",
      workspaceLabel: "repo",
    });
    expect(useScheduledPrompts.getState().prompts[0]).toMatchObject({
      prompt: "Continue",
      workspaceId: "workspace-a",
      cwd: "/repo",
      status: "pending",
    });
  });
});
