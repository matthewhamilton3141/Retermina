# Retermina — Idea Backlog

Parking lot for features we've discussed but not built. Ordered roughly by
leverage. The note that matters most for each is **"what actually determines the
effort"** — several of these sound small and aren't (and one sounds big but is
mostly already done).

## Big bets (deferred — need real design, not a rushed first cut)

### Remote / SSH sessions
Pin a workspace to a remote host; ideally devcontainers too. The draw of the
JetBrains Gateway / Warp crowd, and a natural extension of the PTY model.

- **Effort split:** an SSH *terminal* is easy — we already spawn a PTY (`pty.ts`
  → Rust), so spawning `ssh host` instead is a small step. The hard 90% is
  making Explorer / Code / Changes operate *over the connection*: every
  filesystem + `git` call is currently local-only and would need to become
  connection-aware (local vs SSH vs devcontainer).
- **Recommendation:** ship **SSH terminal sessions** as phase 1 (small, demos
  great). Treat **remote-aware panels** as a separate, later epic. Don't bundle.

### AI inside the terminal (not just beside it)
Headline feature: **explain-on-failure** — when a command exits non-zero, offer
a one-click "why did this fail?" over the captured stderr. Fits the local /
tokenless-by-default ethos (only the explain call needs Claude).

- **Hidden prerequisite:** a PTY is one byte stream — we don't know where a
  command starts/ends, its exit code, or which bytes were stderr, **without
  shell integration** (OSC 133 prompt marking injected into the user's shell
  rc). Same infra Warp built first.
- **Reframe:** the real investment is **shell integration**. Once we have it we
  unlock command blocks, re-run, per-command timing, copy-output, *and*
  explain-on-failure. Pitch it as "add shell integration; explain-on-failure is
  the headline."

## Medium / later

### Multiple windows
Tauri multi-window is doable, but our state is Zustand-persisted single-workspace
— multi-window forces a "shared vs per-window state" decision, and the
scroll-lock / fixed-canvas constraint is per-window. Medium; lower leverage than
the big bets.

### Menubar-style top-bar minimize
Top bar collapses / behaves like the macOS menu bar (auto-hide, etc.). Pure
polish, low urgency, fun.

## Done (shipped from this backlog)

- **Unified preset system** — the toolbar workspace presets folded into the
  Loom library as layout-scoped Looms (`scope: "full" | "layout"`); old
  localStorage presets migrate automatically on first launch. Layout presets
  now carry per-panel font sizes too.
- **Presets follow you across workspaces** — applying a preset sets a layout
  template that newly opened/reopened tabs inherit, instead of every new tab
  snapping back to the default grid.
- **Per-folder layout memory** — closing a workspace snapshots its layout by
  cwd (capped at 30 folders); reopening that folder restores it. Applying a
  preset clears the memories so a fresh preset wins everywhere.

- **Commit SHA in the bottom bar** — the IrisBar git chip now shows the short
  HEAD sha next to the branch. _(parsed from `# branch.oid` in the existing
  porcelain-v2 call — no extra git invocation.)_
- **Syntax highlighting while editing** — the Code panel kept Prism highlighting
  in read mode but dropped to a plain `<textarea>` on Edit; now highlighted in
  edit mode too.
- **In-file find & replace** in the Code panel.

## Investigate

### "Asks permission for a billion things on every launch"
Every-launch papercut → outsized perceived-quality impact.

**Investigated (2026-06-29):** ruled out our own code — the Tauri capabilities in
`src-tauri/capabilities/default.json` are static grants, not runtime prompts, and
the only `confirm`/`ask` dialogs are user-initiated (delete in FileExplorerPanel,
discard in GitDiffPanel), not launch-time. Most likely cause is **macOS TCC**:
the app isn't Apple-notarized (see RELEASING.md "Apple notarization is
optional"), so folder-access grants don't persist against an ad-hoc-signed
binary and macOS re-prompts each launch. **Proper fix = Apple Developer signing +
notarization**, not a quick code change. Still want to confirm by seeing the
exact prompt text before committing to that path.

**Decision (2026-07-01):** not pursuing the Apple Developer membership for now —
parked until there's a reason to pay for the account. Revisit if the launch
prompts become a real user complaint.
