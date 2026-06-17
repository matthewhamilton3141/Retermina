import { useCallback, useEffect, useRef, useState } from "react";

import Icon from "../Icon";
import {
  killProcess,
  listListeningPorts,
  type ListeningPort,
} from "../../lib/system";

/** How often the tracker re-scans listening ports in the background. */
const POLL_INTERVAL_MS = 4000;

/**
 * Poll the backend for listening TCP ports on an interval. A single in-flight
 * guard prevents overlapping scans if one runs long.
 */
function useLocalhostPorts() {
  const [ports, setPorts] = useState<ListeningPort[]>([]);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setPorts(await listListeningPorts());
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refresh();
    const id = window.setInterval(() => {
      if (active) void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [refresh]);

  return { ports, loading, refresh };
}

/** A label for a port row: process name when known, else the bare pid. */
function processLabel(port: ListeningPort): string {
  return port.process ? port.process : `pid ${port.pid}`;
}

/**
 * The Localhost Tracker panel. Continuously lists processes bound to local TCP
 * ports and offers a one-click terminate for each — handy for reclaiming a port
 * held by a runaway dev server.
 */
export function LocalhostPanel() {
  const { ports, loading, refresh } = useLocalhostPorts();
  const [killingPid, setKillingPid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleKill = async (pid: number) => {
    setKillingPid(pid);
    setError(null);
    try {
      await killProcess(pid);
      await refresh();
      // SIGTERM can lag; a short follow-up scan keeps the list snappy.
      window.setTimeout(() => void refresh(), 800);
    } catch (err) {
      setError(`Couldn't stop pid ${pid}: ${String(err)}`);
    } finally {
      setKillingPid(null);
    }
  };

  return (
    <div className="rt-subsurface flex h-full w-full flex-col">
      <div className="rt-divider-b flex items-center justify-between gap-2 px-2.5 py-1.5">
        <div className="rt-text-muted flex items-center gap-1.5 text-xs">
          <Icon name="server" size={13} className="rt-accent-text shrink-0" />
          <span className="font-medium">Localhost</span>
          {ports.length > 0 ? (
            <span className="rt-badge px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
              {ports.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          title="Rescan ports"
          className="rt-btn flex h-6 w-6 items-center justify-center"
        >
          <Icon
            name="sync"
            size={13}
            className={loading ? "animate-spin" : undefined}
            aria-label="Rescan ports"
          />
        </button>
      </div>

      {error ? (
        <p className="rt-text-muted px-2.5 py-1.5 text-[11px] leading-snug">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && ports.length === 0 ? (
          <div className="flex flex-col gap-1.5 p-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rt-skeleton h-9 w-full rounded-md" />
            ))}
          </div>
        ) : ports.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Icon name="server" size={20} className="rt-text-faint" />
            <p className="rt-text-muted text-xs leading-relaxed">
              No local servers detected. Listening ports will appear here with a
              one-click stop.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1 p-1.5">
            {ports.map((port) => {
              const killing = killingPid === port.pid;
              return (
                <li
                  key={`${port.pid}-${port.port}`}
                  className="rt-row flex items-center gap-2.5 px-2 py-1.5"
                >
                  <Icon
                    name="server"
                    size={15}
                    className="rt-row-icon shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="rt-accent-text text-sm font-semibold tabular-nums">
                        :{port.port}
                      </span>
                      <span className="truncate text-xs font-medium">
                        {processLabel(port)}
                      </span>
                    </div>
                    <div className="rt-text-faint truncate text-[11px]">
                      {port.address} · pid {port.pid}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleKill(port.pid)}
                    disabled={killing}
                    title={`Stop ${processLabel(port)} on port ${port.port}`}
                    className="rt-btn-outline rt-btn-danger flex shrink-0 items-center gap-1 px-2 py-1 text-xs font-medium disabled:opacity-60"
                  >
                    <Icon
                      name={killing ? "sync" : "terminate"}
                      size={12}
                      className={killing ? "animate-spin" : undefined}
                    />
                    <span>{killing ? "Stopping" : "Stop"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default LocalhostPanel;
