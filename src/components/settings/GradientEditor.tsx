/** Settings ▸ Appearance — editor for the user-defined backdrop gradient. */
import Icon from "../Icon";
import {
  MAX_GRADIENT_STOPS,
  gradientToCss,
  type CustomGradient,
  type GradientStop,
} from "../../lib/gradient";

export default function GradientEditor({
  value,
  onChange,
}: {
  value: CustomGradient;
  onChange: (g: CustomGradient) => void;
}) {
  const setStop = (i: number, patch: Partial<GradientStop>) =>
    onChange({ ...value, stops: value.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const addStop = () => {
    if (value.stops.length >= MAX_GRADIENT_STOPS) return;
    const first = value.stops[0];
    const last = value.stops[value.stops.length - 1];
    const mid = Math.round((first.pos + last.pos) / 2);
    onChange({
      ...value,
      stops: [...value.stops.slice(0, -1), { color: last.color, pos: mid }, last],
    });
  };

  const removeStop = (i: number) => {
    if (value.stops.length <= 2) return;
    onChange({ ...value, stops: value.stops.filter((_, j) => j !== i) });
  };

  return (
    <div className="rt-card flex flex-col gap-3 p-3">
      {/* Live preview */}
      <div
        className="h-16 w-full rounded-md border border-[var(--rt-border)]"
        style={{ backgroundImage: gradientToCss(value) }}
      />

      {/* Type + angle */}
      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-[var(--rt-border)]">
          {(["linear", "radial"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChange({ ...value, type: t })}
              className={`px-3 py-1 text-xs font-medium capitalize ${value.type === t ? "rt-btn-active" : "rt-btn"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {value.type === "linear" && (
          <label className="flex flex-1 items-center gap-2">
            <span className="rt-text-faint text-xs">Angle</span>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={value.angle}
              onChange={(e) => onChange({ ...value, angle: Number(e.target.value) })}
              className="flex-1 accent-[var(--rt-accent)]"
            />
            <span className="w-10 text-right text-xs tabular-nums">{value.angle}°</span>
          </label>
        )}
      </div>

      {/* Colour stops */}
      <div className="flex flex-col gap-2">
        {value.stops.map((stop, i) => (
          <div key={i} className="flex items-center gap-2">
            <label
              className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-[var(--rt-border)]"
              style={{ backgroundColor: stop.color }}
              title="Stop colour"
            >
              <input
                type="color"
                value={stop.color}
                onChange={(e) => setStop(i, { color: e.target.value })}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={stop.pos}
              onChange={(e) => setStop(i, { pos: Number(e.target.value) })}
              className="flex-1 accent-[var(--rt-accent)]"
              aria-label={`Stop ${i + 1} position`}
            />
            <span className="w-9 text-right text-xs tabular-nums">{stop.pos}%</span>
            <button
              type="button"
              onClick={() => removeStop(i)}
              disabled={value.stops.length <= 2}
              title="Remove stop"
              className="rt-btn rt-btn-danger flex h-6 w-6 shrink-0 items-center justify-center rounded disabled:opacity-30"
            >
              <Icon name="close" size={12} aria-label="Remove stop" />
            </button>
          </div>
        ))}
      </div>

      {value.stops.length < MAX_GRADIENT_STOPS && (
        <button
          type="button"
          onClick={addStop}
          className="rt-btn-outline flex items-center gap-1.5 self-start px-2.5 py-1 text-xs"
        >
          <Icon name="plus" size={12} /> Add colour
        </button>
      )}
    </div>
  );
}
