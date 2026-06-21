/**
 * The Iris suggestion engine.
 *
 * Iris is intentionally local and tokenless: given the user's query and the
 * current Git context, it ranks a catalog of command "macros" with a small
 * heuristic matcher (prefix > substring > subsequence). Git macros are
 * *contextual* — each declares an `available(ctx)` guard so, e.g., "Push" only
 * appears when the branch is ahead, "Publish branch" only when there's no
 * upstream, and "Pull" only when behind.
 *
 * This module is pure data + pure functions (no React, no `invoke`) so it can
 * be reasoned about and, later, unit tested in isolation.
 */
import type { IconName } from "../components/Icon";
import type { GitStatus } from "./system";

/** Where a chosen suggestion runs. */
export type IrisRunTarget = "terminal" | "background";

/**
 * Full context handed to every macro's `available` and `command` functions.
 * Extends GitStatus so existing macros continue to work unchanged.
 */
export interface IrisCtx extends GitStatus {
  /** Absolute path of the file currently open in the Code panel, or null. */
  selectedPath: string | null;
}

/** A ready-to-present suggestion (a macro resolved against the live context). */
export interface IrisSuggestion {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  /** Short group label shown as a tag (e.g. "Git", "Shell"). */
  group: string;
  /** Preferred run target; the bar falls back to background if no terminal. */
  run: IrisRunTarget;
  /** The concrete shell command line to execute. */
  command: string;
}

/** A catalog entry: a command macro plus its matching/gating metadata. */
interface MacroDef {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  group: string;
  run: IrisRunTarget;
  /** Terms (besides the title) the query can match against. */
  keywords: string[];
  /** Higher sorts earlier in the default (empty-query) list. */
  priority: number;
  /** When true, only surfaces on an explicit keyword match (never by default). */
  hidden?: boolean;
  /** Context guard: only offered when this returns true. */
  available: (ctx: IrisCtx) => boolean;
  /** Build the command line, possibly using the live context. */
  command: (ctx: IrisCtx) => string;
}

/**
 * The macro catalog. Git macros are guarded by the repo context; a couple of
 * always-available shell helpers round out the bar so it's useful even outside
 * a repository.
 */
