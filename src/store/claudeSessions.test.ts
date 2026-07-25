import { beforeEach, describe, expect, it } from "vitest";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const {
  useClaudeSessions,
  useClaudeWorkspacePreferences,
} = await import("./claudeSessions");

describe("Claude workspace session isolation", () => {
  beforeEach(() => {
    useClaudeSessions.setState({ sessions: {} });
    useClaudeWorkspacePreferences.setState({ workspaces: {} });
  });

  it("keeps concurrent workspace transcripts and drafts separate", () => {
    const sessions = useClaudeSessions.getState();
    sessions.beginSession("workspace-a", "session-a");
    sessions.beginSession("workspace-b", "session-b");
    sessions.ingest("workspace-a", "session-a", 0, {
      type: "user",
      timestamp: "2026-07-24T01:00:00.000Z",
      message: { content: "Prompt A" },
    });
    sessions.ingest("workspace-b", "session-b", 0, {
      type: "user",
      timestamp: "2026-07-24T01:00:00.000Z",
      message: { content: "Prompt B" },
    });

    const preferences = useClaudeWorkspacePreferences.getState();
    preferences.setDraft("workspace-a", "Draft A");
    preferences.setDraft("workspace-b", "Draft B");
    preferences.setView("workspace-b", "cli");
    preferences.setPermissionMode("workspace-b", "plan");
    preferences.setModel("workspace-b", "opus");

    expect(useClaudeSessions.getState().sessions["workspace-a"].items[0]).toMatchObject({
      kind: "user",
      text: "Prompt A",
    });
    expect(useClaudeSessions.getState().sessions["workspace-b"].items[0]).toMatchObject({
      kind: "user",
      text: "Prompt B",
    });
    expect(useClaudeWorkspacePreferences.getState().workspaces).toMatchObject({
      "workspace-a": {
        draft: "Draft A",
        view: "agent",
        permissionMode: "acceptEdits",
        model: "default",
      },
      "workspace-b": {
        draft: "Draft B",
        view: "cli",
        permissionMode: "plan",
        model: "opus",
      },
    });
  });

  it("optimistically shows an interrupt, then dedupes Claude's own record", () => {
    const store = useClaudeSessions.getState();
    store.beginSession("workspace-a", "session-a");
    store.markSubmitted("workspace-a", "do a thing");

    // Fast interrupt before Claude wrote anything.
    store.markInterrupted("workspace-a");
    let session = useClaudeSessions.getState().sessions["workspace-a"];
    expect(session.status).toBe("idle");
    expect(session.items).toHaveLength(1);
    expect(session.items[0]).toMatchObject({ kind: "notice", text: "Interrupted" });

    // A late `[Request interrupted by user]` record must not add a second notice.
    store.ingest("workspace-a", "session-a", 0, {
      type: "user",
      timestamp: "2026-07-24T01:00:00.000Z",
      message: { content: "[Request interrupted by user]" },
    });
    session = useClaudeSessions.getState().sessions["workspace-a"];
    expect(session.items.filter((item) => item.kind === "notice")).toHaveLength(1);
    expect(session.status).toBe("idle");
  });

  it("keeps limited status while late transcript records arrive", () => {
    const store = useClaudeSessions.getState();
    store.beginSession("workspace-a", "session-a");
    store.setLimit("workspace-a", {
      kind: "session",
      resetAt: 1_800_000_000_000,
      detectedAt: 1_799_000_000_000,
    });
    store.ingest("workspace-a", "session-a", 1, {
      type: "assistant",
      timestamp: "2026-07-24T01:00:00.000Z",
      message: {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Limit reached." }],
      },
    });

    expect(useClaudeSessions.getState().sessions["workspace-a"].status).toBe("limited");
  });
});
