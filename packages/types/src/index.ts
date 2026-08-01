export type ServerType = "vanilla" | "paper" | "spigot" | "forge" | "fabric" | "velocity" | "custom";

export type ServerStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "crash-loop"
  | "error";

export interface ServerStats {
  uptimeMs: number;
  memoryUsedMb: number;
  memoryMaxMb: number;
  cpuPercent: number;
  tps: number | null;
  playersOnline: number;
  playersMax: number;
}

export interface MinecraftServer {
  id: string;
  name: string;
  type: ServerType;
  version: string;
  jarPath: string | null;
  status: ServerStatus;
  autoStart: boolean;
  autoRestart: boolean;
  restartsCount: number;
  javaArgs: string[];
  javaPath: string | null;
  memoryMaxMb: number;
  memoryMinMb: number;
  serverProps: Record<string, string>;
  serverPropsFile?: Record<string, string>;
  velocityProxyId: string | null;
  velocityTomlFile?: string;
  port: number;
  createdAt: string;
  updatedAt: string;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  pid: number | null;
  stats: ServerStats | null;
}

export interface LogEntry {
  id: string;
  serverId: string;
  timestamp: string;
  stream: "stdout" | "stderr" | "system";
  level: "trace" | "debug" | "info" | "warn" | "error";
  message: string;
}

export interface VersionManifest {
  type: ServerType;
  versions: string[];
  loaderVersions?: string[];
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export type ServerEventMap = {
  status: { serverId: string; status: ServerStatus };
  log: LogEntry;
  stats: { serverId: string; stats: ServerStats };
  created: { server: MinecraftServer };
  updated: { server: MinecraftServer };
  deleted: { serverId: string };
};

export type ServerEvent = {
  [K in keyof ServerEventMap]: { type: K } & ServerEventMap[K];
}[keyof ServerEventMap];

export interface User {
  id: string;
  username: string;
  role: "admin" | "operator" | "viewer";
  email: string | null;
  avatar: string | null;
  createdAt: string;
}

export interface BackupInfo {
  id: string;
  serverId: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ScheduleInfo {
  id: string;
  serverId: string;
  cron: string;
  action: "start" | "stop" | "restart" | "backup" | "command";
  command?: string;
  enabled: boolean;
  createdAt: string;
}

export type ClientLauncherType = "vanilla" | "forge" | "fabric";

export type ClientBuildStatus = "queued" | "building" | "done" | "error";

export interface ClientBuildInfo {
  id: string;
  launcherType: ClientLauncherType;
  mcVersion: string;
  loaderVersion: string | null;
  username: string;
  status: ClientBuildStatus;
  progress: number;
  message: string;
  sizeBytes: number | null;
  zipPath: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LauncherVersionsResponse {
  type: ClientLauncherType;
  versions: string[];
  loaders?: string[];
}

export interface RemoteServerInfo {
  id: string;
  name: string;
  type: ServerType;
  version: string;
  status: ServerStatus;
  memoryMaxMb: number;
}
