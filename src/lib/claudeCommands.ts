import type { ClaudePermissionMode, ClaudeSkillDefinition } from "./claudeTranscript";

export type ClaudeSlashCommandBehavior = "agent" | "cli" | "fresh" | "setting";
export type ClaudeSlashCommandGroup = "Session" | "Project" | "Settings" | "Skill";

export interface ClaudeSlashCommand {
  command: `/${string}`;
  usage: string;
  description: string;
  group: ClaudeSlashCommandGroup;
  behavior: ClaudeSlashCommandBehavior;
  acceptsArguments?: boolean;
}

/**
 * Deliberately focuses on stable, useful commands available in the installed
 * Claude Code 2.1 line. The TUI still accepts every other built-in command.
 */
export const CORE_CLAUDE_SLASH_COMMANDS: readonly ClaudeSlashCommand[] = [
  {
    command: "/clear",
    usage: "/clear",
    description: "Start a fresh conversation in this workspace.",
    group: "Session",
    behavior: "fresh",
  },
  {
    command: "/compact",
    usage: "/compact [focus instructions]",
    description: "Summarize older context and keep working.",
    group: "Session",
    behavior: "cli",
    acceptsArguments: true,
  },
  {
    command: "/context",
    usage: "/context [all]",
    description: "Inspect what is using the context window.",
    group: "Session",
    behavior: "cli",
    acceptsArguments: true,
  },
  {
    command: "/usage",
    usage: "/usage",
    description: "View plan limits and token usage.",
    group: "Session",
    behavior: "cli",
  },
  {
    command: "/rewind",
    usage: "/rewind",
    description: "Restore code or conversation from a checkpoint.",
    group: "Session",
    behavior: "cli",
  },
  {
    command: "/resume",
    usage: "/resume [session]",
    description: "Open an earlier Claude Code session.",
    group: "Session",
    behavior: "cli",
    acceptsArguments: true,
  },
  {
    command: "/export",
    usage: "/export [filename]",
    description: "Export this conversation as plain text.",
    group: "Session",
    behavior: "cli",
    acceptsArguments: true,
  },
  {
    command: "/init",
    usage: "/init",
    description: "Create or improve the project CLAUDE.md guide.",
    group: "Project",
    behavior: "agent",
  },
  {
    command: "/plan",
    usage: "/plan [task]",
    description: "Enter plan mode, optionally with a task.",
    group: "Project",
    behavior: "agent",
    acceptsArguments: true,
  },
  {
    command: "/simplify",
    usage: "/simplify [target]",
    description: "Review changed code for cleanup opportunities.",
    group: "Project",
    behavior: "agent",
    acceptsArguments: true,
  },
  {
    command: "/security-review",
    usage: "/security-review",
    description: "Review pending changes for security vulnerabilities.",
    group: "Project",
    behavior: "agent",
  },
  {
    command: "/doctor",
    usage: "/doctor",
    description: "Diagnose Claude Code setup and project guidance.",
    group: "Project",
    behavior: "agent",
  },
  {
    command: "/model",
    usage: "/model",
    description: "Switch the model — picks inline on the agent side.",
    group: "Settings",
    behavior: "setting",
    acceptsArguments: true,
  },
  {
    command: "/mode",
    usage: "/mode",
    description: "Switch the permission mode — Plan, Auto-accept, or Full access.",
    group: "Settings",
    behavior: "setting",
    acceptsArguments: true,
  },
  {
    command: "/permissions",
    usage: "/permissions",
    description: "Manage allow, ask, and deny rules.",
    group: "Settings",
    behavior: "cli",
  },
  {
    command: "/memory",
    usage: "/memory",
    description: "Manage CLAUDE.md and auto-memory.",
    group: "Settings",
    behavior: "cli",
  },
  {
    command: "/config",
    usage: "/config [key=value]",
    description: "Open or update Claude Code settings.",
    group: "Settings",
    behavior: "cli",
    acceptsArguments: true,
  },
  {
    command: "/skills",
    usage: "/skills",
    description: "Browse the skills available to Claude.",
    group: "Settings",
    behavior: "cli",
  },
  {
    command: "/status",
    usage: "/status",
    description: "View model, account, and connection status.",
    group: "Settings",
    behavior: "cli",
  },
  {
    command: "/help",
    usage: "/help",
    description: "Show every command supported by this Claude install.",
    group: "Settings",
    behavior: "cli",
  },
];

