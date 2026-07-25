export interface DetectedClaudeLimit {
  kind: "session" | "weekly";
  resetAt: number | null;
  message: string;
}

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

/** Remove terminal control traffic while retaining the text Claude painted. */
export function normalizeClaudeTerminalOutput(value: string): string {
  let output = value
    // OSC sequences (window title, hyperlinks, clipboard, etc.).
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, " ")
    // CSI and short ESC sequences.
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:[0-9]{1,4}(?:[;:][0-9]{0,4})*)?[0-9A-PR-TZcf-nq-uy=><~])/g, " ")
    .replace(/\r/g, " ");
  // TUI redraws can include destructive backspaces.
  while (/[^\b]\x08/.test(output)) output = output.replace(/[^\b]\x08/g, "");
  return output.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}

export function appendClaudeTerminalOutput(
  current: string,
  chunk: string,
  maxLength = 16_000,
): string {
  return normalizeClaudeTerminalOutput(current + chunk).slice(-maxLength);
}

function hour24(hour: number, meridiem?: string): number {
  if (!meridiem) return hour;
  const normalized = meridiem.toLowerCase();
  if (normalized === "am") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

function nextLocalTime(
  now: number,
  hour: number,
  minute: number,
  meridiem?: string,
): number | null {
  const h = hour24(hour, meridiem);
  if (h > 23 || minute > 59) return null;
  const result = new Date(now);
  result.setHours(h, minute, 0, 0);
  // A time-only reset refers to the next occurrence, allowing a small delay in
  // detection around the exact reset minute.
  if (result.getTime() < now - 60_000) result.setDate(result.getDate() + 1);
  return result.getTime();
}

function parseResetAt(text: string, now: number): number | null {
  const relative = text.match(
    /resets?\s+in\s+(?:(\d+)\s*(?:days?|d)\s*)?(?:(\d+)\s*(?:hours?|hrs?|h)\s*)?(?:(\d+)\s*(?:minutes?|mins?|m)\s*)?/i,
  );
  if (relative && (relative[1] || relative[2] || relative[3])) {
    const days = Number(relative[1] ?? 0);
    const hours = Number(relative[2] ?? 0);
    const minutes = Number(relative[3] ?? 0);
    return now + ((days * 24 + hours) * 60 + minutes) * 60_000;
  }

  const iso = text.match(
    /resets?(?:\s+at|\s+on|:)?\s*(20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)/i,
  );
  if (iso) {
    const parsed = Date.parse(iso[1]);
    if (Number.isFinite(parsed)) return parsed;
  }

  const dated = text.match(
    /resets?(?:\s+at|\s+on|:)?\s*(?:on\s+)?([a-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?(?:\s+at|,)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (dated) {
    const month = MONTHS[dated[1].toLowerCase()];
    if (month !== undefined) {
      const current = new Date(now);
      const explicitYear = dated[3] ? Number(dated[3]) : null;
      let year = explicitYear ?? current.getFullYear();
      const hour = hour24(Number(dated[4]), dated[6]);
      const minute = Number(dated[5] ?? 0);
      let result = new Date(year, month, Number(dated[2]), hour, minute, 0, 0);
      if (!explicitYear && result.getTime() < now - 60_000) {
        year += 1;
        result = new Date(year, month, Number(dated[2]), hour, minute, 0, 0);
      }
      if (!Number.isNaN(result.getTime())) return result.getTime();
    }
  }

  const time = text.match(
    /resets?(?:\s+at|:)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (time) return nextLocalTime(now, Number(time[1]), Number(time[2] ?? 0), time[3]);

  const time24 = text.match(/resets?(?:\s+at|:)\s+([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if (time24) return nextLocalTime(now, Number(time24[1]), Number(time24[2]));

  return null;
}

export function detectClaudeLimit(
  terminalOutput: string,
  now = Date.now(),
): DetectedClaudeLimit | null {
  const normalized = normalizeClaudeTerminalOutput(terminalOutput);
  const pattern = /(?:you(?:'|’)ve|you have)\s+hit\s+your\s+(session|weekly)\s+limit/gi;
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = pattern.exec(normalized))) last = match;
  if (!last || last.index === undefined) return null;

  const message = normalized.slice(last.index, last.index + 700).replace(/\s+/g, " ").trim();
  return {
    kind: last[1].toLowerCase() === "weekly" ? "weekly" : "session",
    resetAt: parseResetAt(message, now),
    message,
  };
}

export function detectsClaudePermissionRequest(terminalOutput: string): boolean {
  const text = normalizeClaudeTerminalOutput(terminalOutput).replace(/\s+/g, " ");
  return /do you want to proceed\?|permission (?:is )?required|allow (?:this|the) (?:tool|command|edit)|trust (?:the files in )?this folder|log in to continue|authentication required/i.test(
    text,
  );
}
