import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";

export default function PushServer({
  serverId,
  serverName,
  onClose,
  onPushed,
}: {
  serverId: string;
  serverName: string;
  onClose: () => void;
  onPushed: () => void;
}) {
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [portText, setPortText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !username.trim() || !password) {
      setError("Remote URL, username and password are required");
      return;
    }
    const port = portText.trim() === "" ? undefined : Number(portText);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setError("Port must be 1-65535");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.pushRemote({
        url: url.trim(),
        username: username.trim(),
        password,
        serverId,
        name: name.trim() || undefined,
        port,
      });
      onPushed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Push server to Minecher</h2>
        <p className="muted">
          Push «{serverName}» to another Minecher instance. The server must be stopped.
        </p>
        <form className="settings-grid" onSubmit={(e) => void submit(e)}>
          <label className="span2">
            Remote Minecher URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com:5173"
              autoFocus
            />
          </label>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Name <span className="port-hint">(пусто — текущее имя)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={serverName} />
          </label>
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
          {error && <div className="error span2">{error}</div>}
          <div className="modal-actions span2">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Pushing…" : "Push"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
