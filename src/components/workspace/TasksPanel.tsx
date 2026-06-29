/**
 * TasksPanel — one-click runnable scripts detected from the workspace.
 *
 * Scans the cwd for package.json scripts (with package-manager detection),
 * Makefile targets, and a Cargo.toml, and renders each as a button that runs
 * the command in the active terminal via the Iris terminal bus. Read-only
 * discovery — it never writes; it just sends a command line.
 */
import { useCallback, useEffect, useState } from "react";

import Icon from "../Icon";
import { listDir, readFile } from "../../lib/fs";
import { terminalBus } from "../../lib/terminalBus";

interface Task {
  id: string;
  label: string;
  sub?: string;
  command: string;
}
interface Group {
  source: string;
  tasks: Task[];
}

export default function TasksPanel({ cwd }: { cwd: string | null }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [ran, setRan] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cwd) { setGroups([]); return; }
    setGroups(null);
    try {
      const entries = await listDir(cwd).catch(() => []);
      const names = new Set(entries.map((e) => e.name));
      const next: Group[] = [];

      // package.json scripts (with package-manager detection)
      if (names.has("package.json")) {
        try {
          const pkg = JSON.parse(await readFile(`${cwd}/package.json`));
          const scripts = pkg && typeof pkg.scripts === "object" ? pkg.scripts : {};
          const pm = names.has("pnpm-lock.yaml") ? "pnpm"
            : names.has("yarn.lock") ? "yarn"
            : names.has("bun.lockb") ? "bun"
            : "npm";
          const prefix = pm === "yarn" ? "yarn" : `${pm} run`;
          const tasks = Object.entries(scripts).map(([name, val]) => ({
            id: `npm-${name}`,
            label: name,
            sub: String(val).slice(0, 80),
            command: `${prefix} ${name}`,
          }));
          if (tasks.length) next.push({ source: pm, tasks });
        } catch { /* malformed package.json — skip */ }
      }

      // Makefile targets
      const mk = entries.find((e) => /^(makefile|gnumakefile)$/i.test(e.name));
      if (mk) {
        try {
          const text = await readFile(`${cwd}/${mk.name}`);
          const targets = [...text.matchAll(/^([a-zA-Z][\w.-]*)\s*:/gm)]
            .map((m) => m[1])
            .filter((t) => !t.startsWith("."));
          const uniq = [...new Set(targets)];
          if (uniq.length) {
            next.push({ source: "make", tasks: uniq.map((t) => ({ id: `make-${t}`, label: t, command: `make ${t}` })) });
          }
        } catch { /* skip */ }
      }

      // Cargo
      if (names.has("Cargo.toml")) {
        next.push({
          source: "cargo",
          tasks: ["run", "build", "test", "check"].map((c) => ({ id: `cargo-${c}`, label: c, command: `cargo ${c}` })),
        });
      }

      setGroups(next);
    } catch {
      setGroups([]);
    }
  }, [cwd]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const run = (t: Task) => {
    if (terminalBus.run(t.command)) {
      terminalBus.get()?.focus();
      setRan(t.id);
      setTimeout(() => setRan((r) => (r === t.id ? null : r)), 1200);
    }
  };

  return (
    <div className="rt-subsurface flex h-full w-full flex-col">
      <div className="rt-divider-b flex shrink-0 items-center gap-1.5 px-2.5 py-1.5">
        <Icon name="launch" size={13} className="rt-accent-text shrink-0" />
        <span className="rt-text-muted min-w-0 flex-1 truncate text-xs font-medium">Tasks</span>
        <button type="button" onClick={() => void load()} title="Rescan" className="rt-btn flex h-5 w-5 items-center justify-center">
          <Icon name="sync" size={11} aria-label="Rescan" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!cwd ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="rt-text-muted text-xs leading-relaxed">Open a workspace folder to see its scripts.</p>
          </div>
        ) : groups === null ? (
          <div className="flex h-full items-center justify-center gap-2">
            <Icon name="sync" size={14} className="rt-text-faint animate-spin" />
            <span className="rt-text-faint text-xs">Scanning…</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="rt-text-muted text-xs leading-relaxed">No <code>package.json</code>, <code>Makefile</code>, or <code>Cargo.toml</code> tasks here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <div key={g.source}>
                <p className="rt-text-faint mb-1 px-1 text-[10px] font-semibold uppercase tracking-widest">{g.source}</p>
                <div className="flex flex-col gap-0.5">
                  {g.tasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => run(t)}
                      title={`Run: ${t.command}`}
                      className="rt-row group/task flex items-center gap-2 px-2 py-1 text-left text-xs"
                    >
                      <Icon name={ran === t.id ? "sync" : "launch"} size={12} className={`rt-row-icon shrink-0 ${ran === t.id ? "animate-spin" : ""}`} />
                      <span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
                      {t.sub && <span className="rt-text-faint hidden max-w-[55%] truncate font-mono text-[10px] md:block">{t.sub}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