export function buildClaudeSlashCommands(
  skills: readonly ClaudeSkillDefinition[],
): ClaudeSlashCommand[] {
  const commands = new Map(
    CORE_CLAUDE_SLASH_COMMANDS.map((command) => [command.command, command] as const),
  );
  for (const skill of skills) {
    const name = skill.name.trim().replace(/^\/+/, "");
    if (!name) continue;
    const command = `/${name}` as const;
    if (commands.has(command)) continue;
    commands.set(command, {
      command,
      usage: command,
      description: skill.description || "Run this Claude Code skill.",
      group: "Skill",
      behavior: "agent",
      acceptsArguments: true,
    });
  }
  return [...commands.values()];
}

/** Return the command-menu query while the first token is still being typed. */
export function claudeSlashQuery(draft: string): string | null {
  const match = draft.match(/^\/([^\s]*)$/);
  return match ? match[1].toLowerCase() : null;
}

export function filterClaudeSlashCommands(
  commands: readonly ClaudeSlashCommand[],
  query: string,
): ClaudeSlashCommand[] {
  const normalized = query.toLowerCase();
  if (!normalized) return [...commands];
  return commands.filter((command) => {
    const name = command.command.slice(1).toLowerCase();
    return (
      name.startsWith(normalized) ||
      name.includes(normalized) ||
      command.description.toLowerCase().includes(normalized)
    );
  });
}

export function resolveClaudeSlashCommand(
  commands: readonly ClaudeSlashCommand[],
  value: string,
): ClaudeSlashCommand | null {
  const token = value.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (!token?.startsWith("/")) return null;
  return commands.find((command) => command.command.toLowerCase() === token) ?? null;
}

// ── /model and /mode inline settings ──────────────────────────────────────────
// One source of truth for the choices, shared by the bottom-dock pickers and the
// inline `/model` / `/mode` command menus.

export type ClaudeSettingKind = "model" | "mode";

export interface ClaudeSettingOption<V extends string = string> {
  value: V;
  label: string;
  description: string;
}

/** Specific versions rather than vague "latest" aliases. */
export const CLAUDE_MODEL_OPTIONS: ClaudeSettingOption[] = [
  { value: "default", label: "Default", description: "Use the model configured in Claude Code." },
  { value: "claude-opus-5", label: "Opus 5", description: "Newest Opus — the most capable model." },
  { value: "claude-fable-5", label: "Fable 5", description: "Long-horizon agentic model. Runs on usage credits." },
  { value: "claude-opus-4-8", label: "Opus 4.8", description: "Previous Opus — still excellent for hard work." },
  { value: "claude-opus-4-7", label: "Opus 4.7", description: "The earlier Opus release." },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6", description: "Fast, capable default for most coding tasks." },
  { value: "claude-haiku-4-5", label: "Haiku 4.5", description: "Fastest and cheapest for simple tasks." },
];

/** Only the modes that actually work for the headless agent. */
export const CLAUDE_MODE_OPTIONS: ClaudeSettingOption<ClaudePermissionMode>[] = [
  { value: "plan", label: "Plan", description: "Explore and design without editing files or running commands." },
  { value: "acceptEdits", label: "Auto-accept", description: "Apply edits and run commands automatically. Good default." },
  { value: "bypassPermissions", label: "Full access", description: "Run everything, no checks. Trusted work only." },
];

export function claudeSettingOptions(kind: ClaudeSettingKind): ClaudeSettingOption[] {
  return kind === "model" ? CLAUDE_MODEL_OPTIONS : CLAUDE_MODE_OPTIONS;
}

/** Filter a setting's options by a free-text query (label or value substring). */
export function filterClaudeSettingOptions(
  kind: ClaudeSettingKind,
  query: string,
): ClaudeSettingOption[] {
  const normalized = query.trim().toLowerCase();
  const options = claudeSettingOptions(kind);
  if (!normalized) return options;
  const compact = normalized.replace(/[\s.-]/g, "");
  return options.filter((option) => {
    const haystack = `${option.label} ${option.value}`.toLowerCase();
    return haystack.includes(normalized) || haystack.replace(/[\s.-]/g, "").includes(compact);
  });
}

/**
 * If `draft` is an inline setting command (`/model …` or `/mode …`), return which
 * setting it targets and the free-text argument typed so far. `null` otherwise.
 */
export function claudeSettingDraft(
  draft: string,
): { kind: ClaudeSettingKind; query: string } | null {
  const match = draft.match(/^\/(model|mode)(?:\s+(.*))?$/i);
  if (!match) return null;
  return { kind: match[1].toLowerCase() as ClaudeSettingKind, query: match[2] ?? "" };
}
