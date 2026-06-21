# Retermina

A high-utility terminal workspace built on Tauri v2 and React. Retermina replaces the traditional terminal window with a modular, themeable developer environment that runs your native shell securely inside a Rust PTY — with no cloud dependency, no token limits, and no subscription.

---

## Architecture

### Tauri v2 + Rust backend

Retermina is a native desktop application built with [Tauri v2](https://v2.tauri.app). The Rust backend owns all privileged operations:

- **PTY management** — spawns and drives native shell sessions (Zsh, Bash, PowerShell) via `portable-pty`. Output is base64-encoded and streamed to the frontend over a Tauri `Channel` for zero-copy delivery to xterm.js.
- **File system** — `list_dir`, `read_file`, `write_file`, `create_file` commands with a 5 MB read cap and UTF-8 validation.
- **Git context** — shells out to `git status --porcelain=v2` to supply live repo metadata to the Iris command bar.
- **Port discovery** — `lsof` / `netstat` parsing to surface active local servers in the Localhost Tracker panel.

IPC uses Tauri's typed `invoke` for request/response and `Channel<T>` for streaming PTY output. All window actions (drag, close, minimize, maximize) are explicitly granted via `capabilities/default.json` — nothing is implicitly allowed.

### Workspace grid — powered by react-grid-layout

The panel workspace is driven by **[react-grid-layout](https://github.com/react-grid-layout/react-grid-layout)**, the open-source draggable and resizable grid layout library. Retermina uses its v2 API with the following configuration:

- **Fully controlled layout** — all panel coordinates live in a Zustand store and round-trip through `onLayoutChange`. The grid never owns state.
- **`noCompactor`** — panels remain static between explicit user actions. No automatic reflow.
- **12 × 10 grid** — 12 columns, 10 rows, with row height derived dynamically so the grid fills the available window height at any window size.
- **8-direction resize** — `n`, `ne`, `nw`, `s`, `se`, `sw`, `e`, `w` handles.
- **Collision resolution** — on drop, displaced panels are resolved via resize → swap → abort, using a pre-drag layout snapshot so the correct panel is identified regardless of RGL's internal collision pass.

Panel children are memoized against `[panels, cwd, closePanel]` so live terminal sessions survive drag and resize without remounting.

---

## Features

### Modular panel workspace

Six panel types can be independently toggled, dragged, resized, and arranged across the 12-column grid:

| Panel | Purpose |
|---|---|
| **Explorer** | Directory tree with expand/collapse navigation |
| **Terminal** | Live xterm.js shell connected to a native PTY |
| **Code** | Read-only (or Safe Edit) file viewer with live diff |
| **Localhost** | Active port tracker with one-click process termination |
| **Claude Code** | Dedicated terminal that auto-launches the `claude` CLI |
| **Preview** | Live preview launcher — opens a standalone native window |

Panels snap to the grid, resize from all eight edges, and resolve collisions without flying off-screen.

### Iris command bar

Iris is a **local, tokenless** command bar at the bottom of the workspace. It requires no API keys, no network connection, and no LLM inference.

**How it works:**
- A static macro catalog is filtered at query time against `IrisCtx` — a context object that merges live Git state (branch, ahead/behind counts, staged/unstaged file counts) with the currently open file path.
- **Fuzzy matching** scores each macro's title and keywords: prefix match → 100 pts, substring → 60 pts, subsequence → 25 pts. Macros scoring 0 are excluded.
- **Contextual gating** — every macro declares `available(ctx): boolean`. "Push" only surfaces when commits are ahead of upstream. "Diff staged" only appears when staged changes exist. File commands only appear when a file is open in the Code panel.
- A **"Run as typed"** fallback always appears for non-empty queries so any raw shell command is one Enter away.
- **Navigation:** `↑ ↓` to move through suggestions, `Enter` or `Tab` to run, `Esc` to dismiss.

#### Git commands

| Keywords | Command | When available |
|---|---|---|
| `sync`, `rebase`, `update` | `git pull --rebase && git push` | repo, has upstream, ahead or behind |
| `push`, `upload`, `publish` | `git push` | repo, has upstream, commits ahead |
| `publish`, `set upstream` | `git push -u origin <branch>` | repo, no upstream set |
| `pull`, `download`, `merge` | `git pull` | repo, has upstream, commits behind |
| `fetch`, `prune` | `git fetch --all --prune` | in any repo |
| `commit`, `commit all`, `ci` | `git add -A && git commit` | repo, uncommitted changes |
| `commit staged`, `ci` | `git commit` | repo, staged changes exist |
| `stage`, `add`, `git add` | `git add -A` | repo, unstaged or untracked files |
| `status`, `st`, `what changed` | `git status` | in any repo |
| `diff`, `changes`, `delta` | `git diff` | repo, unstaged changes |
| `diff staged`, `cached` | `git diff --staged` | repo, staged changes exist |
| `log`, `history`, `graph` | `git log --oneline --graph -20` | in any repo |
| `stash`, `shelve` | `git stash push -u` | repo, uncommitted changes |
| `stash pop`, `unstash`, `pop` | `git stash pop` | in any repo |
| `stash list`, `stashes` | `git stash list` | in any repo |
| `branch`, `branches` | `git branch -a` | in any repo |
| `remote`, `remotes`, `origin` | `git remote -v` | in any repo |
| `init`, `new repo` | `git init` | **not** in a repo |
| `discard`, `restore` *(hidden)* | `git restore .` | repo, unstaged changes |
| `undo`, `undo commit` *(hidden)* | `git reset --soft HEAD~1` | in any repo |
| `amend`, `fix commit` *(hidden)* | `git commit --amend --no-edit` | in any repo |

> Hidden commands only appear when explicitly typed — they never show in the default empty-query list.

#### npm commands

| Keywords | Command |
|---|---|
| `install`, `npm i`, `dependencies` | `npm install` |
| `dev`, `start`, `serve`, `vite` | `npm run dev` |
| `build`, `bundle`, `compile` | `npm run build` |
| `test`, `jest`, `vitest`, `spec` | `npm test` |
| `lint`, `eslint`, `check` | `npm run lint` |

#### Shell commands

| Keywords | Command |
|---|---|
| `ls`, `list`, `dir`, `files` | `ls -la` |
| `clear`, `cls` | `clear` |
| `pwd`, `where`, `cwd` | `pwd` |
| `du`, `disk`, `size`, `folder size` | `du -sh ./* \| sort -h` |
| `find`, `typescript`, `javascript`, `source` | `find` for all TS/JS/TSX/JSX, excluding `node_modules` and `dist` |
| `ps`, `processes`, `node`, `running` | `ps aux` filtered for node/npm/vite/pnpm |

#### File commands *(require a file open in the Code panel)*

| Keywords | Command |
|---|---|
| `finder`, `reveal`, `locate` | `open -R "<path>"` — opens Finder with file selected |
| `open`, `open file`, `default app` | `open "<path>"` — opens with default macOS application |
| `copy path`, `clipboard`, `path` | `echo -n "<path>" \| pbcopy` — copies path to clipboard |

### Semantic theming engine

Five structural theme engines swap the entire visual character of the application via a single `data-theme` attribute on `<html>`. No React re-render is triggered — the attribute change is handled entirely in CSS.

| Engine | Character |
|---|---|
| **Sleek** | Dark surfaces, emerald accent, sharp corners |
| **Soft Pastel** | Light, generous rounding, per-surface blur, violet accent |
| **Transparent Glass** | Frosted panels over a blurred, semi-transparent window background |
| **Minimalist** | Flat, hairline borders, near-monochrome |
| **Neo-Brutalism** | 2px black borders, hard offset shadows, green accent, zero radius |

Each engine defines ~50 CSS custom properties (`--rt-bg`, `--rt-surface`, `--rt-accent`, `--rt-backdrop`, `--rt-shadow-panel`, etc.). Components use semantic utility classes (`.rt-panel`, `.rt-btn`, `.rt-menu`) that read the tokens — no per-component theme logic.

The xterm.js terminal color table is also engine-specific. The `blue`/`brightBlue` ANSI slots are set to each engine's accent color so Claude CLI selection highlights match the active theme.

### Live file diff viewer

The Code panel includes a built-in diff mode. When activated:
1. A baseline snapshot of the current file content is captured.
2. The file is polled every 1.5 seconds via the Rust `read_file` command.
3. Changes are computed in-browser using a pure-TypeScript **LCS (Longest Common Subsequence)** diff algorithm — no external diff packages.
4. The result renders as a git-diff-style view: green additions, red deletions, collapsed unchanged context.

The diff panel also supports **Safe Edit** mode — an inline `<textarea>` backed by the Rust `write_file` command, replacing the read-only view when unlocked.

### OS drag-and-drop

- **LaunchHub** — drag a folder from Finder to open it as a workspace; drag a text file to open it in the Code panel.
- **Terminal panels** — drag files or folders onto any terminal to paste their shell-quoted paths at the cursor, without an implicit newline.

### Recent workspaces

Every folder opened in Retermina is recorded in a native localStorage history (max 20 entries, timestamped). The LaunchHub displays them sorted by recency with relative timestamps and per-entry removal.

### Custom title bar

`decorations: false` + `transparent: true` + `macOSPrivateApi: true` gives Retermina full control of the window chrome. A custom title bar renders macOS traffic light buttons and handles window dragging via an explicit `onMouseDown → appWindow.startDragging()` call — not `data-tauri-drag-region`, which would intercept mid-panel-drag mousemove events and break the grid.

---

## Getting Started

**Prerequisites:** Rust toolchain, Node.js ≥ 20, platform build tools.

- macOS: `xcode-select --install`
- Windows: WebView2 + C++ Build Tools via Visual Studio Installer

```bash
git clone https://github.com/matthewhamilton3141/retermina.git
cd retermina
npm install
npm run tauri dev    # development
npm run tauri build  # production bundle
```

---

## Attribution

Workspace panel management is powered by **[react-grid-layout](https://github.com/react-grid-layout/react-grid-layout)** — MIT licensed.

---

## License

MIT — see [LICENSE](LICENSE) for details.
