import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { MinecraftServer, ServerType } from "@minecher/types";
import { api } from "../api";
import { useAuth } from "../auth";
import CreateServer from "../components/CreateServer";
import ImportServer from "../components/ImportServer";

const STATUS_LABEL: Record<MinecraftServer["status"], string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  "crash-loop": "Crash loop",
  error: "Error",
};

export default function Dashboard() {
  const { session, logout, canOperate, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [servers, setServers] = useState<MinecraftServer[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { servers } = await api.listServers();
      setServers(servers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  };

  const remove = async (server: MinecraftServer) => {
    if (!confirm(`Delete server "${server.name}"? This removes the world and all data.`)) return;
    await act(() => api.deleteServer(server.id));
  };

  return (
    <div className="layout">
      <header className="topbar">
        <h1>Minecher</h1>
        <div className="spacer" />
        <span className="muted">
          {session?.username} ({session?.role})
        </span>
        <Link className="button ghost" to="/launcher">
          Launcher
        </Link>
        {canOperate && (
          <>
            <button className="ghost" onClick={() => setShowImport(true)}>
              Import
            </button>
            <button onClick={() => setShowCreate(true)}>+ New server</button>
          </>
        )}
        <button className="ghost" onClick={logout}>
          Sign out
        </button>
      </header>

      <main className="content">
        {error && <div className="error banner">{error}</div>}
        {servers.length === 0 && !showCreate && (
          <div className="empty">
            <p>No servers yet.</p>
            {canOperate && <button className="primary" onClick={() => setShowCreate(true)}>Create your first server</button>}
          </div>
        )}
        <div className="grid">
          {servers.map((server) => (
            <div key={server.id} className="card">
              <div className="card-head" onClick={() => navigate(`/servers/${server.id}`)}>
                <div>
                  <h3>{server.name}</h3>
                  <span className="muted">
                    {server.type} {server.version}
                  </span>
                </div>
                <span className={`status status-${server.status}`}>{STATUS_LABEL[server.status]}</span>
              </div>
              <div className="card-body">
                <div className="kv">
                  <span>Port</span>
                  <span>{server.port}</span>
                  <span>RAM</span>
                  <span>{server.memoryMaxMb} MB</span>
                  <span>Players</span>
                  <span>{server.stats ? `${server.stats.playersOnline}/${server.stats.playersMax}` : "—"}</span>
                </div>
              </div>
              <div className="card-actions">
                {canOperate && (
                  <>
                    {server.status === "running" ? (
                      <button onClick={() => act(() => api.stopServer(server.id))}>Stop</button>
                    ) : (
                      <button className="primary" onClick={() => act(() => api.startServer(server.id))}>
                        Start
                      </button>
                    )}
                    {server.status === "running" && (
                      <button onClick={() => act(() => api.restartServer(server.id))}>Restart</button>
                    )}
                  </>
                )}
                <Link className="button" to={`/servers/${server.id}`}>
                  Console
                </Link>
                {isAdmin && (
                  <button className="danger" onClick={() => void remove(server)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>

      {showCreate && (
        <CreateServer
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void refresh();
          }}
        />
      )}
      {showImport && (
        <ImportServer
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

export type { ServerType };
