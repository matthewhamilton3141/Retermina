import { computeLineDiff } from "./diff";

export type ClaudeRunStatus = "connecting" | "idle" | "running" | "waiting" | "limited" | "exited";

export type ClaudePermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "default"
  | "dontAsk"
  | "plan";

export interface ClaudeAgentDefinition {
  name: string;
  description: string;
}

export interface ClaudeSkillDefinition {
  name: string;
  description: string;
}

interface TimelineBase {
  id: string;
  timestamp: number;
}

export interface ClaudeUserMessage extends TimelineBase {
  kind: "user";
  text: string;
}

export interface ClaudeAssistantMessage extends TimelineBase {
  kind: "assistant";
  text: string;
}

export interface ClaudeToolActivity extends TimelineBase {
  kind: "tool";
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  status: "running" | "done" | "error";
  output?: string;
}

export interface ClaudeQuestionOption {
  label: string;
  description: string;
}

export interface ClaudeQuestionPrompt {
  question: string;
  header: string;
  multiSelect: boolean;
  options: ClaudeQuestionOption[];
}

export interface ClaudeQuestionActivity extends TimelineBase {
  kind: "question";
  toolUseId: string;
  questions: ClaudeQuestionPrompt[];
  status: "running" | "done" | "error";
  output?: string;
}

export interface ClaudeNotice extends TimelineBase {
  kind: "notice";
  text: string;
  tone: "muted" | "error";
}

/**
 * A `!command` run locally in the Agent view — bash-mode has no headless
 * stream-json equivalent (Claude just treats `!ls` as literal chat text), so
 * this runs the command directly via the same one-shot shell bridge other
 * panels use, entirely outside the Claude conversation.
 */
