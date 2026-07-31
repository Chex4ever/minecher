import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { usePortAvailability, PortBadge } from "../hooks/usePortAvailability";

const TYPES: { value: string; label: string }[] = [
  { value: "vanilla", label: "Vanilla" },
  { value: "paper", label: "Paper" },
  { value: "spigot", label: "Spigot" },
  { value: "forge", label: "Forge" },
  { value: "fabric", label: "Fabric" },
];

export default function CreateServer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { canOperate } = useAuth();
  const [name, setName] = useState("");
  const [type, setType] = useState("paper");
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion] = useState("");
  const [loaders, setLoaders] = useState<string[]>([]);
  const [loader, setLoader] = useState("");
  const [memory, setMemory] = useState(1024);
  const [portText, setPortText] = useState("");
  const port = portText.trim() === "" ? null : Number(portText);
  const portStatus = usePortAvailability(port && Number.isInteger(port) ? port : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canOperate) return;
    setVersion("");
    setLoader("");
    setLoaders([]);
    api
      .versions(type)
      .then((r) => {
        setVersions(r.versions);
        setVersion(r.versions[0] ?? "");
      })
      .catch((e) => setError(e.message));
  }, [type, canOperate]);

  useEffect(() => {
    if (type === "forge" || type === "fabric") {
      if (!version) return;
      api
        .loaders(type, version)
        .then((r) => {
          setLoaders(r.loaders);
          setLoader(r.loaders[0] ?? "");
        })
        .catch(() => setLoaders([]));
    } else {
      setLoaders([]);
      setLoader("");
    }
  }, [type, version]);

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (port && !Number.isInteger(port)) {
      setError("Port must be a whole number");
      return;
    }
    if (port && (port < 1 || port > 65535)) {
      setError("Port must be 1-65535");
      return;
    }
    if (port && !portStatus.available && !portStatus.checking) {
      setError(`Port ${port} is already in use`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createServer({
        name: name.trim(),
        type,
        version,
        loaderVersion: loader || undefined,
        memoryMaxMb: memory,
        memoryMinMb: memory,
        port: port ?? undefined,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create server");
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New server</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Survival" autoFocus />
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Version
          <select value={version} onChange={(e) => setVersion(e.target.value)}>
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {(type === "forge" || type === "fabric") && loaders.length > 0 && (
          <label>
            Loader {type === "forge" ? "(Forge build)" : "(Fabric loader)"}
            <select value={loader} onChange={(e) => setLoader(e.target.value)}>
              {loaders.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="row">
          <label>
            RAM (MB)
            <input type="number" value={memory} min={512} step={256} onChange={(e) => setMemory(Number(e.target.value))} />
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
            <PortBadge status={portStatus} />
          </label>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
