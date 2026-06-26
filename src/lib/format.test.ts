import { describe, it, expect } from "vitest";
import { prettyPath, parentDir } from "./format";

describe("prettyPath", () => {
  it("collapses the macOS home directory to ~", () => {
    expect(prettyPath("/Users/matthew/Documents/retermina")).toBe("~/Documents/retermina");
  });

  it("collapses Linux and Windows home directories too", () => {
    expect(prettyPath("/home/bob/projects")).toBe("~/projects");
    expect(prettyPath("C:\\Users\\bob\\projects")).toBe("~\\projects");
  });

  it("leaves a path with no recognizable home untouched", () => {
    expect(prettyPath("/opt/tools/bin")).toBe("/opt/tools/bin");
  });
});

describe("parentDir", () => {
  it("returns the home-collapsed parent of a path", () => {
    expect(parentDir("/Users/matthew/Documents/retermina")).toBe("~/Documents");
  });

  it("ignores a trailing slash when finding the parent", () => {
    expect(parentDir("/Users/matthew/Documents/retermina/")).toBe("~/Documents");
  });

  it("falls back to the pretty path for a top-level entry", () => {
    expect(parentDir("/foo")).toBe("/foo");
  });
});
