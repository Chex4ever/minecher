import { useEffect, useState } from "react";
import type { MinecraftServer } from "@minecher/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { usePortAvailability, PortBadge } from "../hooks/usePortAvailability";

export default function Settings({ serverId }: { serverId: string }) {
  const { canOperate } = useAuth();
  const [server, setServer] = useState<MinecraftServer | null>(null);
  const [javaArgs, setJavaArgs] = useState("");
  const [propsText, setPropsText] = useState("");
  const [autoStart, setAutoStart] = useState(false);
  const [autoRestart, setAutoRestart] = useState(true);
  const [memory, setMemory] = useState(1024);
  const [port, setPort] = useState(25565);
  const portStatus = usePortAvailability(Number.isInteger(port) ? port : null);
  const [javaPath, setJavaPath] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getServer(serverId)
      .then(({ server }) => {
        setServer(server);
        setJavaArgs(server.javaArgs.join(" "));
        setPropsText(
          Object.entries(server.serverPropsFile ?? server.serverProps)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n"),
        );
        setAutoStart(server.autoStart);
        setAutoRestart(server.autoRestart);
        setMemory(server.memoryMaxMb);
        setPort(server.port);
        setJavaPath(server.javaPath ?? "");
      })
      .catch((e) => setError(e.message));
  }, [serverId]);

  const save = async () => {
    setMessage(null);
    setError(null);
    try {
      const serverProps: Record<string, string> = {};
      for (const line of propsText.split("\n")) {
        const idx = line.indexOf("=");
        if (idx > 0) serverProps[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      const { server } = await api.updateServer(serverId, {
        autoStart,
        autoRestart,
        memoryMaxMb: memory,
        memoryMinMb: memory,
        port,
        javaPath: javaPath || null,
        javaArgs: javaArgs.split(/\s+/).filter(Boolean),
        serverProps,
      });
      setServer(server);
      setMessage("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  };

  if (!server) return <div className="muted">Loading…</div>;

  return (
    <div className="settings">
      <div className="settings-grid">
        <label>
          Auto-start on boot
          <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} disabled={!canOperate} />
        </label>
        <label>
          Auto-restart on crash
          <input type="checkbox" checked={autoRestart} onChange={(e) => setAutoRestart(e.target.checked)} disabled={!canOperate} />
        </label>
        <label>
          RAM (MB)
          <input type="number" value={memory} min={256} step={256} onChange={(e) => setMemory(Number(e.target.value))} disabled={!canOperate} />
        </label>
        <label>
          Port
          <input type="number" value={port} min={1} max={65535} onChange={(e) => setPort(Number(e.target.value))} disabled={!canOperate} />
          <PortBadge status={portStatus} />
        </label>
        <label className="span2">
          Java path (leave empty for auto-detect)
          <input value={javaPath} onChange={(e) => setJavaPath(e.target.value)} placeholder="C:\Program Files\Java\jdk-21\bin\java.exe" disabled={!canOperate} />
        </label>
        <label className="span2">
          Extra JVM args
          <input value={javaArgs} onChange={(e) => setJavaArgs(e.target.value)} placeholder="-XX:+UseG1GC -XX:+DisableExplicitGC" disabled={!canOperate} />
        </label>
        <label className="span2">
          server.properties
          <textarea rows={10} value={propsText} onChange={(e) => setPropsText(e.target.value)} disabled={!canOperate} spellCheck={false} />
        </label>
      </div>
      {message && <div className="ok">{message}</div>}
      {error && <div className="error">{error}</div>}
      {canOperate && (
        <button className="primary" onClick={() => void save()}>
          Save
        </button>
      )}
    </div>
  );
}
