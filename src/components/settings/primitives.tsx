/**
 * Shared settings primitives.
 *
 * Small presentational pieces used across more than one settings tab. Tab-
 * specific widgets (e.g. the theme PreviewCard) stay with their tab.
 */

/** Uppercase, tracked-out section label. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="rt-text-faint mb-2 text-[10px] font-semibold uppercase tracking-widest">
      {children}
    </p>
  );
}

/** Small accent-coloured toggle switch. */
export function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
      style={{ backgroundColor: checked ? "var(--rt-accent)" : "var(--rt-surface-hover)" }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full shadow transition-all"
        style={{
          left: checked ? "1.125rem" : "0.125rem",
          backgroundColor: checked ? "var(--rt-accent-contrast, #fff)" : "#fff",
        }}
      />
    </button>
  );
}

/** Card-styled single-choice radio list. */
export function RadioGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { style: T; label: string; desc: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map(({ style, label, desc }) => {
        const active = value === style;
        return (
          <button
            key={style}
            type="button"
            onClick={() => onChange(style)}
            className={`rt-card flex w-full items-start gap-3 p-3 text-left ${active ? "rt-btn-active" : ""}`}
          >
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
              active ? "border-[var(--rt-accent)] bg-[var(--rt-accent)]" : "border-[var(--rt-border)]"
            }`}>
              {active && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--rt-accent-contrast, #fff)" }} />}
            </span>
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="rt-text-faint block text-xs">{desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