const MACROS: readonly MacroDef[] = [
  /* ----------------------------- Git: syncing ----------------------------- */
  {
    id: "git-sync",
    title: "Sync (pull --rebase, then push)",
    description: "Rebase onto upstream, then push your commits.",
    icon: "sync",
    group: "Git",
    run: "terminal",
    keywords: ["sync", "rebase", "pull push", "update"],
    priority: 95,
    available: (c) => c.isRepo && c.hasUpstream && (c.ahead > 0 || c.behind > 0),
    command: () => "git pull --rebase && git push",
  },
  {
    id: "git-push",
    title: "Push",
    description: "Push local commits to the upstream branch.",
    icon: "push",
    group: "Git",
    run: "terminal",
    keywords: ["push", "upload", "publish"],
    priority: 90,
    available: (c) => c.isRepo && c.hasUpstream && c.ahead > 0,
    command: () => "git push",
  },
  {
    id: "git-publish",
    title: "Publish branch",
    description: "Push and set an upstream for the current branch.",
    icon: "push",
    group: "Git",
    run: "terminal",
    keywords: ["publish", "push", "upstream", "set upstream"],
    priority: 88,
    available: (c) => c.isRepo && !c.hasUpstream && c.branch !== null,
    command: (c) => `git push -u origin ${c.branch ?? "HEAD"}`,
  },
  {
    id: "git-pull",
    title: "Pull",
    description: "Fetch and merge changes from upstream.",
    icon: "pull",
    group: "Git",
    run: "terminal",
    keywords: ["pull", "download", "update", "merge"],
    priority: 86,
    available: (c) => c.isRepo && c.hasUpstream && c.behind > 0,
    command: () => "git pull",
  },
  {
    id: "git-fetch",
    title: "Fetch all",
    description: "Download remote refs and prune deleted branches.",
    icon: "sync",
    group: "Git",
    run: "terminal",
    keywords: ["fetch", "refresh remotes", "prune"],
    priority: 40,
    available: (c) => c.isRepo,
    command: () => "git fetch --all --prune",
  },

  /* --------------------------- Git: committing ---------------------------- */
  {
    id: "git-commit-all",
    title: "Commit all changes",
    description: "Stage every change and open a commit message.",
    icon: "spark",
    group: "Git",
    run: "terminal",
    keywords: ["commit", "commit all", "save", "ci"],
    priority: 74,
    available: (c) => c.isRepo && !c.clean,
    command: () => "git add -A && git commit",
  },
  {
    id: "git-commit-staged",
    title: "Commit staged",
    description: "Commit the changes already staged in the index.",
    icon: "spark",
    group: "Git",
    run: "terminal",
    keywords: ["commit staged", "commit", "ci"],
    priority: 72,
    available: (c) => c.isRepo && c.staged > 0,
    command: () => "git commit",
  },
  {
    id: "git-stage-all",
    title: "Stage all changes",
    description: "Add every modified and untracked file to the index.",
    icon: "plus",
    group: "Git",
    run: "terminal",
    keywords: ["stage", "add", "add all", "git add"],
    priority: 60,
    available: (c) => c.isRepo && c.unstaged + c.untracked + c.conflicts > 0,
    command: () => "git add -A",
  },

  /* --------------------------- Git: inspecting ---------------------------- */
  {
    id: "git-status",
    title: "Status",
    description: "Show the working tree status.",
    icon: "search",
    group: "Git",
    run: "terminal",
    keywords: ["status", "st", "changes", "what changed"],
    priority: 50,
    available: (c) => c.isRepo,
    command: () => "git status",
  },
  {
    id: "git-diff",
    title: "Diff",
    description: "Show unstaged changes against the index.",
    icon: "search",
    group: "Git",
    run: "terminal",
    keywords: ["diff", "changes", "delta"],
    priority: 45,
    available: (c) => c.isRepo && c.unstaged > 0,
    command: () => "git diff",
  },
  {
    id: "git-log",
    title: "View log",
    description: "Browse recent commits as a compact graph.",
    icon: "gitClone",
    group: "Git",
    run: "terminal",
    keywords: ["log", "history", "commits", "graph"],
    priority: 35,
    available: (c) => c.isRepo,
    command: () => "git log --oneline --graph --decorate -20",
  },
  {
    id: "git-stash",
    title: "Stash changes",
    description: "Shelve working changes (including untracked).",
    icon: "gitClone",
    group: "Git",
    run: "terminal",
    keywords: ["stash", "shelve", "save for later"],
    priority: 30,
    available: (c) => c.isRepo && !c.clean,
    command: () => "git stash push -u",
  },
  {
    id: "git-discard",
    title: "Discard unstaged changes",
    description: "Restore tracked files to the last commit (destructive).",
    icon: "trash",
    group: "Git",
    run: "terminal",
    // Hidden: destructive, so it never appears in the default list and only
    // surfaces when the query explicitly matches (e.g. "discard"/"restore").
    hidden: true,
    keywords: ["discard", "restore", "revert", "reset changes"],
    priority: 10,
    available: (c) => c.isRepo && c.unstaged > 0,
    command: () => "git restore .",
  },
  {
    id: "git-init",
    title: "Initialize repository",
    description: "Create a new Git repository here.",
    icon: "gitClone",
    group: "Git",
    run: "terminal",
    keywords: ["init", "git init", "new repo", "create repo"],
    priority: 80,
    available: (c) => !c.isRepo,
    command: () => "git init",
  },

  /* ----------------------- Git: branches & history  ----------------------- */
  {
    id: "git-branch-list",
    title: "List branches",
    description: "Show all local and remote branches.",
    icon: "gitClone",
    group: "Git",
    run: "terminal",
    keywords: ["branch", "branches", "list branches", "remote branches"],
    priority: 42,
    available: (c) => c.isRepo,
    command: () => "git branch -a",
  },
  {
    id: "git-remote-list",
    title: "Show remotes",
    description: "List configured remote repositories and their URLs.",
    icon: "gitClone",
    group: "Git",
    run: "terminal",
    keywords: ["remote", "remotes", "origin", "url"],
    priority: 38,
    available: (c) => c.isRepo,
    command: () => "git remote -v",
  },
  {
    id: "git-diff-staged",
    title: "Diff staged",
    description: "Show changes that are staged and ready to commit.",
    icon: "search",
    group: "Git",
    run: "terminal",
    keywords: ["diff staged", "diff index", "cached", "staged changes"],
    priority: 48,
    available: (c) => c.isRepo && c.staged > 0,
    command: () => "git diff --staged",
  },
  {
    id: "git-undo-commit",
    title: "Undo last commit",
    description: "Reset HEAD~1, keeping all changes staged (soft reset).",
    icon: "pull",
    group: "Git",
    run: "terminal",
    hidden: true,
    keywords: ["undo", "undo commit", "reset", "uncommit", "soft reset"],
    priority: 15,
    available: (c) => c.isRepo,
    command: () => "git reset --soft HEAD~1",
  },
  {
    id: "git-amend",
    title: "Amend last commit",
    description: "Add staged changes to the last commit without editing the message.",
    icon: "spark",
    group: "Git",
    run: "terminal",
    hidden: true,
    keywords: ["amend", "amend commit", "fix commit", "update commit"],
    priority: 14,
    available: (c) => c.isRepo,
    command: () => "git commit --amend --no-edit",
  },

  /* ------------------------- Git: stash helpers --------------------------- */
  {
    id: "git-stash-pop",
    title: "Pop stash",
    description: "Restore the most recently stashed changes.",
    icon: "pull",
    group: "Git",
    run: "terminal",
    keywords: ["stash pop", "restore stash", "unstash", "pop"],
    priority: 32,
    available: (c) => c.isRepo,
    command: () => "git stash pop",
  },
  {
    id: "git-stash-list",
    title: "List stashes",
    description: "Show all stashed changesets.",
    icon: "search",
    group: "Git",
    run: "terminal",
    keywords: ["stash list", "stashes", "show stash"],
    priority: 28,
    available: (c) => c.isRepo,
    command: () => "git stash list",
  },

  /* ------------------------------- npm ------------------------------------ */
  {
    id: "npm-install",
    title: "Install dependencies",
    description: "Run npm install in the current directory.",
    icon: "plus",
    group: "npm",
    run: "terminal",
    keywords: ["npm install", "install", "dependencies", "node_modules", "npm i"],
    priority: 55,
    available: () => true,
    command: () => "npm install",
  },
  {
    id: "npm-dev",
    title: "Start dev server",
    description: "Run npm run dev (Vite, Next, CRA, etc.).",
    icon: "launch",
    group: "npm",
    run: "terminal",
    keywords: ["dev", "npm dev", "start", "serve", "development server", "vite"],
    priority: 52,
    available: () => true,
    command: () => "npm run dev",
  },
  {
    id: "npm-build",
    title: "Build",
    description: "Run npm run build to produce a production bundle.",
    icon: "spark",
    group: "npm",
    run: "terminal",
    keywords: ["build", "npm build", "bundle", "compile", "production"],
    priority: 50,
    available: () => true,
    command: () => "npm run build",
  },
  {
    id: "npm-test",
    title: "Run tests",
    description: "Run npm test.",
    icon: "search",
    group: "npm",
    run: "terminal",
    keywords: ["test", "npm test", "jest", "vitest", "spec"],
    priority: 48,
    available: () => true,
    command: () => "npm test",
  },
  {
    id: "npm-lint",
    title: "Lint",
    description: "Run npm run lint.",
    icon: "search",
    group: "npm",
    run: "terminal",
    keywords: ["lint", "eslint", "check", "npm lint"],
    priority: 44,
    available: () => true,
    command: () => "npm run lint",
  },

  /* ------------------------------- Shell ---------------------------------- */
  {
    id: "shell-clear",
    title: "Clear terminal",
    description: "Clear the terminal screen.",
    icon: "sync",
    group: "Shell",
    run: "terminal",
    keywords: ["clear", "cls", "clear screen"],
    priority: 6,
    available: () => true,
    command: () => "clear",
  },
  {
    id: "shell-ls",
    title: "List files",
    description: "List directory contents in detail.",
    icon: "files",
    group: "Shell",
    run: "terminal",
    keywords: ["ls", "list", "dir", "files"],
    priority: 5,
    available: () => true,
    command: () => "ls -la",
  },
  {
    id: "shell-pwd",
    title: "Print working directory",
    description: "Show the full path of the current directory.",
    icon: "folder",
    group: "Shell",
    run: "terminal",
    keywords: ["pwd", "where", "current directory", "path", "cwd"],
    priority: 7,
    available: () => true,
    command: () => "pwd",
  },
  {
    id: "shell-du",
    title: "Disk usage",
    description: "Show the size of every item in the current directory, sorted.",
    icon: "server",
    group: "Shell",
    run: "terminal",
    keywords: ["du", "disk", "size", "storage", "folder size", "disk usage"],
    priority: 4,
    available: () => true,
    command: () => "du -sh ./* 2>/dev/null | sort -h",
  },
  {
    id: "shell-find-code",
    title: "Find source files",
    description: "List all JS/TS/TSX files, excluding node_modules and dist.",
    icon: "files",
    group: "Shell",
    run: "terminal",
    keywords: ["find", "files", "typescript", "javascript", "source"],
    priority: 3,
    available: () => true,
    command: () =>
      "find . -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \\) -not -path '*/node_modules/*' -not -path '*/dist/*'",
  },
  {
    id: "shell-ps-node",
    title: "Node processes",
    description: "Show running Node / npm processes.",
    icon: "server",
    group: "Shell",
    run: "terminal",
    keywords: ["ps", "processes", "node", "npm", "running"],
    priority: 2,
    available: () => true,
    command: () => "ps aux | grep -E '[n]ode|[n]pm|[v]ite|[p]npm'",
  },

  /* ----------------------------- File actions ----------------------------- */
  {
    id: "file-reveal-finder",
    title: "Reveal in Finder",
    description: "Open Finder and select the current file.",
    icon: "folderOpen",
    group: "File",
    run: "background",
    keywords: ["finder", "reveal", "show in finder", "open finder", "locate"],
    priority: 20,
    available: (ctx) => ctx.selectedPath !== null,
    command: (ctx) => `open -R "${ctx.selectedPath}"`,
  },
  {
    id: "file-open-default",
    title: "Open file in default app",
    description: "Open the current file with its default macOS application.",
    icon: "launch",
    group: "File",
    run: "background",
    keywords: ["open", "open file", "default app", "preview", "xcode"],
    priority: 18,
    available: (ctx) => ctx.selectedPath !== null,
    command: (ctx) => `open "${ctx.selectedPath}"`,
  },
  {
    id: "file-copy-path",
    title: "Copy file path",
    description: "Copy the absolute path of the current file to the clipboard.",
    icon: "file",
    group: "File",
    run: "background",
    keywords: ["copy path", "clipboard", "file path", "copy", "path"],
    priority: 16,
    available: (ctx) => ctx.selectedPath !== null,
    command: (ctx) => `echo -n "${ctx.selectedPath}" | pbcopy`,
  },
];

