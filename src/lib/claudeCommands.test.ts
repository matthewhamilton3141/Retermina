import { describe, expect, it } from "vitest";

import {
  buildClaudeSlashCommands,
  claudeSettingDraft,
  claudeSlashQuery,
  filterClaudeSettingOptions,
  filterClaudeSlashCommands,
  resolveClaudeSlashCommand,
} from "./claudeCommands";

describe("Claude inline settings (/model, /mode)", () => {
  it("recognizes /model and /mode drafts and captures the argument", () => {
    expect(claudeSettingDraft("/model")).toEqual({ kind: "model", query: "" });
    expect(claudeSettingDraft("/model ")).toEqual({ kind: "model", query: "" });
    expect(claudeSettingDraft("/model opus 5")).toEqual({ kind: "model", query: "opus 5" });
    expect(claudeSettingDraft("/mode plan")).toEqual({ kind: "mode", query: "plan" });
    // A partial command isn't a setting draft yet (the command menu handles it).
    expect(claudeSettingDraft("/mod")).toBeNull();
    expect(claudeSettingDraft("hello /model")).toBeNull();
  });

  it("filters options fuzzily by label and value", () => {
    expect(filterClaudeSettingOptions("model", "opus5").map((o) => o.value)).toContain(
      "claude-opus-5",
    );
    expect(filterClaudeSettingOptions("model", "4.8").map((o) => o.value)).toContain(
      "claude-opus-4-8",
    );
    expect(filterClaudeSettingOptions("mode", "full").map((o) => o.value)).toEqual([
      "bypassPermissions",
    ]);
    expect(filterClaudeSettingOptions("mode", "").length).toBe(3);
  });
});

describe("Claude slash commands", () => {
  it("opens suggestions only while the first slash token is being typed", () => {
    expect(claudeSlashQuery("/")).toBe("");
    expect(claudeSlashQuery("/comp")).toBe("comp");
    expect(claudeSlashQuery(" /comp")).toBeNull();
    expect(claudeSlashQuery("/compact focus on tests")).toBeNull();
  });

  it("merges advertised skills without replacing built-in commands", () => {
    const commands = buildClaudeSlashCommands([
      { name: "frontend-design:frontend-design", description: "Design polished UI." },
      { name: "clear", description: "Should not replace the built-in." },
    ]);

    expect(commands.find((command) => command.command === "/frontend-design:frontend-design"))
      .toMatchObject({
        group: "Skill",
        behavior: "agent",
      });
    expect(commands.filter((command) => command.command === "/clear")).toHaveLength(1);
    expect(resolveClaudeSlashCommand(commands, "/clear now")?.behavior).toBe("fresh");
  });

  it("filters by command name and description", () => {
    const commands = buildClaudeSlashCommands([]);
    expect(filterClaudeSlashCommands(commands, "comp").map((command) => command.command))
      .toContain("/compact");
    expect(filterClaudeSlashCommands(commands, "checkpoint").map((command) => command.command))
      .toContain("/rewind");
  });
});
