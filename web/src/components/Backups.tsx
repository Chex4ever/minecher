import { useCallback, useEffect, useState } from "react";
import type { BackupInfo } from "@minecher/types";
import { api } from "../api";
import { useAuth } from "../auth";

function fmt(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function Backups({ serverId }: { serverId: string }) {
  const { canOperate, isAdmin } = useAuth();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { backups } = await api.request<{ backups: BackupInfo[] }>(`/servers/${serverId}/backups`);
      setBackups(backups);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load backups");
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.request(`/servers/${serverId}/backups`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (backup: BackupInfo) => {
    if (!confirm(`Restore backup from ${new Date(backup.createdAt).toLocaleString()}?\nThe server must be stopped.`)) return;
    setError(null);
    try {
      await api.request(`/servers/${serverId}/backups/${backup.id}/restore`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    }
  };

  const remove = async (backup: BackupInfo) => {
    if (!confirm("Delete this backup file?")) return;
    try {
      await api.request(`/servers/${serverId}/backups/${backup.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="backups">
      <div className="backups-head">
        <span className="muted">{backups.length} backup(s)</span>
        {canOperate && (
          <button className="primary" onClick={() => void create()} disabled={busy}>
            {busy ? "Creating…" : "Create backup"}
          </button>
        )}
      </div>
      {error && <div className="error banner">{error}</div>}
      <table className="table">
        <thead>
          <tr>
            <th>Created</th>
            <th>Size</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {backups.map((b) => (
            <tr key={b.id}>
              <td>{new Date(b.createdAt).toLocaleString()}</td>
              <td>{fmt(b.sizeBytes)}</td>
              <td className="actions-cell">
                {isAdmin && (
                  <button onClick={() => void restore(b)}>Restore</button>
                )}
                {canOperate && (
                  <button className="danger" onClick={() => void remove(b)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {backups.length === 0 && <div className="muted">No backups yet.</div>}
    </div>
  );
}
