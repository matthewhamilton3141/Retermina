import { describe, expect, it } from "vitest";

import {
  appendClaudeTerminalOutput,
  detectClaudeLimit,
  detectsClaudePermissionRequest,
} from "./claudeLimit";

describe("detectClaudeLimit", () => {
  it("reassembles ANSI-fragmented session notices and chooses the next local time", () => {
    const now = new Date(2026, 6, 23, 21, 26, 0, 0).getTime();
    let buffer = appendClaudeTerminalOutput("", "\u001b[2JYou've hit your ses");
    buffer = appendClaudeTerminalOutput(buffer, "sion limit · resets at \u001b[31m3:00 AM\u001b[0m");
    const hit = detectClaudeLimit(buffer, now);

    expect(hit?.kind).toBe("session");
    const reset = new Date(hit!.resetAt!);
    expect(reset.getFullYear()).toBe(2026);
    expect(reset.getMonth()).toBe(6);
    expect(reset.getDate()).toBe(24);
    expect(reset.getHours()).toBe(3);
    expect(reset.getMinutes()).toBe(0);
  });

  it("parses dated weekly resets", () => {
    const now = new Date(2026, 6, 23, 12, 0, 0, 0).getTime();
    const hit = detectClaudeLimit(
      "You've hit your weekly limit. Your limit resets Jul 29 at 8pm.",
      now,
    );
    const reset = new Date(hit!.resetAt!);

    expect(hit?.kind).toBe("weekly");
    expect(reset.getMonth()).toBe(6);
    expect(reset.getDate()).toBe(29);
    expect(reset.getHours()).toBe(20);
  });

  it("parses relative resets", () => {
    const now = new Date(2026, 6, 23, 12, 0, 0, 0).getTime();
    const hit = detectClaudeLimit(
      "You have hit your session limit; resets in 2 hours 15 minutes.",
      now,
    );
    expect(hit?.resetAt).toBe(now + 135 * 60_000);
  });

  it("does not mistake context-window warnings for account limits", () => {
    expect(
      detectClaudeLimit("Context window nearly full. Auto-compaction will run soon."),
    ).toBeNull();
  });
});

describe("detectsClaudePermissionRequest", () => {
  it("recognizes a CLI approval prompt", () => {
    expect(detectsClaudePermissionRequest("Do you want to proceed? Esc to cancel")).toBe(true);
    expect(detectsClaudePermissionRequest("Do you trust the files in this folder?")).toBe(true);
  });
});
