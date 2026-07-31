import { VersionSource, VersionSourceError } from "./source.js";
import type { ServerType } from "@minecher/types";

const FORGE_MAVEN = "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";

function parseVersions(xml: string): string[] {
  const body = /<version>([^<]+)<\/version>/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = body.exec(xml)) !== null) {
    out.push(match[1]);
  }
  return out;
}

export class ForgeSource implements VersionSource {
  type: ServerType = "forge";

  private async allVersions(): Promise<string[]> {
    const xml = await fetchText(FORGE_MAVEN);
    return parseVersions(xml);
  }

  async listVersions(): Promise<string[]> {
    const versions = await this.allVersions();
    const mcVersions = new Set<string>();
    for (const v of versions) {
      const mc = v.split("-")[0];
      if (mc) mcVersions.add(mc);
    }
    return [...mcVersions].sort((a, b) => compareVersions(a, b));
  }

  async listLoaderVersions(mcVersion: string): Promise<string[]> {
    const versions = await this.allVersions();
    return versions.filter((v) => v.startsWith(`${mcVersion}-`));
  }

  async resolveJar(version: string, loaderVersion?: string): Promise<string> {
    const full = loaderVersion
      ? loaderVersion
      : (await this.listLoaderVersions(version)).at(-1);
    if (!full) {
      throw new VersionSourceError(`No Forge builds for "${version}"`);
    }
    return `${FORGE_MAVEN.replace("maven-metadata.xml", "")}${full}/forge-${full}-installer.jar`;
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "minecher/0.1" },
  });
  if (!res.ok) {
    throw new VersionSourceError(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
