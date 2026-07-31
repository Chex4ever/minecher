import path from "node:path";
import fs from "node:fs";

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  authSecret: string;
  jwtExpiresIn: string;
  logMaxBytes: number;
}

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value !== undefined && value !== "" ? value : fallback;
}

const dataDir = path.resolve(env("MC_DATA_DIR", path.join(process.cwd(), "data")));

function resolveHost(raw: string): string {
  if (raw.includes(":") || raw.includes("::")) {
    throw new Error(
      `MC_HOST must be an IPv4 address or hostname, got "${raw}". IPv6 is not supported.`,
    );
  }
  return raw;
}

export function resolveDataDir(): AppConfig {
  const config: AppConfig = {
    host: resolveHost(env("MC_HOST", "0.0.0.0")),
    port: Number(env("MC_PORT", "8080")),
    dataDir,
    authSecret: env("MC_AUTH_SECRET", "change-me-in-production"),
    jwtExpiresIn: env("MC_JWT_EXPIRES", "7d"),
    logMaxBytes: Number(env("MC_LOG_MAX_BYTES", String(50 * 1024 * 1024))),
  };

  for (const dir of [config.dataDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return config;
}

export function subDir(config: AppConfig, ...parts: string[]): string {
  const dir = path.join(config.dataDir, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
