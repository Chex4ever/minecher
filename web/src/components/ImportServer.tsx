import { useState } from "react";
import type { RemoteServerInfo } from "@minecher/types";
import { api } from "../api";

const TYPE_OPTIONS = [
  { value: "", label: "Auto-detect" },
  { value: "vanilla", label: "Vanilla" },
  { value: "paper", label: "Paper" },
  { value: "spigot", label: "Spigot" },
  { value: "forge", label: "Forge" },
  { value: "fabric", label: "Fabric" },
  { value: "custom", label: "Custom (own jar)" },
];

type Mode = "path" | "mcs" | "remote";

export default function ImportServer({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [mode, setMode] = useState<Mode>("path");
  const [path, setPath] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [version, setVersion] = useState("");
  const [portText, setPortText] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteUser, setRemoteUser] = useState("");
  const [remotePass, setRemotePass] = useState("");
  const [remoteServers, setRemoteServers] = useState<RemoteServerInfo[]>([]);
  const [remoteServerId, setRemoteServerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const port = portText.trim() === "" ? undefined : Number(portText);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const fetchRemoteServers = async () => {
    if (!remoteUrl.trim() || !remoteUser.trim() || !remotePass) {
      setError("Remote URL, username and password are required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { servers } = await api.listRemoteServers({
        url: remoteUrl.trim(),
        username: remoteUser.trim(),
        password: remotePass,
      });
      setRemoteServers(servers);
      setRemoteServerId(servers[0]?.id ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect to remote Minecher");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (mode === "path" && !path.trim()) {
      setError("Path is required");
      return;
    }
    if (mode === "mcs" && !file) {
      setError("Choose a .mcs file");
      return;
    }
    if (mode === "remote" && (!remoteServerId || !remoteUrl.trim() || !remoteUser.trim() || !remotePass)) {
      setError("Fetch remote servers and pick one first");
      return;
    }
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setError("Port must be 1-65535");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "path") {
        await api.importPath({
          path: path.trim(),
          name: name.trim() || undefined,
          type: type || undefined,
          version: version.trim() || undefined,
          port,
        });
      } else if (mode === "mcs" && file) {
        await api.importMcS(file, { name: name.trim() || undefined, port });
      } else {
        await api.importRemote({
          url: remoteUrl.trim(),
          username: remoteUser.trim(),
          password: remotePass,
          serverId: remoteServerId,
          name: name.trim() || undefined,
          port,
        });
      }
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import server</h2>
        <div className="tabs">
          <button className={mode === "path" ? "active" : ""} onClick={() => switchMode("path")}>
            Existing folder
          </button>
          <button className={mode === "mcs" ? "active" : ""} onClick={() => switchMode("mcs")}>
            .mcs archive
          </button>
          <button className={mode === "remote" ? "active" : ""} onClick={() => switchMode("remote")}>
            From another Minecher
          </button>
        </div>
        {mode !== "remote" && (
          <label>
            Name <span className="port-hint">(пусто — из имени папки/архива)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Server" />
          </label>
        )}
        {mode === "path" ? (
          <>
            <label>
              Server folder path
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="S:\path\to\server"
                autoFocus
              />
            </label>
            <div className="row">
              <label>
                Type
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Version
                <input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.20.1"
                />
              </label>
            </div>
          </>
        ) : mode === "mcs" ? (
          <label>
            .mcs file
            <input type="file" accept=".mcs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        ) : (
          <>
            <label>
              Remote Minecher URL
              <input
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://example.com:5173"
                autoFocus
              />
            </label>
            <div className="row">
              <label>
                Username
                <input value={remoteUser} onChange={(e) => setRemoteUser(e.target.value)} autoComplete="off" />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={remotePass}
                  onChange={(e) => setRemotePass(e.target.value)}
                  autoComplete="off"
                />
              </label>
            </div>
            {remoteServers.length > 0 && (
              <label>
                Remote server
                <select value={remoteServerId} onChange={(e) => setRemoteServerId(e.target.value)}>
                  {remoteServers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type} {s.version}, {s.status})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {mode !== "remote" && (
          <label>
            Port <span className="port-hint">(пусто — авто)</span>
            <input
              type="number"
              value={portText}
              min={1}
              max={65535}
              placeholder="25565"
              onChange={(e) => setPortText(e.target.value)}
            />
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          {mode === "remote" && (
            <button className="ghost" onClick={() => void fetchRemoteServers()} disabled={busy}>
              {busy ? "Connecting…" : "Fetch servers"}
            </button>
          )}
          <button className="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
