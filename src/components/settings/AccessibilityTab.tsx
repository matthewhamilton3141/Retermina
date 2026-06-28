/** Settings ▸ Accessibility — motion, contrast, transparency, cursor. */
import { SectionTitle, RadioGroup, Switch } from "./primitives";
import { useAppStore, type MotionPreference } from "../../store/app";

const MOTION_OPTIONS: { style: MotionPreference; label: string; desc: string }[] = [
  { style: "system",  label: "Follow system",   desc: "Match your OS “Reduce Motion” setting" },
  { style: "full",    label: "Motion on",       desc: "Always animate, even if the OS reduces motion" },
  { style: "reduced", label: "Reduced motion",  desc: "Minimize animations and transitions" },
];

/** A labelled card row wrapping a toggle Switch. */
function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="rt-card flex cursor-pointer items-center justify-between gap-3 p-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="rt-text-faint block text-xs">{desc}</span>
      </span>
      <Switch checked={checked} onChange={onChange} />
    </label>
  );
}

export default function AccessibilityTab() {
  const motionPreference     = useAppStore((s) => s.motionPreference);
  const setMotionPreference  = useAppStore((s) => s.setMotionPreference);
  const highContrast         = useAppStore((s) => s.highContrast);
  const setHighContrast      = useAppStore((s) => s.setHighContrast);
  const reduceTransparency   = useAppStore((s) => s.reduceTransparency);
  const setReduceTransparency = useAppStore((s) => s.setReduceTransparency);
  const terminalCursorBlink     = useAppStore((s) => s.terminalCursorBlink);
  const setTerminalCursorBlink  = useAppStore((s) => s.setTerminalCursorBlink);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle>Motion</SectionTitle>
        <RadioGroup options={MOTION_OPTIONS} value={motionPreference} onChange={setMotionPreference} />
        <p className="rt-text-faint mt-2 text-xs">
          Reduced motion collapses transitions and window animations to instant.
          “Follow system” tracks your OS Reduce Motion preference.
        </p>
      </section>

      <section>
        <SectionTitle>Display</SectionTitle>
        <div className="flex flex-col gap-2">
          <ToggleRow
            label="Increase contrast"
            desc="Stronger borders and darker secondary text across every theme"
            checked={highContrast}
            onChange={setHighContrast}
          />
          <ToggleRow
            label="Reduce transparency"
            desc="Turn off frosted-glass blur and translucent backgrounds"
            checked={reduceTransparency}
            onChange={setReduceTransparency}
          />
        </div>
      </section>

      <section>
        <SectionTitle>Terminal</SectionTitle>
        <ToggleRow
          label="Blinking cursor"
          desc="Animate the terminal cursor. Turn off to keep it steady."
          checked={terminalCursorBlink}
          onChange={setTerminalCursorBlink}
        />
      </section>
    </div>
  );
}
