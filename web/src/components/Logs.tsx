import { useEffect, useState } from "react";
import type { LogEntry } from "@minecher/types";
import { api } from "../api";

export default function Logs({ serverId }: { serverId: string }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (query = q, lvl = level) => {
    setBusy(true);
    setError(null);
    try {
      const { entries } = await api.logs(serverId, { limit: 500, q: query || undefined, level: lvl });
      setEntries(entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load("", "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  return (
    <div className="logs">
      <div className="logs-toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search logs…" />
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="all">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
          <option value="debug">Debug</option>
        </select>
        <button onClick={() => void load()}>{busy ? "Loading…" : "Search"}</button>
      </div>
      {error && <div className="error banner">{error}</div>}
      <div className="console-box">
        {entries.map((line) => (
          <div key={line.id} className={`log-line log-${line.level}`}>
            <span className="ts">{new Date(line.timestamp).toLocaleString()}</span>
            <span className="stream">[{line.stream}]</span>
            <span className="msg">{line.message}</span>
          </div>
        ))}
        {entries.length === 0 && <div className="muted">No logs found.</div>}
      </div>
    </div>
  );
}
