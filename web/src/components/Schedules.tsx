import { useCallback, useEffect, useState } from "react";
import type { ScheduleInfo } from "@minecher/types";
import { api } from "../api";
import { useAuth } from "../auth";

const ACTIONS = ["start", "stop", "restart", "backup", "command"] as const;

export default function Schedules({ serverId }: { serverId: string }) {
  const { canOperate } = useAuth();
  const [schedules, setSchedules] = useState<ScheduleInfo[]>([]);
  const [cron, setCron] = useState("0 3 * * *");
  const [action, setAction] = useState<(typeof ACTIONS)[number]>("restart");
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { schedules } = await api.request<{ schedules: ScheduleInfo[] }>(`/servers/${serverId}/schedules`);
      setSchedules(schedules);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load schedules");
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setError(null);
    try {
      await api.request(`/servers/${serverId}/schedules`, {
        method: "POST",
        body: JSON.stringify({ cron, action, command: action === "command" ? command : undefined }),
      });
      setCommand("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create schedule");
    }
  };

  const toggle = async (schedule: ScheduleInfo) => {
    try {
      await api.request(`/servers/${serverId}/schedules/${schedule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update schedule");
    }
  };

  const remove = async (schedule: ScheduleInfo) => {
    if (!confirm("Delete this schedule?")) return;
    try {
      await api.request(`/servers/${serverId}/schedules/${schedule.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete schedule");
    }
  };

  return (
    <div className="schedules">
      {canOperate && (
        <div className="schedule-form">
          <label>
            Cron
            <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 3 * * *" />
          </label>
          <label>
            Action
            <select value={action} onChange={(e) => setAction(e.target.value as (typeof ACTIONS)[number])}>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          {action === "command" && (
            <label>
              Command
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="save-all" />
            </label>
          )}
          <button className="primary" onClick={() => void create()}>
            Add
          </button>
        </div>
      )}
      {error && <div className="error banner">{error}</div>}
      <table className="table">
        <thead>
          <tr>
            <th>Cron</th>
            <th>Action</th>
            <th>Command</th>
            <th>Enabled</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => (
            <tr key={s.id}>
              <td className="mono">{s.cron}</td>
              <td>{s.action}</td>
              <td className="mono">{s.command ?? "—"}</td>
              <td>
                <input type="checkbox" checked={s.enabled} onChange={() => void toggle(s)} disabled={!canOperate} />
              </td>
              <td className="actions-cell">
                {canOperate && (
                  <button className="danger" onClick={() => void remove(s)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {schedules.length === 0 && <div className="muted">No schedules yet.</div>}
    </div>
  );
}
