/** Settings ▸ Appearance — toolbar layout + workspace text scale. */
import { SectionTitle, RadioGroup } from "./primitives";
import { useAppStore, type ToolbarStyle, type TopBarStyle } from "../../store/app";

const TOOLBAR_OPTIONS: { style: ToolbarStyle; label: string; desc: string }[] = [
  { style: "dropdown", label: "Panels dropdown", desc: "One button opens a panel checklist" },
  { style: "icons",    label: "Icon strip",      desc: "Individual icon buttons per panel" },
];

const TOPBAR_OPTIONS: { style: TopBarStyle; label: string; desc: string }[] = [
  { style: "icon-only",     label: "Icons only",     desc: "Compact — icons with tooltips" },
  { style: "icon-and-text", label: "Icons + labels", desc: "Spacious — icon beside text" },
];

export default function AppearanceTab() {
  const toolbarStyle    = useAppStore((s) => s.toolbarStyle);
  const setToolbarStyle = useAppStore((s) => s.setToolbarStyle);
  const topBarStyle     = useAppStore((s) => s.topBarStyle);
  const setTopBarStyle  = useAppStore((s) => s.setTopBarStyle);
  const uiScale         = useAppStore((s) => s.uiScale);
  const setUiScale      = useAppStore((s) => s.setUiScale);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle>Top bar labels</SectionTitle>
        <RadioGroup options={TOPBAR_OPTIONS} value={topBarStyle} onChange={setTopBarStyle} />
      </section>

      <section>
        <SectionTitle>Panel toggles</SectionTitle>
        <RadioGroup options={TOOLBAR_OPTIONS} value={toolbarStyle} onChange={setToolbarStyle} />
      </section>

      <section>
        <SectionTitle>Workspace text scale</SectionTitle>
        <div className="rt-card flex items-center gap-4 p-4">
          <input
            type="range"
            min={80}
            max={130}
            step={5}
            value={uiScale}
            onChange={(e) => setUiScale(Number(e.target.value))}
            className="flex-1 accent-[var(--rt-accent)]"
          />
          <span className="w-12 text-right text-sm font-medium tabular-nums">{uiScale}%</span>
          {uiScale !== 100 && (
            <button type="button" onClick={() => setUiScale(100)} className="rt-btn-outline px-2 py-1 text-xs">
              Reset
            </button>
          )}
        </div>
        <p className="rt-text-faint mt-2 text-xs">
          Scales every panel and toolbar across the whole workspace. Individual
          panels can still be fine-tuned with their own +/- controls.
        </p>
      </section>
    </div>
  );
}
