import { useRef, useState } from "react";

import FloatingMenu from "../FloatingMenu";
import Icon, { type IconName } from "../Icon";
import { CLAUDE_MODE_OPTIONS, CLAUDE_MODEL_OPTIONS } from "../../lib/claudeCommands";
import type { ClaudeTokenUsage } from "../../lib/fs";
import type {
  ClaudePermissionMode,
  ClaudeRunStatus,
} from "../../lib/claudeTranscript";
import type {
  ClaudeModelChoice,
  ClaudePanelView,
} from "../../store/claudeSessions";

interface PickerOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

interface PickerProps<T extends string> {
  icon: IconName;
  caption: string;
  label: string;
  value: T;
  options: PickerOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}

function Picker<T extends string>({
  icon,
  caption,
  label,
  value,
  options,
  disabled,
  onChange,
}: PickerProps<T>) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setAnchor({ x: rect.left, y: rect.top - 5 });
        }}
        className="rt-btn flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[0.68em] font-medium disabled:opacity-40"
        aria-label={`${caption}: ${label}`}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
      >
        <Icon name={icon} size="0.82em" className="rt-text-faint" />
        <span className="rt-text-faint">{caption}</span>
        <span className="max-w-32 truncate">{label}</span>
        <Icon name="chevronDown" size="0.72em" className="rt-text-faint" />
      </button>

      {anchor && (
        <FloatingMenu
          x={anchor.x}
          y={anchor.y}
          onClose={() => setAnchor(null)}
          className="rt-claude-menu max-h-80 w-64 overflow-y-auto p-1.5"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(option.value);
                  setAnchor(null);
                }}
                className="rt-menu-item flex w-full items-start gap-2 px-2 py-2 text-left"
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    selected ? "bg-[var(--rt-accent)]" : "bg-[var(--rt-border)]"
                  }`}
                />
                <span className="min-w-0">
                  <span className={`block text-xs font-medium ${selected ? "rt-accent-text" : ""}`}>
                    {option.label}
                  </span>
                  <span className="rt-text-faint mt-0.5 line-clamp-2 block text-[10px] leading-snug">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </FloatingMenu>
      )}
    </>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString();
}

function ContextDonut({ pct, color }: { pct: number; color: string }) {
  return (
    <svg width="1.35em" height="1.35em" viewBox="0 0 36 36" className="shrink-0">
      <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--rt-border)" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r="15.9155"
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${Math.max(pct * 100, 0.5)} 100`}
        transform="rotate(-90 18 18)"
        className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
      />
    </svg>
  );
}

function ContextPopover({
  usage,
  contextPct,
  contextColor,
}: {
  usage: ClaudeTokenUsage | null;
  contextPct: number;
  contextColor: string;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const contextLabel =
    usage && usage.contextTokens > 0
      ? `${formatTokens(usage.contextTokens)} / ${formatTokens(usage.contextWindow)}`
      : "—";
  const freeTokens =
    usage && usage.contextWindow > 0
      ? Math.max(0, usage.contextWindow - usage.contextTokens)
      : 0;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setAnchor({ x: rect.left, y: rect.top - 5 });
        }}
        className="rt-btn flex h-7 shrink-0 items-center gap-1.5 px-2 text-[0.66em] font-medium tabular-nums"
        title="Context window"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
      >
        <ContextDonut pct={contextPct} color={contextColor} />
        <span className="rt-text-faint">Context</span>
        <span>{contextLabel}</span>
      </button>

      {anchor && (
        <FloatingMenu
          x={anchor.x}
          y={anchor.y}
          placement="above"
          onClose={() => setAnchor(null)}
          className="rt-claude-menu w-56 p-3"
        >
          {usage && usage.contextWindow > 0 ? (
            <>
              <div className="mb-2.5 flex items-center gap-2.5">
                <ContextDonut pct={contextPct} color={contextColor} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold">Context window</p>
                  <p className="rt-text-faint text-[10px]">
                    {Math.round(contextPct * 100)}% used
                    {usage.model ? ` · ${usage.model.replace(/^claude-/, "")}` : ""}
                  </p>
                </div>
              </div>
              <div className="space-y-1.5 border-t border-[var(--rt-border)] pt-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="rt-text-faint text-[10px]">Used</span>
                  <span className="font-mono text-[10px] tabular-nums">
                    {formatTokens(usage.contextTokens)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="rt-text-faint text-[10px]">Free</span>
                  <span className="font-mono text-[10px] tabular-nums">
                    {formatTokens(freeTokens)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="rt-text-faint text-[10px]">Window</span>
                  <span className="font-mono text-[10px] tabular-nums">
                    {formatTokens(usage.contextWindow)}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div>
              <p className="text-xs font-semibold">Context is loading</p>
              <p className="rt-text-faint mt-1 text-[10px] leading-relaxed">
                Window usage appears after Claude writes the first session record.
              </p>
            </div>
          )}
        </FloatingMenu>
      )}
    </>
  );
}

