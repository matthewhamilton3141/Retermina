import { describe, it, expect } from "vitest";
import { computeLineDiff, hasChanges, collapseDiff, type DiffLine } from "./diff";

describe("computeLineDiff", () => {
  it("marks identical text as all unchanged", () => {
    const diff = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(diff.every((l) => l.type === "unchanged")).toBe(true);
    expect(diff.map((l) => l.text)).toEqual(["a", "b", "c"]);
    expect(diff[0]).toMatchObject({ oldNum: 1, newNum: 1 });
  });

  it("detects a single replaced line as a remove then add", () => {
    const diff = computeLineDiff("a\nb", "a\nc");
    expect(diff).toEqual<DiffLine[]>([
      { type: "unchanged", oldNum: 1, newNum: 1, text: "a" },
      { type: "removed", oldNum: 2, text: "b" },
      { type: "added", newNum: 2, text: "c" },
    ]);
  });

  it("reports pure additions and pure deletions", () => {
    const added = computeLineDiff("a", "a\nb");
    expect(added.filter((l) => l.type === "added").map((l) => l.text)).toEqual(["b"]);

    const removed = computeLineDiff("a\nb", "a");
    expect(removed.filter((l) => l.type === "removed").map((l) => l.text)).toEqual(["b"]);
  });

  it("treats two empty blobs as a single unchanged empty line", () => {
    const diff = computeLineDiff("", "");
    expect(diff).toEqual<DiffLine[]>([{ type: "unchanged", oldNum: 1, newNum: 1, text: "" }]);
  });

  it("keeps new-file line numbers sequential across additions", () => {
    const diff = computeLineDiff("x", "a\nx\nb");
    const newNums = diff.filter((l) => l.newNum !== undefined).map((l) => l.newNum);
    expect(newNums).toEqual([1, 2, 3]);
  });
});

describe("hasChanges", () => {
  it("is false for an all-unchanged diff and true otherwise", () => {
    expect(hasChanges(computeLineDiff("a\nb", "a\nb"))).toBe(false);
    expect(hasChanges(computeLineDiff("a\nb", "a\nc"))).toBe(true);
  });
});

describe("collapseDiff", () => {
  it("drops far-away unchanged lines and inserts an ellipsis gap marker", () => {
    const oldText = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
    const newText = oldText.replace("line0", "CHANGED0").replace("line29", "CHANGED29");
    const collapsed = collapseDiff(computeLineDiff(oldText, newText), 2);

    // The big unchanged middle is gone, replaced by a single ellipsis marker.
    expect(collapsed.length).toBeLessThan(60);
    expect(collapsed.some((l) => l.text === "…")).toBe(true);
    // The changes themselves survive.
    expect(collapsed.some((l) => l.text === "CHANGED0")).toBe(true);
    expect(collapsed.some((l) => l.text === "CHANGED29")).toBe(true);
  });

  it("keeps everything when there are no large gaps", () => {
    const diff = computeLineDiff("a\nb", "a\nc");
    expect(collapseDiff(diff, 3)).toEqual(diff);
  });
});
