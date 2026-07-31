import { VersionSource, VersionSourceError } from "./source.js";
import type { ServerType } from "@minecher/types";

interface FabricVersions {
  game: { version: string; stable: boolean }[];
  loader: { version: string; stable: boolean }[];
  installer: { version: string; stable: boolean }[];
}

const FABRIC_META = "https://meta.fabricmc.net/v2/versions";

export class FabricSource implements VersionSource {
  type: ServerType = "fabric";

  private async meta(): Promise<FabricVersions> {
    return await fetchJson<FabricVersions>(FABRIC_META);
  }

  async listVersions(): Promise<string[]> {
    const meta = await this.meta();
    return meta.game
      .filter((g) => g.stable)
      .map((g) => g.version)
      .reverse();
  }

  async listLoaderVersions(_mcVersion: string): Promise<string[]> {
    const meta = await this.meta();
    return meta.loader.map((l) => l.version);
  }

  async resolveJar(version: string, loaderVersion?: string): Promise<string> {
    const meta = await this.meta();
    const loader = loaderVersion ?? meta.loader[0]?.version;
    const installer = meta.installer[0]?.version;
    if (!loader || !installer) {
      throw new VersionSourceError("Fabric loader/installer not found");
    }
    return `${FABRIC_META}/loader/${version}/${loader}/${installer}/server/jar`;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "minecher/0.1", Accept: "application/json" },
  });
  if (!res.ok) {
    throw new VersionSourceError(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}
