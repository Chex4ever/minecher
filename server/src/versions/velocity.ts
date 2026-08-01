import { VersionSource, VersionSourceError, fetchJson } from "./source.js";
import type { ServerType } from "@minecher/types";

const BASE = "https://fill.papermc.io/v3/projects/velocity";

interface VelocityProject {
  versions: Record<string, string[]>;
}

interface VelocityBuild {
  id: string;
  channel: "STABLE" | "BETA" | "ALPHA" | "RECOMMENDED";
  downloads: Record<string, { name: string; url: string }>;
}

export class VelocitySource implements VersionSource {
  type: ServerType = "velocity";

  async listVersions(): Promise<string[]> {
    const project = await fetchJson<VelocityProject>(BASE);
    const all = Object.values(project.versions).flat();
    return all.filter((v) => !/SNAPSHOT/i.test(v)).sort((a, b) => compareSemver(b, a));
  }

  async listLoaderVersions(_mcVersion: string): Promise<string[]> {
    return [];
  }

  async resolveJar(version: string): Promise<string> {
    const builds = await fetchJson<VelocityBuild[]>(
      `${BASE}/versions/${encodeURIComponent(version)}/builds`,
    );
    const stable =
      builds.find((b) => b.channel === "RECOMMENDED") ??
      builds.find((b) => b.channel === "STABLE");
    if (!stable) {
      throw new VersionSourceError(
        `Velocity has no recommended build for version "${version}"`,
      );
    }
    const download = stable.downloads["server:default"];
    if (!download) {
      throw new VersionSourceError(`Velocity build ${stable.id} has no server jar`);
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
