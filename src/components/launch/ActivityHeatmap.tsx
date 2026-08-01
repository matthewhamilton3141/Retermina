import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import Icon from "../Icon";
import {
  activityLevel,
  buildActivityGrid,
  currentStreak,
  getClaudeActivity,
  levelThresholds,
  longestStreak,
  mostActiveDay,
  mostActiveMonth,
  type ActivityCell,
} from "../../lib/claudeActivity";

type TimeRange = "year" | "month" | "week";

const RANGE_OPTIONS: { value: TimeRange; label: string; weeks: number }[] = [
  { value: "year", label: "year", weeks: 53 },
  { value: "month", label: "month", weeks: 5 },
  { value: "week", label: "week", weeks: 1 },
];

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;

const ROW_LABELS = ["", "M", "", "W", "", "F", ""];

const LEVEL_BG: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "var(--rt-surface-hover)",
  1: "color-mix(in srgb, var(--rt-accent) 25%, var(--rt-surface-hover))",
  2: "color-mix(in srgb, var(--rt-accent) 50%, var(--rt-surface-hover))",
  3: "color-mix(in srgb, var(--rt-accent) 75%, var(--rt-surface-hover))",
  4: "var(--rt-accent)",
};

function formatDay(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

interface TooltipState {
  text: string;
  x: number;
  y: number;
}

/** A fast, always-solid tooltip — replaces the browser's slow/flaky native
 *  `title` delay, which was dropping hover events on the small grid cells. */
function CellTooltip({ tooltip }: { tooltip: TooltipState | null }) {
  if (!tooltip) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium shadow-lg"
      style={{
        left: tooltip.x,
        top: tooltip.y - 6,
        background: "var(--rt-surface-strong)",
        color: "var(--rt-text)",
        border: "1px solid var(--rt-border)",
      }}
    >
      {tooltip.text}
    </div>,
    document.body,
  );
}

export function ActivityHeatmap() {
  const [totals, setTotals] = useState<Map<string, number> | null>(null);
  const [range, setRange] = useState<TimeRange>("year");
  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      getClaudeActivity()
        .then((stats) => {
          if (!active) return;
          setTotals(new Map(stats.days.map((d) => [d.date, d.lines])));
        })
        .catch(() => {
          if (active) setTotals(new Map());
        });
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const activeOption = RANGE_OPTIONS.find((o) => o.value === range) ?? RANGE_OPTIONS[0];

  const filled = totals ?? new Map<string, number>();
  const weeks = useMemo(
    () => buildActivityGrid(filled, activeOption.weeks),
    [filled, activeOption.weeks],
  );
  const cells = useMemo(
    () => weeks.flatMap((w) => w.days).filter((c): c is ActivityCell => c !== null),
    [weeks],
  );
  const thresholds = useMemo(() => levelThresholds(cells), [cells]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [weeks]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayLines = filled.get(todayKey) ?? 0;
  const totalLines = useMemo(() => cells.reduce((sum, c) => sum + c.lines, 0), [cells]);

  const longest = useMemo(() => longestStreak(weeks), [weeks]);
  const current = useMemo(() => currentStreak(weeks, todayKey), [weeks, todayKey]);
  const activeMonth = useMemo(() => mostActiveMonth(filled), [filled]);
  const activeDay = useMemo(() => mostActiveDay(filled), [filled]);

  function showTooltip(e: React.MouseEvent, text: string) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ text, x: rect.left + rect.width / 2, y: rect.top });
  }

  return (
    <section className="rt-surface w-full rounded-xl p-4">
      <CellTooltip tooltip={tooltip} />

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="rt-text-muted text-xs font-semibold uppercase tracking-wider">
            AI Line Edits
          </h2>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              {totalLines.toLocaleString()}
            </span>
            <div ref={menuRef} className="group relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="rt-text-faint flex items-center gap-0.5 text-xs"
              >
                <span>in the last {activeOption.label}</span>
                <Icon
                  name="chevronDown"
                  size={11}
                  className={`transition-opacity ${menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                />
              </button>
              {menuOpen && (
                <ul className="rt-menu absolute left-0 top-full z-50 mt-1 min-w-[110px] rounded-lg py-1 shadow-lg">
                  {RANGE_OPTIONS.map((opt) => (
                    <li key={opt.value}>
                      <button
                        type="button"
                        onClick={() => {
                          setRange(opt.value);
                          setMenuOpen(false);
                        }}
                        className={`rt-menu-item block w-full px-3 py-1.5 text-left text-xs capitalize ${
                          opt.value === range ? "bg-[var(--rt-surface-hover)]" : ""
                        }`}
                      >
                        {opt.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        <p className="rt-text-muted shrink-0 text-right text-xs">
          <span className="rt-accent-text block text-base font-semibold tabular-nums">
            {todayLines.toLocaleString()}
          </span>
          today
        </p>
      </div>

      <div ref={scrollRef} className="overflow-x-auto">
        <div className="inline-flex flex-col gap-1">
          <div
            className="relative h-[14px] pl-5"
            style={{ width: weeks.length * STEP }}
          >
            {weeks.map((week, i) =>
              week.monthLabel ? (
                <span
                  key={i}
                  className="rt-text-faint absolute top-0 whitespace-nowrap text-[10px]"
                  style={{ left: 20 + i * STEP }}
                >
                  {week.monthLabel}
                </span>
              ) : null,
            )}
          </div>
          <div className="flex gap-[3px]">
            <div className="flex flex-col gap-[3px] pr-1 text-[10px]">
              {ROW_LABELS.map((label, i) => (
                <span key={i} className="rt-text-faint flex h-[11px] w-4 items-center">
                  {label}
                </span>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.days.map((cell, di) => {
                  if (!cell) return <span key={di} className="h-[11px] w-[11px]" />;
                  const level = activityLevel(cell.lines, thresholds);
                  const label =
                    cell.lines > 0
                      ? `${cell.lines.toLocaleString()} line${cell.lines === 1 ? "" : "s"} edited on ${formatDay(cell.date)}`
                      : `No contributions on ${formatDay(cell.date)}`;
                  return (
                    <span
                      key={di}
                      onMouseEnter={(e) => showTooltip(e, label)}
                      onMouseLeave={() => setTooltip(null)}
                      className="h-[11px] w-[11px] rounded-[2px] transition-transform hover:scale-125"
                      style={{ background: LEVEL_BG[level] }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--rt-border)] pt-4 sm:grid-cols-4">
        <Stat label="Most Active Month" value={activeMonth ?? "—"} />
        <Stat label="Most Active Day" value={activeDay ? formatDay(activeDay.date) : "—"} />
        <Stat label="Longest Streak" value={`${longest}d`} />
        <Stat label="Current Streak" value={`${current}d`} />
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[10px]">
        <span className="rt-text-faint">Fewer</span>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span
            key={level}
            className="h-[11px] w-[11px] rounded-[2px]"
            style={{ background: LEVEL_BG[level] }}
          />
        ))}
        <span className="rt-text-faint">More</span>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="rt-text-faint text-[10px] font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

export default ActivityHeatmap;