/**
 * Score how well `query` matches `text`. Prefix matches rank highest, then
 * substring, then a loose subsequence; 0 means no match. Case-insensitive.
 */
function scoreText(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  const idx = t.indexOf(q);
  if (idx === 0) return 100;
  if (idx > 0) return 60;

  // Subsequence: every query char appears in order somewhere in the text.
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] === q[qi]) qi += 1;
  }
  return qi === q.length ? 25 : 0;
}

/** Best score of the query against a macro's title and keywords. */
function scoreMacro(query: string, macro: MacroDef): number {
  let best = scoreText(query, macro.title);
  for (const keyword of macro.keywords) {
    best = Math.max(best, scoreText(query, keyword));
  }
  return best;
}

export interface BuildSuggestionsOptions {
  /** Maximum macro suggestions before the run-raw fallback. Defaults to 8. */
  limit?: number;
}

/**
 * Rank suggestions for `query` against the live Git `ctx`.
 *
 * - Empty query: the available, non-hidden macros ordered by priority — a
 *   contextual "quick actions" list.
 * - Non-empty query: available macros scored by the matcher (descending),
 *   followed by a "Run \"<query>\"" fallback so any raw command is runnable.
 */
export function buildSuggestions(
  query: string,
  ctx: IrisCtx,
  options: BuildSuggestionsOptions = {},
): IrisSuggestion[] {
  const trimmed = query.trim();
  const limit = options.limit ?? 8;
  const available = MACROS.filter((macro) => macro.available(ctx));

  let chosen: MacroDef[];
  if (!trimmed) {
    chosen = available
      .filter((macro) => !macro.hidden)
      .sort((a, b) => b.priority - a.priority);
  } else {
    chosen = available
      .map((macro) => ({ macro, score: scoreMacro(trimmed, macro) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.macro.priority - a.macro.priority)
      .map((entry) => entry.macro);
  }

  const suggestions: IrisSuggestion[] = chosen.slice(0, limit).map((macro) => ({
    id: macro.id,
    title: macro.title,
    description: macro.description,
    icon: macro.icon,
    group: macro.group,
    run: macro.run,
    command: macro.command(ctx),
  }));

  // Always let the raw query run as a literal command.
  if (trimmed) {
    suggestions.push({
      id: "run-raw",
      title: `Run "${trimmed}"`,
      description: "Execute this command line as typed.",
      icon: "terminal",
      group: "Command",
      run: "terminal",
      command: trimmed,
    });
  }

  return suggestions;
}