function UsagePopover({ usage }: { usage: ClaudeTokenUsage | null }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const total = usage
    ? usage.inputTokens +
      usage.outputTokens +
      usage.cacheReadTokens +
      usage.cacheCreationTokens
    : 0;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setAnchor({ x: rect.left, y: rect.top - 5 });
        }}
        className="rt-btn flex h-7 shrink-0 items-center gap-1.5 px-2 text-[0.66em] font-medium tabular-nums"
        title="Claude usage"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
      >
        <span className="rt-text-faint">Usage</span>
        <span>{usage ? formatTokens(total) : "—"}</span>
      </button>

      {anchor && (
        <FloatingMenu
          x={anchor.x}
          y={anchor.y}
          placement="above"
          onClose={() => setAnchor(null)}
          className="rt-claude-menu w-60 p-3"
        >
          {usage ? (
            <>
              <div className="mb-2.5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold">Workspace usage</p>
                  <p className="rt-text-faint text-[10px]">
                    {usage.sessionCount} {usage.sessionCount === 1 ? "session" : "sessions"}
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {formatTokens(total)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[var(--rt-border)] pt-2">
                {[
                  ["Input", usage.inputTokens],
                  ["Output", usage.outputTokens],
                  ["Cache read", usage.cacheReadTokens],
                  ["Cache write", usage.cacheCreationTokens],
                ].map(([name, value]) => (
                  <div key={name as string} className="flex items-baseline justify-between gap-2">
                    <span className="rt-text-faint text-[10px]">{name}</span>
                    <span className="font-mono text-[10px] tabular-nums">
                      {formatTokens(value as number)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rt-text-faint mt-2 flex justify-between border-t border-[var(--rt-border)] pt-2 text-[10px]">
                <span>Estimated cost</span>
                <span className="font-mono">${usage.estimatedCostUsd.toFixed(2)}</span>
              </div>
            </>
          ) : (
            <div>
              <p className="text-xs font-semibold">Usage is loading</p>
              <p className="rt-text-faint mt-1 text-[10px] leading-relaxed">
                Totals appear after Claude writes the first session record.
              </p>
            </div>
          )}
        </FloatingMenu>
      )}
    </>
  );
}

const STATUS_LABEL: Record<ClaudeRunStatus, string> = {
  connecting: "Connecting",
  idle: "Ready",
  running: "Working",
  waiting: "Needs input",
  limited: "Limit reached",
  exited: "Exited",
};

const STATUS_COLOR: Record<ClaudeRunStatus, string> = {
  connecting: "bg-sky-500",
  idle: "bg-emerald-500",
  running: "bg-[var(--rt-accent)]",
  waiting: "bg-amber-500",
  limited: "bg-amber-500",
  exited: "bg-red-500",
};

// Shared with the inline `/mode` / `/model` command menus.
const MODE_OPTIONS: PickerOption<ClaudePermissionMode>[] = CLAUDE_MODE_OPTIONS;

const MODE_LABEL: Record<ClaudePermissionMode, string> = {
  acceptEdits: "Auto-accept",
  auto: "Auto-accept",
  bypassPermissions: "Full access",
  default: "Auto-accept",
  dontAsk: "Auto-accept",
  plan: "Plan",
};

// Shared with the inline `/model` command menu.
const MODEL_OPTIONS: PickerOption<ClaudeModelChoice>[] = CLAUDE_MODEL_OPTIONS;

/** "claude-opus-4-8" → "Opus 4.8", "claude-sonnet-4-6" → "Sonnet 4.6". */
function displayModel(model: string | null): string {
  if (!model) return "Default model";
  return model
    .replace(/^claude-/, "")
    .replace(/-(\d{8})$/, "") // strip a date snapshot suffix
    .replace(/(\d)-(\d)/g, "$1.$2") // 4-8 → 4.8
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** An alias like "opus"/"sonnet" ("latest"), as opposed to a pinned version id. */
function isModelAlias(choice: ClaudeModelChoice): boolean {
  return choice !== "default" && !choice.startsWith("claude-");
}

export interface ClaudeControlBarProps {
  status: ClaudeRunStatus;
  view: ClaudePanelView;
  permissionMode: ClaudePermissionMode;
  modelChoice: ClaudeModelChoice;
  model: string | null;
  usage: ClaudeTokenUsage | null;
  contextPct: number;
  contextColor: string;
  controlsDisabled: boolean;
  onViewChange: (view: ClaudePanelView) => void;
  onPermissionModeChange: (mode: ClaudePermissionMode) => void;
  onModelChange: (model: ClaudeModelChoice) => void;
}

export function ClaudeControlBar({
  status,
  view,
  permissionMode,
  modelChoice,
  model,
  usage,
  contextPct,
  contextColor,
  controlsDisabled,
  onViewChange,
  onPermissionModeChange,
  onModelChange,
}: ClaudeControlBarProps) {
  // Show the concrete running version whenever we know it — so "Opus (latest)"
  // reads as e.g. "Opus 4.8" once the session is live, not a vague "latest".
  const runningLabel = model ? displayModel(model) : null;
  const optionLabel =
    MODEL_OPTIONS.find((option) => option.value === modelChoice)?.label ?? modelChoice;
  const modelLabel =
    modelChoice === "default"
      ? runningLabel ?? "Default model"
      : isModelAlias(modelChoice)
        ? runningLabel ?? optionLabel
        : optionLabel;

  return (
    <footer className="rt-claude-dock flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-t border-[var(--rt-border)] px-2">
      <span className="flex shrink-0 items-center gap-1.5 px-1.5 text-[0.68em] font-medium">
        <span className="relative flex h-2 w-2">
          {status === "running" && (
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-45 motion-reduce:animate-none ${STATUS_COLOR[status]}`} />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${STATUS_COLOR[status]}`} />
        </span>
        <span className="rt-text-muted whitespace-nowrap">{STATUS_LABEL[status]}</span>
      </span>

      <span className="mx-1 h-3.5 w-px shrink-0 bg-[var(--rt-border)]" />

      <Picker
        icon="claudeLogo"
        caption="Model"
        label={modelLabel}
        value={modelChoice}
        options={MODEL_OPTIONS}
        disabled={controlsDisabled}
        onChange={onModelChange}
      />
      <Picker
        icon="spark"
        caption="Mode"
        label={MODE_LABEL[permissionMode]}
        value={permissionMode}
        options={MODE_OPTIONS}
        disabled={controlsDisabled}
        onChange={onPermissionModeChange}
      />

      <span className="min-w-1 flex-1" />

      <ContextPopover usage={usage} contextPct={contextPct} contextColor={contextColor} />
      <UsagePopover usage={usage} />

      <div className="ml-0.5 flex shrink-0 overflow-hidden rounded-md border border-[var(--rt-border)]">
        {(["agent", "cli"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onViewChange(option)}
            className={`px-2 py-1 text-[0.66em] font-semibold ${
              view === option ? "rt-btn-active" : "rt-btn"
            }`}
            aria-pressed={view === option}
          >
            {option === "agent" ? "Agent" : "CLI"}
          </button>
        ))}
      </div>
    </footer>
  );
}

export default ClaudeControlBar;
