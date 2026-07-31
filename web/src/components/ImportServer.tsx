import { useState } from "react";
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

export default function ImportServer({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [mode, setMode] = useState<"path" | "mcs">("path");
  const [path, setPath] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [version, setVersion] = useState("");
  const [portText, setPortText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (mode === "path" && !path.trim()) {
      setError("Path is required");
      return;
    }
    if (mode === "mcs" && !file) {
      setError("Choose a .mcs file");
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
      if (mode === "path") {
        await api.importPath({
          path: path.trim(),
          name: name.trim() || undefined,
          type: type || undefined,
          version: version.trim() || undefined,
          port,
        });
      } else if (file) {
        await api.importMcS(file, { name: name.trim() || undefined, port });
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
          <button className={mode === "path" ? "active" : ""} onClick={() => setMode("path")}>
            Existing folder
          </button>
          <button className={mode === "mcs" ? "active" : ""} onClick={() => setMode("mcs")}>
            .mcs archive
          </button>
        </div>
        <label>
          Name <span className="port-hint">(пусто — из имени папки/архива)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Server" />
        </label>
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
        ) : (
          <label>
            .mcs file
            <input type="file" accept=".mcs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
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
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
