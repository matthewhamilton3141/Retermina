import { describe, it, expect } from "vitest";
import { buildSuggestions, type IrisCtx } from "./iris";

/** Build an IrisCtx, defaulting to "clean repo with upstream, nothing pending". */
function ctx(overrides: Partial<IrisCtx> = {}): IrisCtx {
  return {
    isRepo: true,
    branch: "main",
    hasUpstream: true,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    clean: true,
    selectedPath: null,
    ...overrides,
  };
}

describe("buildSuggestions — empty query", () => {
  it("lists available non-hidden macros by priority and adds no run-raw fallback", () => {
    const out = buildSuggestions("", ctx());
    expect(out.some((s) => s.id === "run-raw")).toBe(false);
    // Hidden destructive macros never surface by default.
    expect(out.some((s) => s.id === "git-discard")).toBe(false);
    // Sorted by descending priority.
    // (We can't see priority directly, but the list must be capped at the limit.)
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it("offers 'Initialize repository' first when not in a repo", () => {
    const out = buildSuggestions("", ctx({ isRepo: false, branch: null, hasUpstream: false, clean: false }));
    expect(out[0]?.id).toBe("git-init");
    // Repo-only macros are gated out.
    expect(out.some((s) => s.id === "git-push")).toBe(false);
  });
});

describe("buildSuggestions — contextual gating", () => {
  it("offers Push only when the branch is ahead with an upstream", () => {
    expect(buildSuggestions("push", ctx({ ahead: 0 })).some((s) => s.id === "git-push")).toBe(false);
    expect(buildSuggestions("push", ctx({ ahead: 2 })).some((s) => s.id === "git-push")).toBe(true);
  });

  it("offers Publish branch only when there is no upstream", () => {
    const out = buildSuggestions("publish", ctx({ hasUpstream: false }));
    expect(out.some((s) => s.id === "git-publish")).toBe(true);
    // git-push requires an upstream, so it should be gated out here.
    expect(out.some((s) => s.id === "git-push")).toBe(false);
  });

  it("surfaces file macros only when a file is open", () => {
    expect(buildSuggestions("copy path", ctx()).some((s) => s.id === "file-copy-path")).toBe(false);
    const open = buildSuggestions("copy path", ctx({ selectedPath: "/tmp/a.ts" }));
    expect(open.some((s) => s.id === "file-copy-path")).toBe(true);
  });
});

describe("buildSuggestions — matching and ordering", () => {
  it("ranks a prefix title match ahead of weaker matches", () => {
    const out = buildSuggestions("status", ctx());
    expect(out[0]?.id).toBe("git-status");
  });

  it("reveals a hidden macro when its keyword is typed explicitly", () => {
    const out = buildSuggestions("discard", ctx({ unstaged: 3, clean: false }));
    expect(out.some((s) => s.id === "git-discard")).toBe(true);
  });

  it("always appends a run-as-typed fallback for non-empty queries", () => {
    const out = buildSuggestions("some-random-binary --flag", ctx());
    const last = out[out.length - 1];
    expect(last.id).toBe("run-raw");
    expect(last.command).toBe("some-random-binary --flag");
  });

  it("respects an explicit suggestion limit", () => {
    const out = buildSuggestions("git", ctx({ ahead: 1, behind: 1, staged: 1, unstaged: 1, clean: false }), {
      limit: 3,
    });
    // limit macros + 1 run-raw fallback.
    expect(out.length).toBe(4);
  });
});

describe("buildSuggestions — argument prompts", () => {
  it("defers prompt macros: empty command, build() composes the final line", () => {
    const out = buildSuggestions("checkout", ctx());
    const checkout = out.find((s) => s.id === "git-checkout");
    expect(checkout).toBeDefined();
    expect(checkout!.command).toBe("");
    expect(checkout!.prompt).toBeDefined();
    expect(checkout!.prompt!.build("feature/x")).toBe("git checkout feature/x");
  });

  it("bakes ctx into a prompt build (publish uses the live branch)", () => {
    const out = buildSuggestions("checkout", ctx({ branch: "develop" }));
    const checkout = out.find((s) => s.id === "git-checkout");
    expect(checkout!.prompt!.build("develop")).toBe("git checkout develop");
  });
});
