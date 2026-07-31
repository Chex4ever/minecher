import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "@minecher/types";
import { consoleUrl } from "../api";
import { useAuth } from "../auth";

interface ConsoleMessage {
  type: "tail" | "log" | "status" | "error";
  entries?: LogEntry[];
  entry?: LogEntry;
  status?: string;
  message?: string;
}

export default function Console({ serverId }: { serverId: string }) {
  const { canOperate } = useAuth();
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<LogEntry[]>([]);

  useEffect(() => {
    setLines([]);
    setError(null);
    const ws = new WebSocket(consoleUrl(serverId));

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError("Console connection error");
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ConsoleMessage;
        if (msg.type === "tail" && msg.entries) {
          setLines(msg.entries);
        } else if (msg.type === "log" && msg.entry) {
          setLines((prev) => [...prev.slice(-2000), msg.entry!]);
        } else if (msg.type === "error") {
          setError(msg.message ?? "Console error");
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    wsRef.current = ws;
    return () => ws.close();
  }, [serverId]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    if (atBottom) box.scrollTop = box.scrollHeight;
  });

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "command", command: input.trim() }));
    setInput("");
  };

  return (
    <div className="console">
      <div className="console-head">
        <span className={`dot ${connected ? "on" : ""}`} />
        {connected ? "Connected" : "Disconnected"}
        {error && <span className="error"> · {error}</span>}
      </div>
      <div className="console-box" ref={boxRef}>
        {lines.map((line) => (
          <div key={line.id} className={`log-line log-${line.level}`}>
            <span className="ts">{new Date(line.timestamp).toLocaleTimeString()}</span>
            <span className="stream">[{line.stream}]</span>
            <span className="msg">{line.message}</span>
          </div>
        ))}
      </div>
      {canOperate && (
        <form className="console-input" onSubmit={send}>
          <span>&gt;</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a command, e.g. op Steve"
            disabled={!connected}
            autoComplete="off"
          />
        </form>
      )}
    </div>
  );
}
