import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type { User } from "@minecher/types";
import { api, avatarUrl } from "../api";
import { useAuth } from "../auth";

const ROLE_LABEL: Record<User["role"], string> = {
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
};

export default function Users() {
  const { session, logout, isAdmin } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<User["role"]>("viewer");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { users } = await api.listUsers();
      setUsers(users);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      await api.createUser({ username, password, role });
      setUsername("");
      setPassword("");
      setRole("viewer");
      setMessage(`User "${username}" created`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/">← Back</Link>
        <h1 className="spacer-left">Users</h1>
        <div className="spacer" />
        <span className="muted">
          {session?.username} ({session?.role})
        </span>
        <button className="ghost" onClick={logout}>
          Sign out
        </button>
      </header>

      <main className="content">
        {message && <div className="ok banner">{message}</div>}
        {error && <div className="error banner">{error}</div>}

        <div className="settings">
          <div className="card">
            <h3>Create user</h3>
            <form className="settings-grid" onSubmit={(e) => void create(e)}>
              <label>
                Username
                <input value={username} onChange={(e) => setUsername(e.target.value)} required />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </label>
              <label>
                Role
                <select value={role} onChange={(e) => setRole(e.target.value as User["role"])}>
                  <option value="viewer">Viewer</option>
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <button className="primary" type="submit" disabled={busy}>
                Create
              </button>
            </form>
          </div>

          <div className="card">
            <h3>Users</h3>
            <div className="user-list">
              {users.map((user) => (
                <div key={user.id} className="user-row">
                  {user.avatar ? (
                    <img className="avatar-sm" src={avatarUrl(user.avatar) ?? undefined} alt="" />
                  ) : (
                    <div className="avatar-sm avatar-placeholder">{user.username.slice(0, 1).toUpperCase()}</div>
                  )}
                  <span className="user-name">{user.username}</span>
                  <span className={`role role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
                  {session?.id === user.id && <span className="muted">(you)</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
