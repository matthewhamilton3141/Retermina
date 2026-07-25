import { describe, expect, it } from "vitest";

import {
  applyClaudeRecord,
  emptyClaudeTranscript,
  extractClaudeToolDiffs,
  summarizeClaudeTool,
  summarizeClaudeToolDiffs,
} from "./claudeTranscript";

const timestamp = "2026-07-24T01:00:00.000Z";

describe("applyClaudeRecord — stream-json lifecycle events", () => {
  it("captures model from system/init and closes the turn on result", () => {
    let state = emptyClaudeTranscript();
    state = applyClaudeRecord(
      state,
      {
        type: "system",
        subtype: "init",
        model: "claude-opus-4-8",
        skills: ["code-review", "verify"],
      },
      "s:0",
    );
    expect(state.model).toBe("claude-opus-4-8");
    expect(state.skills.map((s) => s.name)).toEqual(["code-review", "verify"]);
    // init alone adds no timeline items
    expect(state.items).toHaveLength(0);

    state = applyClaudeRecord(
      state,
      {
        type: "assistant",
        timestamp,
        message: {
          model: "claude-opus-4-8",
          stop_reason: null,
          content: [{ type: "text", text: "Working on it." }],
        },
      },
      "s:1",
    );
    expect(state.status).toBe("running");

    // The stream-json `result` event ends the turn regardless of stop_reason.
    state = applyClaudeRecord(state, { type: "result", subtype: "success" }, "s:2");
    expect(state.status).toBe("idle");
    expect(state.items.filter((i) => i.kind === "assistant")).toHaveLength(1);
  });

  it("streams partial text, then the completed message replaces it", () => {
    let state = emptyClaudeTranscript();
    state = applyClaudeRecord(
      state,
      { type: "stream_event", event: { type: "message_start" } },
      "d:0",
    );
    expect(state.status).toBe("running");
    expect(state.partialText).toBe("");

    for (const [i, chunk] of ["Hel", "lo ", "there"].entries()) {
      state = applyClaudeRecord(
        state,
        {
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: chunk } },
        },
        `d:delta:${i}`,
      );
    }
    expect(state.partialText).toBe("Hello there");
    // deltas are transient — they don't pile up in the timeline or seen map
    expect(state.items).toHaveLength(0);

    // The completed assistant record clears the preview and lands one item.
    state = applyClaudeRecord(
      state,
      {
        type: "assistant",
        timestamp,
        message: { content: [{ type: "text", text: "Hello there" }] },
      },
      "d:final",
    );
    expect(state.partialText).toBe("");
    expect(state.items.filter((i) => i.kind === "assistant")).toHaveLength(1);
  });
});

