import { VersionSource, VersionSourceError, fetchJson } from "./source.js";
import type { ServerType } from "@minecher/types";

interface GetBukkitProject {
  name: string;
}

export class SpigotSource implements VersionSource {
  type: ServerType = "spigot";

  async listVersions(): Promise<string[]> {
    const project = await fetchJson<GetBukkitProject>(
      "https://api.getbukkit.org/v2/projects/spigot",
    );
    const versions = await fetchJson<{ versions: string[] }>(
      `https://api.getbukkit.org/v2/projects/${project.name}`,
    );
    return versions.versions;
  }

  async listLoaderVersions(_mcVersion: string): Promise<string[]> {
    return [];
  }

  async resolveJar(version: string): Promise<string> {
    return `https://download.getbukkit.org/spigot/spigot-${version}.jar`;
  }
}
