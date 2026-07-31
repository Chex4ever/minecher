import type { ServerType } from "@minecher/types";

export interface VersionSource {
  type: ServerType;
  listVersions(): Promise<string[]>;
  listLoaderVersions(mcVersion: string): Promise<string[]>;
  resolveJar(version: string, loaderVersion?: string): Promise<string>;
}export class VersionSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionSourceError";
  }
}

const UA =
  "minecher/0.1 (Minecraft server manager; Node.js; https://github.com/minecher/minecher)";

export async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new VersionSourceError(
        `GET ${url} -> ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