export interface ClaudeShellActivity extends TimelineBase {
  kind: "shell";
  command: string;
  status: "running" | "done" | "error";
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ClaudeTimelineItem =
  | ClaudeUserMessage
  | ClaudeAssistantMessage
  | ClaudeToolActivity
  | ClaudeQuestionActivity
  | ClaudeShellActivity
  | ClaudeNotice;

export interface ClaudeTranscriptSnapshot {
  items: ClaudeTimelineItem[];
  seenRecords: Record<string, true>;
  status: ClaudeRunStatus;
  model: string | null;
  permissionMode: ClaudePermissionMode;
  agents: ClaudeAgentDefinition[];
  skills: ClaudeSkillDefinition[];
  error: string | null;
  /** Live assistant text streaming in (from `--include-partial-messages`), shown
   *  below the timeline until the completed assistant record replaces it. */
  partialText: string;
}

export interface ClaudeToolDiff {
  path: string;
  oldText: string;
  newText: string;
}

export function emptyClaudeTranscript(): ClaudeTranscriptSnapshot {
  return {
    items: [],
    seenRecords: {},
    status: "connecting",
    model: null,
    permissionMode: "default",
    agents: [],
    skills: [],
    error: null,
    partialText: "",
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const block = objectValue(entry);
      return typeof block?.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function recordTimestamp(record: Record<string, unknown>): number {
  const parsed = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function compactOutput(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : value === undefined
        ? ""
        : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n… output truncated` : text;
}

function isPermissionMode(value: unknown): value is ClaudePermissionMode {
  return (
    value === "acceptEdits" ||
    value === "auto" ||
    value === "bypassPermissions" ||
    value === "default" ||
    value === "dontAsk" ||
    value === "plan"
  );
}

function parseQuestions(input: Record<string, unknown>): ClaudeQuestionPrompt[] {
  if (!Array.isArray(input.questions)) return [];
  return input.questions.flatMap((rawQuestion) => {
    const question = objectValue(rawQuestion);
    if (!question || typeof question.question !== "string") return [];
    const options = Array.isArray(question.options)
      ? question.options.flatMap((rawOption) => {
          const option = objectValue(rawOption);
          return option && typeof option.label === "string"
            ? [
                {
                  label: option.label,
                  description:
                    typeof option.description === "string" ? option.description : "",
                },
              ]
            : [];
        })
      : [];
    return [
      {
        question: question.question,
        header: typeof question.header === "string" ? question.header : "Question",
        multiSelect: question.multiSelect === true,
        options,
      },
    ];
  });
}

function applyAgentListing(
  current: ClaudeAgentDefinition[],
  attachment: Record<string, unknown>,
): ClaudeAgentDefinition[] {
  const addedTypes = Array.isArray(attachment.addedTypes)
    ? attachment.addedTypes.filter((value): value is string => typeof value === "string")
    : [];
  const removedTypes = new Set(
    Array.isArray(attachment.removedTypes)
      ? attachment.removedTypes.filter((value): value is string => typeof value === "string")
      : [],
  );
  const addedLines = Array.isArray(attachment.addedLines)
    ? attachment.addedLines.filter((value): value is string => typeof value === "string")
    : [];

  const agents = new Map(
    current
      .filter((agent) => !removedTypes.has(agent.name))
      .map((agent) => [agent.name, agent] as const),
  );
  for (const name of addedTypes) {
    const prefix = `- ${name}:`;
    const line = addedLines.find((candidate) => candidate.startsWith(prefix));
    agents.set(name, {
      name,
      description: line ? line.slice(prefix.length).trim() : "",
    });
  }
  return [...agents.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parseSkillListing(content: unknown): ClaudeSkillDefinition[] {
  if (typeof content !== "string") return [];
  const skills = new Map<string, ClaudeSkillDefinition>();
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) continue;
    const separator = line.indexOf(": ");
    if (separator <= 2) continue;
    const name = line.slice(2, separator).trim();
    if (!name) continue;
    skills.set(name, {
      name,
      description: line.slice(separator + 2).trim(),
    });
  }
  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fold one Claude JSONL record into a renderable transcript. The parser is
 * deliberately tolerant: Claude adds fields over time, while the stable
 * `type`, `message.content`, and tool-use ids are enough for this view.
 */
export function applyClaudeRecord(
  previous: ClaudeTranscriptSnapshot,
  raw: unknown,
  sourceId: string,
): ClaudeTranscriptSnapshot {
  if (previous.seenRecords[sourceId]) return previous;
  const record = objectValue(raw);
  if (!record) return previous;

  const rawType = typeof record.type === "string" ? record.type : "";

  // Live streaming deltas (`--include-partial-messages`). Handled before the
  // item-copying fold and NOT recorded in `seenRecords` — they're transient and
  // unique per token, so folding them normally would copy the timeline and grow
  // the seen map on every character.
  if (rawType === "stream_event") {
    const event = objectValue(record.event);
    const eventType = event && typeof event.type === "string" ? event.type : "";
    if (eventType === "message_start") {
      return { ...previous, partialText: "", status: "running" };
    }
    if (eventType === "content_block_delta") {
      const delta = objectValue(event?.delta);
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        return { ...previous, partialText: previous.partialText + delta.text };
      }
    }
    return previous;
  }

  const next: ClaudeTranscriptSnapshot = {
    ...previous,
    items: [...previous.items],
    seenRecords: { ...previous.seenRecords, [sourceId]: true },
  };

  const type = rawType;
  if (isPermissionMode(record.permissionMode)) {
    next.permissionMode = record.permissionMode;
  }
  if (type === "permission-mode") return next;

  // stream-json lifecycle events (from the managed agent subprocess). The
  // `init` event front-loads model + skills; `result` closes out a turn.
  if (type === "system" && record.subtype === "init") {
    if (typeof record.model === "string") next.model = record.model;
    if (Array.isArray(record.skills)) {
      const names = record.skills.filter((s): s is string => typeof s === "string");
      if (names.length > 0) {
        next.skills = names.map((name) => ({ name, description: "Claude Code skill." }));
      }
    }
    return next;
  }
  if (type === "result") {
    next.status = "idle";
    next.partialText = "";
    return next;
  }

  if (type === "attachment") {
    const attachment = objectValue(record.attachment);
    if (attachment?.type === "agent_listing_delta") {
      next.agents = applyAgentListing(next.agents, attachment);
    } else if (attachment?.type === "skill_listing") {
      next.skills = parseSkillListing(attachment.content);
    }
    return next;
  }

  // Sidechain/subagent chatter is intentionally omitted from the main reading
  // flow; its file edits still appear through main-session tool results/diffs.
  if (record.isSidechain === true) return next;

  const timestamp = recordTimestamp(record);
  const message = objectValue(record.message);
  const content = message?.content;

  if (type === "user") {
    const blocks = Array.isArray(content) ? content : [];
    let handledToolResult = false;

    for (let index = 0; index < blocks.length; index += 1) {
      const block = objectValue(blocks[index]);
      if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      handledToolResult = true;
      const toolUseId = block.tool_use_id;
      const isError = block.is_error === true;
      const output = compactOutput(block.content);
      const existing = next.items.findIndex(
        (item) =>
          (item.kind === "tool" || item.kind === "question") &&
          item.toolUseId === toolUseId,
      );
      if (existing >= 0) {
        const item = next.items[existing] as ClaudeToolActivity | ClaudeQuestionActivity;
        next.items[existing] = {
          ...item,
          status: isError ? "error" : "done",
          output: output || item.output,
        };
      } else {
        next.items.push({
          id: `${sourceId}:result:${index}`,
          kind: "tool",
          timestamp,
          toolUseId,
          name: "Tool",
          input: {},
          status: isError ? "error" : "done",
          output,
        });
      }
    }

    if (handledToolResult) next.status = "running";
    if (!handledToolResult && record.isMeta !== true) {
      const text = textValue(content).trim();
      if (text) {
        // Claude writes the cancelled turn back to the transcript as a
        // user-role record. It is not a prompt the reader typed: render it as a
        // muted end-of-turn notice and let the run indicator + interrupt button
        // clear, rather than a "You:" bubble that leaves Claude looking busy.
        if (/^\[Request interrupted by user/i.test(text)) {
          // The panel may have already shown an optimistic "Interrupted" notice
          // (fast interrupt, before Claude wrote this record) — don't double it.
          const last = next.items[next.items.length - 1];
          if (!(last?.kind === "notice" && last.text === "Interrupted")) {
            next.items.push({
              id: `${sourceId}:interrupt`,
              kind: "notice",
              timestamp,
              text: "Interrupted",
              tone: "muted",
            });
          }
          next.status = "idle";
        } else {
          next.items.push({ id: `${sourceId}:user`, kind: "user", timestamp, text });
          next.status = "running";
        }
      }
    }
    return next;
  }

  if (type === "assistant" && message) {
    if (typeof message.model === "string") next.model = message.model;
    const blocks = Array.isArray(content) ? content : [];
    let askedQuestion = false;
    for (let index = 0; index < blocks.length; index += 1) {
      const block = objectValue(blocks[index]);
      if (!block || typeof block.type !== "string") continue;
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        // The completed text replaces the streamed preview.
        next.partialText = "";
        next.items.push({
          id: `${sourceId}:assistant:${index}`,
          kind: "assistant",
          timestamp,
          text: block.text,
        });
      } else if (
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        const input = objectValue(block.input) ?? {};
        const normalizedToolName = block.name.replace(/[^a-z]/gi, "").toLowerCase();
        if (normalizedToolName.endsWith("askuserquestion")) {
          const questions = parseQuestions(input);
          if (questions.length > 0) {
            next.items.push({
              id: `${sourceId}:question:${index}`,
              kind: "question",
              timestamp,
              toolUseId: block.id,
              questions,
              status: "running",
            });
            askedQuestion = true;
            continue;
          }
        }
        next.items.push({
          id: `${sourceId}:tool:${index}`,
          kind: "tool",
          timestamp,
          toolUseId: block.id,
          name: block.name,
          input,
          status: "running",
        });
      }
    }
    const stopReason = message.stop_reason;
    next.status =
      askedQuestion
        ? "waiting"
        : stopReason === "end_turn" || stopReason === "stop_sequence"
          ? "idle"
          : "running";
    return next;
  }

  if (type === "system") {
    const subtype = typeof record.subtype === "string" ? record.subtype : "";
    const errorText =
      typeof record.error === "string"
        ? record.error
        : typeof record.message === "string"
          ? record.message
          : "";
    if (errorText && /error|failure/i.test(subtype || errorText)) {
      next.items.push({
        id: `${sourceId}:notice`,
        kind: "notice",
        timestamp,
        text: errorText,
        tone: "error",
      });
      next.error = errorText;
      next.status = "idle";
    }
  }

  return next;
}

export function summarizeClaudeTool(tool: ClaudeToolActivity): string {
  const input = tool.input;
  const path =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : "";
  const command = typeof input.command === "string" ? input.command.split("\n")[0] : "";
  const pattern =
    typeof input.pattern === "string"
      ? input.pattern
      : typeof input.query === "string"
        ? input.query
        : "";
  const agent =
    typeof input.subagent_type === "string"
      ? input.subagent_type
      : typeof input.description === "string"
        ? input.description
        : "";

  if (path) return path;
  if (command) return command;
  if (pattern) return pattern;
  if (agent) return agent;
  return "";
}

/** Pull edit-shaped before/after pairs from Claude's built-in file tools. */
export function extractClaudeToolDiffs(tool: ClaudeToolActivity): ClaudeToolDiff[] {
  const input = tool.input;
  const path = typeof input.file_path === "string" ? input.file_path : "";
  if (!path) return [];

  if (typeof input.old_string === "string" && typeof input.new_string === "string") {
    return [{ path, oldText: input.old_string, newText: input.new_string }];
  }
  if (Array.isArray(input.edits)) {
    return input.edits.flatMap((rawEdit) => {
      const edit = objectValue(rawEdit);
      return edit &&
        typeof edit.old_string === "string" &&
        typeof edit.new_string === "string"
        ? [{ path, oldText: edit.old_string, newText: edit.new_string }]
        : [];
    });
  }
  if (typeof input.content === "string" && /write/i.test(tool.name)) {
    return [{ path, oldText: "", newText: input.content }];
  }
  return [];
}

export interface ClaudeToolDiffSummary {
  files: number;
  added: number;
  removed: number;
}

/** Counts the compact +/− summary shown while an edit activity is folded. */
export function summarizeClaudeToolDiffs(tool: ClaudeToolActivity): ClaudeToolDiffSummary {
  const changes = extractClaudeToolDiffs(tool);
  return changes.reduce<ClaudeToolDiffSummary>(
    (summary, change) => {
      const lines = computeLineDiff(change.oldText, change.newText);
      summary.added += lines.filter((line) => line.type === "added").length;
      summary.removed += lines.filter((line) => line.type === "removed").length;
      return summary;
    },
    { files: changes.length, added: 0, removed: 0 },
  );
}
