import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { MinecraftServer } from "@minecher/types";
import { api } from "../api";
import { useAuth } from "../auth";
import Console from "../components/Console";
import Logs from "../components/Logs";
import Settings from "../components/Settings";
import Backups from "../components/Backups";
import Schedules from "../components/Schedules";
import PushServer from "../components/PushServer";

type Tab = "console" | "logs" | "settings" | "backups" | "schedules";

export default function ServerPage() {
  const { id } = useParams<{ id: string }>();
  const { canOperate } = useAuth();
  const [tab, setTab] = useState<Tab>("console");
  const [server, setServer] = useState<MinecraftServer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [showPush, setShowPush] = useState(false);

  const refresh = async () => {
    if (!id) return;
    try {
      setServer((await api.getServer(id)).server);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load server");
    }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setFlash(null);
    try {
      await fn();
      setFlash(label);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  };

  if (!id) return null;

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/">← Servers</Link>
        <h1 className="spacer-left">{server?.name ?? "…"}</h1>
        <span className="muted">
          {server ? `${server.type} ${server.version}` : ""}
        </span>
        <div className="spacer" />
        <Link className="button ghost" to="/launcher">
          Launcher
        </Link>
        {canOperate && server && (
          <>
            {server.status === "running" ? (
              <button onClick={() => void act("Stopping…", () => api.stopServer(server.id))}>Stop</button>
            ) : (
              <button className="primary" onClick={() => void act("Starting…", () => api.startServer(server.id))}>
                Start
              </button>
            )}
            {server.status === "running" && (
              <button onClick={() => void act("Restarting…", () => api.restartServer(server.id))}>Restart</button>
            )}
          </>
        )}
        {canOperate && server && (
          <>
            <button
              className="ghost"
              onClick={() =>
                void act("Exporting…", async () => {
                  const { blob, filename } = await api.exportMcS(server.id);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = filename;
                  a.click();
                  URL.revokeObjectURL(url);
                })
              }
            >
              Export .mcs
            </button>
            <button className="ghost" onClick={() => setShowPush(true)}>
              Push to Minecher
            </button>
          </>
        )}
      </header>

      <nav className="tabs">
        {(["console", "logs", "settings", "backups", "schedules"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <main className="content">
        {error && <div className="error banner">{error}</div>}
        {flash && <div className="ok banner">{flash}</div>}
        {tab === "console" && <Console serverId={id} />}
        {tab === "logs" && <Logs serverId={id} />}
        {tab === "settings" && <Settings serverId={id} />}
        {tab === "backups" && <Backups serverId={id} />}
        {tab === "schedules" && <Schedules serverId={id} />}
      </main>

      {showPush && server && (
        <PushServer
          serverId={server.id}
          serverName={server.name}
          onClose={() => setShowPush(false)}
          onPushed={() => {
            setShowPush(false);
            setFlash("Pushed");
          }}
        />
      )}
    </div>
  );
}
