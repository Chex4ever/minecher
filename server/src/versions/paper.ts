import { VersionSource, VersionSourceError, fetchJson } from "./source.js";
import type { ServerType } from "@minecher/types";

const BASE = "https://fill.papermc.io/v3/projects/paper";

interface PaperProject {
  versions: Record<string, string[]>;
}

interface PaperBuild {
  id: string;
  channel: "STABLE" | "BETA" | "ALPHA" | "RECOMMENDED";
  downloads: Record<string, { name: string; url: string }>;
}

export class PaperSource implements VersionSource {
  type: ServerType = "paper";

  async listVersions(): Promise<string[]> {
    const project = await fetchJson<PaperProject>(BASE);
    const all = Object.values(project.versions).flat();
    return all.sort((a, b) => compareSemver(b, a));
  }

  async listLoaderVersions(_mcVersion: string): Promise<string[]> {
    return [];
  }

  async resolveJar(version: string): Promise<string> {
    const builds = await fetchJson<PaperBuild[]>(
      `${BASE}/versions/${encodeURIComponent(version)}/builds`,
    );
    const stable = builds.find((b) => b.channel === "STABLE");
    if (!stable) {
      throw new VersionSourceError(
        `Paper has no stable build for version "${version}"`,
      );
    }
    const download = stable.downloads["server:default"] ?? stable.downloads["application"];
    if (!download) {
      throw new VersionSourceError(`Paper build ${stable.id} has no server jar`);
    }
    return download.url;
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
