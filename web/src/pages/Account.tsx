import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, avatarUrl, setToken } from "../api";
import { useAuth } from "../auth";

export default function Account() {
  const { session, logout, updateUser } = useAuth();
  const [username, setUsername] = useState(session?.username ?? "");
  const [email, setEmail] = useState(session?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveProfile = async () => {
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      const { user, token } = await api.updateProfile({ username, email });
      if (token) setToken(token);
      updateUser(user);
      setEmail(user.email ?? "");
      setMessage("Profile saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setBusy(false);
    }
  };

  const onAvatarChange = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      const { user } = await api.uploadAvatar(file);
      updateUser(user);
      setMessage("Avatar updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload avatar");
    } finally {
      setBusy(false);
    }
  };

  const removeAvatar = async () => {
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      const { user } = await api.removeAvatar();
      updateUser(user);
      setMessage("Avatar removed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove avatar");
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password changed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setBusy(false);
    }
  };

  const avatar = avatarUrl(session?.avatar ?? null);

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/">← Back</Link>
        <h1 className="spacer-left">Account</h1>
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
            <h3>Profile</h3>
            <div className="row">
              <div className="avatar-preview">
                {avatar ? <img className="avatar-lg" src={avatar} alt="" /> : <div className="avatar-lg avatar-placeholder">{session?.username.slice(0, 1).toUpperCase()}</div>}
              </div>
              <div className="avatar-actions">
                <button onClick={() => fileRef.current?.click()} disabled={busy}>
                  Upload avatar
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  style={{ display: "none" }}
                  onChange={(e) => void onAvatarChange(e.target.files?.[0])}
                />
                {session?.avatar && (
                  <button className="ghost" onClick={() => void removeAvatar()} disabled={busy}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            <div className="settings-grid">
              <label>
                Username
                <input value={username} onChange={(e) => setUsername(e.target.value)} />
              </label>
              <label>
                Email
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
            </div>
            <button className="primary" onClick={() => void saveProfile()} disabled={busy}>
              Save profile
            </button>
          </div>

          <div className="card">
            <h3>Change password</h3>
            <form className="settings-grid" onSubmit={(e) => void changePassword(e)}>
              <label>
                Current password
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
              </label>
              <label>
                New password
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
              </label>
              <label className="span2">
                Confirm new password
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
              </label>
              <button className="primary" type="submit" disabled={busy}>
                Change password
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
