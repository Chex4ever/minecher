export const TOKEN_KEY = "minecher_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const hasBody = options.body != null && options.body !== "";
  if (hasBody && typeof options.body === "string") headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    throw new ApiError(401, "Unauthorized");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (body as { message?: string }).message ?? res.statusText);
  }
  return body as T;
}

export const api = {
  request: <T,>(path: string, options: RequestInit = {}): Promise<T> => request<T>(path, options),
  login: (username: string, password: string) =>
    request<{ token: string; user: import("@minecher/types").User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => request<{ user: import("@minecher/types").User }>("/auth/me"),
  updateProfile: (body: { username?: string; email?: string | null }) =>
    request<{ user: import("@minecher/types").User; token?: string }>("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/auth/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ user: import("@minecher/types").User }>("/auth/me/avatar", {
      method: "POST",
      body: form,
    });
  },
  removeAvatar: () => request<{ user: import("@minecher/types").User }>("/auth/me/avatar", { method: "DELETE" }),
  listServers: () => request<{ servers: import("@minecher/types").MinecraftServer[] }>("/servers"),
  getServer: (id: string) => request<{ server: import("@minecher/types").MinecraftServer }>(`/servers/${id}`),
  createServer: (body: Record<string, unknown>) =>
    request<{ server: import("@minecher/types").MinecraftServer }>("/servers", { method: "POST", body: JSON.stringify(body) }),
  updateServer: (id: string, body: Record<string, unknown>) =>
    request<{ server: import("@minecher/types").MinecraftServer }>(`/servers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteServer: (id: string) => request<void>(`/servers/${id}`, { method: "DELETE" }),
  startServer: (id: string) => request<{ ok: boolean }>(`/servers/${id}/start`, { method: "POST" }),
  stopServer: (id: string, force = false) => request<{ ok: boolean }>(`/servers/${id}/stop`, { method: "POST", body: JSON.stringify({ force }) }),
  restartServer: (id: string) => request<{ ok: boolean }>(`/servers/${id}/restart`, { method: "POST" }),
  command: (id: string, command: string) =>
    request<{ ok: boolean }>(`/servers/${id}/command`, { method: "POST", body: JSON.stringify({ command }) }),
  logs: (id: string, opts: { offset?: number; limit?: number; q?: string; level?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.offset !== undefined) params.set("offset", String(opts.offset));
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts.q) params.set("q", opts.q);
    if (opts.level) params.set("level", opts.level);
    return request<{ entries: import("@minecher/types").LogEntry[] }>(`/servers/${id}/logs?${params}`);
  },
  versions: (type: string) => request<{ type: string; versions: string[] }>(`/versions/${type}`),
  loaders: (type: string, version: string) =>
    request<{ type: string; version: string; loaders: string[] }>(`/versions/${type}/${version}/loaders`),
  checkPort: (port: number, exclude?: string) => {
    const qs = exclude ? `?exclude=${encodeURIComponent(exclude)}` : "";
    return request<{ port: number; available: boolean; usedBy: string | null }>(`/ports/${port}${qs}`);
  },
  listUsers: () => request<{ users: import("@minecher/types").User[] }>("/auth/users"),
  createUser: (body: { username: string; password: string; role: import("@minecher/types").User["role"] }) =>
    request<{ user: import("@minecher/types").User }>("/auth/users", { method: "POST", body: JSON.stringify(body) }),
  importPath: (body: Record<string, unknown>) =>
    request<{ server: import("@minecher/types").MinecraftServer }>("/imports/path", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  importMcS: (file: File, extra: { name?: string; port?: number } = {}) => {
    const form = new FormData();
    form.append("file", file);
    if (extra.name) form.append("name", extra.name);
    if (extra.port) form.append("port", String(extra.port));
    return request<{ server: import("@minecher/types").MinecraftServer }>("/imports/mcs", {
      method: "POST",
      body: form,
    });
  },
  listRemoteServers: (body: { url: string; username: string; password: string }) =>
    request<{ servers: import("@minecher/types").RemoteServerInfo[] }>("/imports/remote/list", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  importRemote: (body: {
    url: string;
    username: string;
    password: string;
    serverId: string;
    name?: string;
    port?: number;
  }) =>
    request<{ server: import("@minecher/types").MinecraftServer }>("/imports/remote", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  pushRemote: (body: {
    url: string;
    username: string;
    password: string;
    serverId: string;
    name?: string;
    port?: number;
  }) =>
    request<{ server: import("@minecher/types").MinecraftServer }>("/imports/remote/push", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  exportMcS: async (id: string): Promise<{ blob: Blob; filename: string }> => {
    const token = getToken();
    const res = await fetch(`/api/servers/${id}/export`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (res.status === 401) {
      clearToken();
      throw new ApiError(401, "Unauthorized");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, (body as { message?: string }).message ?? res.statusText);
    }
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = cd.match(/filename="?([^";]+)"?/);
    return { blob: await res.blob(), filename: m ? m[1] : "server.mcs" };
  },
  launcherVersions: (type: string) =>
    request<{ type: string; versions: string[] }>(`/launcher/versions?type=${encodeURIComponent(type)}`),
  launcherLoaders: (type: string, mcVersion: string) =>
    request<{ type: string; mcVersion: string; loaders: string[] }>(
      `/launcher/versions/${type}/${encodeURIComponent(mcVersion)}/loaders`,
    ),
  createLauncherBuild: (body: {
    launcherType: string;
    mcVersion: string;
    loaderVersion?: string;
    username: string;
  }) =>
    request<{ build: import("@minecher/types").ClientBuildInfo }>("/launcher/builds", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listLauncherBuilds: () =>
    request<{ builds: import("@minecher/types").ClientBuildInfo[] }>("/launcher/builds"),
  deleteLauncherBuild: (id: string) => request<void>(`/launcher/builds/${id}`, { method: "DELETE" }),
  downloadLauncherBuild: async (id: string): Promise<{ blob: Blob; filename: string }> => {
    const token = getToken();
    const res = await fetch(`/api/launcher/builds/${id}/download`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (res.status === 401) {
      clearToken();
      throw new ApiError(401, "Unauthorized");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, (body as { message?: string }).message ?? res.statusText);
    }
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = cd.match(/filename="?([^";]+)"?/);
    return { blob: await res.blob(), filename: m ? m[1] : "client.zip" };
  },
};

export function consoleUrl(serverId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = getToken();
  return `${protocol}//${window.location.host}/api/servers/${serverId}/console?token=${encodeURIComponent(token ?? "")}`;
}

export function avatarUrl(avatar: string | null): string | null {
  if (!avatar) return null;
  if (avatar.startsWith("data:") || avatar.startsWith("http://") || avatar.startsWith("https://")) return avatar;
  return `${avatar}?token=${encodeURIComponent(getToken() ?? "")}`;
}
