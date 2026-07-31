import { VersionSource, VersionSourceError, fetchJson } from "./source.js";
import type { ServerType } from "@minecher/types";

interface VanillaManifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string; url: string }[];
}

interface VanillaVersion {
  downloads: { server: { url: string } };
}

export class VanillaSource implements VersionSource {
  type: ServerType = "vanilla";

  async listVersions(): Promise<string[]> {
    const manifest = await fetchJson<VanillaManifest>(
      "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    );
    return manifest.versions
      .filter((v) => v.type === "release")
      .map((v) => v.id);
  }

  async listLoaderVersions(_mcVersion: string): Promise<string[]> {
    return [];
  }

  async resolveJar(version: string): Promise<string> {
    const manifest = await fetchJson<VanillaManifest>(
      "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    );
    const entry = manifest.versions.find((v) => v.id === version);
    if (!entry) {
      throw new VersionSourceError(`Vanilla version "${version}" not found`);
    }
    const detail = await fetchJson<VanillaVersion>(entry.url);
    return detail.downloads.server.url;
  }
}
