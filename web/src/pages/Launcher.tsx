import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ClientBuildInfo, ClientLauncherType, MinecraftServer } from "@minecher/types";
import { api } from "../api";
import { useAuth } from "../auth";

const TYPE_LABEL: Record<ClientLauncherType, string> = {
  vanilla: "Vanilla",
  forge: "Forge",
  fabric: "Fabric",
};

const STATUS_LABEL: Record<ClientBuildInfo["status"], string> = {
  queued: "Queued",
  building: "Building",
  done: "Ready",
  error: "Error",
};

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  const mb = n / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function buildTitle(b: ClientBuildInfo): string {
  const type = TYPE_LABEL[b.launcherType] ?? b.launcherType;
  return `${type} ${b.mcVersion}${b.loaderVersion ? ` (${b.loaderVersion})` : ""}`;
}

export default function Launcher() {
  const { session, logout, canOperate } = useAuth();
  const [type, setType] = useState<ClientLauncherType>("vanilla");
  const [versions, setVersions] = useState<string[]>([]);
  const [mcVersion, setMcVersion] = useState("");
  const [loaders, setLoaders] = useState<string[]>([]);
  const [loader, setLoader] = useState("");
  const [username, setUsername] = useState("");
  const [builds, setBuilds] = useState<ClientBuildInfo[]>([]);
  const [servers, setServers] = useState<MinecraftServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<ClientBuildInfo | null>(null);

  const refreshBuilds = useCallback(async () => {
    try {
      const { builds } = await api.listLauncherBuilds();
      setBuilds(builds);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load builds");
    }
  }, []);

  useEffect(() => {
    void refreshBuilds();
    const timer = setInterval(refreshBuilds, 2000);
    return () => clearInterval(timer);
  }, [refreshBuilds]);

  useEffect(() => {
    api
      .listServers()
      .then(({ servers }) => setServers(servers))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setMcVersion("");
    setLoader("");
    setLoaders([]);
    api
      .launcherVersions(type)
      .then(({ versions }) => setVersions(versions))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load versions"));
  }, [type]);

  useEffect(() => {
    setLoader("");
    setLoaders([]);
    if (type === "vanilla" || !mcVersion) return;
    api
      .launcherLoaders(type, mcVersion)
      .then(({ loaders }) => setLoaders(loaders))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load loaders"));
  }, [type, mcVersion]);

  const submit = async () => {
    if (!username.trim()) {
      setError("Enter a username");
      return;
    }
    if (!mcVersion) {
      setError("Select a version");
      return;
    }
    if ((type === "forge" || type === "fabric") && !loader) {
      setError("Select a loader version");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createLauncherBuild({
        launcherType: type,
        mcVersion,
        loaderVersion: type === "vanilla" ? undefined : loader,
        username: username.trim(),
      });
      await refreshBuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start build");
    } finally {
      setBusy(false);
    }
  };

  const download = async (build: ClientBuildInfo) => {
    try {
      const { blob, filename } = await api.downloadLauncherBuild(build.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const remove = async (build: ClientBuildInfo) => {
    if (!confirm(`Delete build "${buildTitle(build)}"?`)) return;
    try {
      await api.deleteLauncherBuild(build.id);
      await refreshBuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const host = window.location.hostname || "localhost";

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/">← Servers</Link>
        <h1 className="spacer-left">Launcher</h1>
        <span className="muted">{session?.username} ({session?.role})</span>
        <div className="spacer" />
        <button className="ghost" onClick={logout}>
          Sign out
        </button>
      </header>

      <main className="content">
        {error && <div className="error banner">{error}</div>}

        <div className="launcher-grid">
          <section className="card">
            <h3>Build a client</h3>
            <p className="muted">
              Assembles a full Minecraft client (libraries, assets, sounds) into a zip you can run
              with Java on PC or PojavLauncher on Android.
            </p>
            <div className="launcher-form">
              <label>
                Type
                <select value={type} onChange={(e) => setType(e.target.value as ClientLauncherType)}>
                  {(Object.keys(TYPE_LABEL) as ClientLauncherType[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Minecraft version
                <select
                  value={mcVersion}
                  onChange={(e) => setMcVersion(e.target.value)}
                  disabled={versions.length === 0}
                >
                  {versions.length === 0 ? (
                    <option>Loading…</option>
                  ) : (
                    <>
                      <option value="">Select…</option>
                      {versions.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>
              {type !== "vanilla" && (
                <label>
                  Loader
                  <select
                    value={loader}
                    onChange={(e) => setLoader(e.target.value)}
                    disabled={!mcVersion || loaders.length === 0}
                  >
                    {!mcVersion ? (
                      <option>Pick a version first</option>
                    ) : loaders.length === 0 ? (
                      <option>Loading…</option>
                    ) : (
                      <>
                        <option value="">Select…</option>
                        {loaders.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </label>
              )}
              <label>
                Username (offline)
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Steve"
                  maxLength={16}
                />
              </label>
              <button className="primary" disabled={busy} onClick={() => void submit()}>
                {busy ? "Starting…" : "Build client"}
              </button>
            </div>
            <p className="muted port-hint">
              First build of a version downloads ~1 GB of assets. Later builds reuse the cache.
            </p>
          </section>

          <section className="card">
            <h3>Server addresses</h3>
            <p className="muted">Connect the client to one of these (offline mode).</p>
            {servers.filter((s) => s.type !== "velocity").length === 0 ? (
              <p className="muted">No servers configured yet.</p>
            ) : (
              <ul className="launcher-addresses">
                {servers
                  .filter((s) => s.type !== "velocity")
                  .map((s) => (
                    <li key={s.id}>
                      <div>
                        <strong>{s.name}</strong>
                        <span className="mono">{`${host}:${s.port}`}</span>
                      </div>
                      <button
                        className="ghost"
                        onClick={() => void navigator.clipboard.writeText(`${host}:${s.port}`)}
                      >
                        Copy
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>

        <section className="card builds-card">
          <h3>Builds</h3>
          {builds.length === 0 ? (
            <p className="muted">No builds yet.</p>
          ) : (
            <ul className="build-list">
              {builds.map((b) => (
                <li key={b.id}>
                  <div className="build-info">
                    <div className="build-title">
                      <strong>{buildTitle(b)}</strong>
                      <span className={`status status-${b.status === "done" ? "running" : b.status === "error" ? "error" : "starting"}`}>
                        {STATUS_LABEL[b.status]}
                      </span>
                    </div>
                    {b.status === "building" || b.status === "queued" ? (
                      <div className="progress">
                        <div className="progress-bar" style={{ width: `${Math.round(b.progress * 100)}%` }} />
                      </div>
                    ) : null}
                    <span className="muted mono">
                      {b.username} · {fmtBytes(b.sizeBytes)}
                    </span>
                    {b.status === "building" && <span className="muted">{b.message}</span>}
                    {b.status === "error" && <span className="error">{b.error}</span>}
                  </div>
                  <div className="build-actions">
                    {b.status === "done" && (
                      <>
                        <button className="primary" onClick={() => void download(b)}>
                          Download zip
                        </button>
                        <button className="ghost" onClick={() => setHelp(b)}>
                          Help
                        </button>
                      </>
                    )}
                    {canOperate && (
                      <button className="danger" onClick={() => void remove(b)}>
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Using the client</h3>
            <ol className="launcher-help">
              <li>
                <strong>PC (Windows):</strong> extract the zip and run <code>start.bat</code> (requires Java 17+).
              </li>
              <li>
                <strong>PC (Linux/macOS):</strong> extract, then run{" "}
                <code>chmod +x start.sh &amp;&amp; ./start.sh</code>.
              </li>
              <li>
                <strong>Android (PojavLauncher):</strong> install PojavLauncher, copy this folder to{" "}
                <code>Android/data/net.kdt.pojavlaunch/files/.minecraft/</code>, then launch the version and use an
                offline account named <strong>{help.username}</strong>.
              </li>
            </ol>
            <p className="muted">
              The bundle contains <code>README.txt</code> and <code>launcher.json</code> with the same instructions and
              server addresses. Servers must run with <code>online-mode=false</code>.
            </p>
            <div className="modal-actions">
              <button onClick={() => setHelp(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