describe("applyClaudeRecord", () => {
  it("builds a user, assistant, and tool timeline and resolves the tool result", () => {
    let state = emptyClaudeTranscript();
    state = applyClaudeRecord(
      state,
      {
        type: "user",
        timestamp,
        message: { content: "Update the greeting" },
      },
      "session:0",
    );
    state = applyClaudeRecord(
      state,
      {
        type: "assistant",
        timestamp,
        message: {
          model: "claude-sonnet-5",
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "I’ll update it." },
            {
              type: "tool_use",
              id: "tool-1",
              name: "Edit",
              input: {
                file_path: "src/app.ts",
                old_string: 'const greeting = "hi";',
                new_string: 'const greeting = "hello";',
              },
            },
          ],
        },
      },
      "session:1",
    );
    state = applyClaudeRecord(
      state,
      {
        type: "user",
        timestamp,
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "Updated src/app.ts",
            },
          ],
        },
      },
      "session:2",
    );

    expect(state.items.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
    expect(state.model).toBe("claude-sonnet-5");
    expect(state.items[2]).toMatchObject({
      kind: "tool",
      toolUseId: "tool-1",
      status: "done",
      output: "Updated src/app.ts",
    });
  });

  it("deduplicates replayed JSONL records and ignores sidechains", () => {
    const record = {
      type: "assistant",
      timestamp,
      message: {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Done." }],
      },
    };
    let state = applyClaudeRecord(emptyClaudeTranscript(), record, "session:3");
    state = applyClaudeRecord(state, record, "session:3");
    state = applyClaudeRecord(
      state,
      { ...record, isSidechain: true },
      "session:4",
    );

    expect(state.items).toHaveLength(1);
    expect(state.status).toBe("idle");
  });

  it("marks failed tool results without adding a fake user message", () => {
    let state = applyClaudeRecord(
      emptyClaudeTranscript(),
      {
        type: "assistant",
        timestamp,
        message: {
          stop_reason: "tool_use",
          content: [
            { type: "tool_use", id: "tool-2", name: "Bash", input: { command: "false" } },
          ],
        },
      },
      "session:5",
    );
    state = applyClaudeRecord(
      state,
      {
        type: "user",
        timestamp,
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tool-2", content: "exit 1", is_error: true },
          ],
        },
      },
      "session:6",
    );

    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ kind: "tool", status: "error" });
  });

  it("clears the run state when the user interrupts the turn", () => {
    let state = applyClaudeRecord(
      emptyClaudeTranscript(),
      {
        type: "assistant",
        timestamp,
        message: {
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "tool-9", name: "Bash", input: {} }],
        },
      },
      "session:8",
    );
    expect(state.status).toBe("running");

    state = applyClaudeRecord(
      state,
      {
        type: "user",
        timestamp,
        message: { content: [{ type: "text", text: "[Request interrupted by user]" }] },
      },
      "session:9",
    );

    expect(state.status).toBe("idle");
    const last = state.items[state.items.length - 1];
    expect(last).toMatchObject({ kind: "notice", tone: "muted" });
    expect(state.items.some((item) => item.kind === "user")).toBe(false);
  });

  it("surfaces structured questions and resumes after their tool result", () => {
    let state = applyClaudeRecord(
      emptyClaudeTranscript(),
      {
        type: "assistant",
        timestamp,
        message: {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "question-1",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    header: "Approach",
                    question: "How should I implement this?",
                    multiSelect: false,
                    options: [
                      { label: "Small change", description: "Keep the current architecture." },
                      { label: "Refactor", description: "Reshape the module first." },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
      "session:question",
    );

    expect(state.status).toBe("waiting");
    expect(state.items[0]).toMatchObject({
      kind: "question",
      toolUseId: "question-1",
      status: "running",
      questions: [
        {
          header: "Approach",
          question: "How should I implement this?",
          options: [{ label: "Small change" }, { label: "Refactor" }],
        },
      ],
    });

    state = applyClaudeRecord(
      state,
      {
        type: "user",
        timestamp,
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "question-1",
              content: "Selected: Small change",
            },
          ],
        },
      },
      "session:answer",
    );

    expect(state.status).toBe("running");
    expect(state.items[0]).toMatchObject({
      kind: "question",
      status: "done",
      output: "Selected: Small change",
    });
  });

  it("tracks permission modes, agents, and skills advertised by Claude Code", () => {
    let state = applyClaudeRecord(
      emptyClaudeTranscript(),
      { type: "permission-mode", permissionMode: "plan" },
      "session:mode",
    );
    state = applyClaudeRecord(
      state,
      {
        type: "attachment",
        attachment: {
          type: "agent_listing_delta",
          addedTypes: ["Explore", "code-reviewer"],
          addedLines: [
            "- Explore: Fast read-only code search.",
            "- code-reviewer: Reviews changes for correctness.",
          ],
          removedTypes: [],
        },
      },
      "session:agents",
    );
    state = applyClaudeRecord(
      state,
      {
        type: "attachment",
        attachment: {
          type: "skill_listing",
          content:
            "- frontend-design:frontend-design: Design polished interfaces.\n" +
            "- update-config: Configure Claude Code settings.",
        },
      },
      "session:skills",
    );

    expect(state.permissionMode).toBe("plan");
    expect(state.agents).toEqual([
      { name: "code-reviewer", description: "Reviews changes for correctness." },
      { name: "Explore", description: "Fast read-only code search." },
    ]);
    expect(state.skills).toEqual([
      {
        name: "frontend-design:frontend-design",
        description: "Design polished interfaces.",
      },
      { name: "update-config", description: "Configure Claude Code settings." },
    ]);
  });
});

describe("Claude tool presentation", () => {
  it("summarizes commands and extracts edit diffs", () => {
    const tool = {
      id: "tool",
      kind: "tool" as const,
      timestamp: 0,
      toolUseId: "tool-3",
      name: "Edit",
      input: {
        file_path: "src/app.ts",
        old_string: "old",
        new_string: "new",
      },
      status: "done" as const,
    };

    expect(summarizeClaudeTool(tool)).toBe("src/app.ts");
    expect(extractClaudeToolDiffs(tool)).toEqual([
      { path: "src/app.ts", oldText: "old", newText: "new" },
    ]);
    expect(summarizeClaudeToolDiffs(tool)).toEqual({
      files: 1,
      added: 1,
      removed: 1,
    });
  });
});
