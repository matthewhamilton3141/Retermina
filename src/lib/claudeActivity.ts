import { invoke } from "@tauri-apps/api/core";

export interface ClaudeActivityDay {
  /** Calendar day, UTC, `YYYY-MM-DD`. */
  date: string;
  lines: number;
}

export interface ClaudeActivityStats {
  days: ClaudeActivityDay[];
}

/** Total lines Claude has edited across every workspace, bucketed by UTC day. */
export async function getClaudeActivity(): Promise<ClaudeActivityStats> {
  return invoke<ClaudeActivityStats>("get_claude_activity");
}

export interface ActivityCell {
  date: string;
  lines: number;
}

export interface ActivityWeek {
  /** One cell per weekday, Sunday first; `null` pads days beyond today. */
  days: (ActivityCell | null)[];
  /** Month label to show above this week, if a new month starts within it. */
  monthLabel: string | null;
}

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build a Sunday-aligned grid of `weekCount` weeks ending on today (UTC),
 * matching how the backend buckets days. Days after today are left `null`.
 */
export function buildActivityGrid(
  totals: Map<string, number>,
  weekCount = 53,
  today: Date = new Date(),
): ActivityWeek[] {
  const todayKey = toDateKey(today);
  const endOfWeek = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + (6 - endOfWeek.getUTCDay()));
  const start = new Date(endOfWeek);
  start.setUTCDate(start.getUTCDate() - (weekCount * 7 - 1));

  const weeks: ActivityWeek[] = [];
  let lastMonth = -1;
  const cursor = new Date(start);
  for (let w = 0; w < weekCount; w += 1) {
    const days: (ActivityCell | null)[] = [];
    let monthLabel: string | null = null;
    for (let d = 0; d < 7; d += 1) {
      const key = toDateKey(cursor);
      const month = cursor.getUTCMonth();
      if ((w === 0 && d === 0) || (cursor.getUTCDate() === 1 && month !== lastMonth)) {
        lastMonth = month;
        monthLabel = MONTH_ABBREVIATIONS[month];
      }
      days.push(key > todayKey ? null : { date: key, lines: totals.get(key) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push({ days, monthLabel });
  }
  return weeks;
}

/** Quartile breakpoints (25th/50th/75th percentile) over the non-zero days. */
export function levelThresholds(cells: ActivityCell[]): [number, number, number] {
  const nonzero = cells
    .map((c) => c.lines)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (nonzero.length === 0) return [1, 1, 1];
  const at = (p: number) => nonzero[Math.min(nonzero.length - 1, Math.floor(p * (nonzero.length - 1)))];
  return [at(0.25), at(0.5), at(0.75)];
}

/** 0 = no edits, 4 = brightest. Brighter always means more, per the thresholds. */
export function activityLevel(
  lines: number,
  [q1, q2, q3]: [number, number, number],
): 0 | 1 | 2 | 3 | 4 {
  if (lines <= 0) return 0;
  if (lines >= q3) return 4;
  if (lines >= q2) return 3;
  if (lines >= q1) return 2;
  return 1;
}

export function longestStreak(weeks: ActivityWeek[]): number {
  let longest = 0;
  let current = 0;
  for (const week of weeks) {
    for (const cell of week.days) {
      if (!cell) continue;
      if (cell.lines > 0) {
        current += 1;
        longest = Math.max(longest, current);
      } else {
        current = 0;
      }
    }
  }
  return longest;
}

/**
 * Consecutive active days ending today. A day still in progress (today, no
 * edits yet) doesn't zero out yesterday's streak — it just doesn't extend it.
 */
export function currentStreak(weeks: ActivityWeek[], todayKey: string): number {
  const cells = weeks.flatMap((w) => w.days).filter((c): c is ActivityCell => c !== null);
  let idx = cells.length - 1;
  if (idx >= 0 && cells[idx].date === todayKey && cells[idx].lines === 0) idx -= 1;

  let streak = 0;
  for (; idx >= 0; idx -= 1) {
    if (cells[idx].lines <= 0) break;
    streak += 1;
  }
  return streak;
}

export function mostActiveMonth(totals: Map<string, number>): string | null {
  const byMonth = new Map<string, number>();
  for (const [date, lines] of totals) {
    const key = date.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + lines);
  }
  let best: string | null = null;
  let bestSum = 0;
  for (const [key, sum] of byMonth) {
    if (sum > bestSum) {
      bestSum = sum;
      best = key;
    }
  }
  if (!best) return null;
  const [y, m] = best.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  });
}

export function mostActiveDay(totals: Map<string, number>): { date: string; lines: number } | null {
  let best: { date: string; lines: number } | null = null;
  for (const [date, lines] of totals) {
    if (!best || lines > best.lines) best = { date, lines };
  }
  return best;
}
