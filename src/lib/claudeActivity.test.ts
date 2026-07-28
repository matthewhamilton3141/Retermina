import { describe, expect, it } from "vitest";

import {
  activityLevel,
  buildActivityGrid,
  currentStreak,
  levelThresholds,
  longestStreak,
  mostActiveDay,
  mostActiveMonth,
  type ActivityCell,
} from "./claudeActivity";

describe("buildActivityGrid", () => {
  it("ends on today and pads no days beyond it", () => {
    const today = new Date("2026-07-28T12:00:00.000Z");
    const weeks = buildActivityGrid(new Map(), 53, today);
    const cells = weeks.flatMap((w) => w.days).filter((c): c is ActivityCell => c !== null);
    expect(cells[cells.length - 1].date).toBe("2026-07-28");
    expect(cells.every((c) => c.date <= "2026-07-28")).toBe(true);
  });

  it("labels the first column's month even mid-month", () => {
    const today = new Date("2026-07-28T00:00:00.000Z");
    const weeks = buildActivityGrid(new Map(), 4, today);
    expect(weeks[0].monthLabel).not.toBeNull();
  });

  it("uses abbreviated month names, not single letters", () => {
    // A wide-enough window to span a January and cross into February.
    const today = new Date("2026-02-15T00:00:00.000Z");
    const weeks = buildActivityGrid(new Map(), 10, today);
    const labels = weeks.map((w) => w.monthLabel).filter((l): l is string => l !== null);
    expect(labels).toContain("Jan");
    expect(labels).toContain("Feb");
    for (const label of labels) expect(label.length).toBeGreaterThan(1);
  });

  it("looks up totals by UTC day key", () => {
    const today = new Date("2026-07-28T00:00:00.000Z");
    const totals = new Map([["2026-07-28", 42]]);
    const weeks = buildActivityGrid(totals, 1, today);
    const cells = weeks.flatMap((w) => w.days).filter((c): c is ActivityCell => c !== null);
    const todayCell = cells.find((c) => c.date === "2026-07-28");
    expect(todayCell?.lines).toBe(42);
  });
});

describe("activityLevel", () => {
  it("maps zero lines to level 0", () => {
    expect(activityLevel(0, [1, 2, 3])).toBe(0);
  });

  it("brighter always means more", () => {
    const thresholds = levelThresholds([
      { date: "a", lines: 1 },
      { date: "b", lines: 5 },
      { date: "c", lines: 10 },
      { date: "d", lines: 50 },
    ]);
    const levels = [1, 5, 10, 50].map((lines) => activityLevel(lines, thresholds));
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    }
  });
});

describe("streaks", () => {
  const today = new Date("2026-07-28T00:00:00.000Z");

  it("counts consecutive active days", () => {
    const totals = new Map([
      ["2026-07-26", 10],
      ["2026-07-27", 5],
      ["2026-07-28", 3],
    ]);
    const weeks = buildActivityGrid(totals, 2, today);
    expect(longestStreak(weeks)).toBe(3);
    expect(currentStreak(weeks, "2026-07-28")).toBe(3);
  });

  it("doesn't zero the streak just because today has no edits yet", () => {
    const totals = new Map([
      ["2026-07-26", 10],
      ["2026-07-27", 5],
    ]);
    const weeks = buildActivityGrid(totals, 2, today);
    expect(currentStreak(weeks, "2026-07-28")).toBe(2);
  });

  it("only counts the run touching today, not an earlier one separated by a gap", () => {
    const totals = new Map([
      ["2026-07-25", 10],
      // 07-26 is a gap
      ["2026-07-27", 5],
      // 07-28 (today) has no edits yet — covered by the grace day
    ]);
    const weeks = buildActivityGrid(totals, 2, today);
    expect(currentStreak(weeks, "2026-07-28")).toBe(1);
  });

  it("is zero once the gap reaches today with no grace day to bridge it", () => {
    const totals = new Map([["2026-07-25", 10]]);
    const weeks = buildActivityGrid(totals, 2, today);
    expect(currentStreak(weeks, "2026-07-28")).toBe(0);
  });
});

describe("mostActiveMonth / mostActiveDay", () => {
  it("picks the highest-total month and single day", () => {
    const totals = new Map([
      ["2026-06-01", 100],
      ["2026-07-01", 50],
      ["2026-07-02", 50],
    ]);
    expect(mostActiveMonth(totals)).toBe("June");
    expect(mostActiveDay(totals)?.date).toBe("2026-06-01");
  });

  it("returns null for empty totals", () => {
    expect(mostActiveMonth(new Map())).toBeNull();
    expect(mostActiveDay(new Map())).toBeNull();
  });
});
