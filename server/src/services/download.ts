import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { AppConfig } from "../config.js";
import { subDir } from "../config.js";
import { getSource } from "../versions/index.js";
import type { ServerType } from "@minecher/types";
import { VersionSourceError } from "../versions/source.js";

export interface ResolvedJar {
  type: ServerType;
  mcVersion: string;
  loaderVersion?: string;
  url: string;
}

export class DownloadService {
  constructor(private config: AppConfig) {}

  private cacheDir(): string {
    return subDir(this.config, "versions");
  }

  cachePath(type: ServerType, mcVersion: string, loaderVersion?: string): string {
    const tag = loaderVersion ? `${mcVersion}-${loaderVersion}` : mcVersion;
    return path.join(this.cacheDir(), type, `${tag}.jar`);
  }

  async resolve(type: ServerType, mcVersion: string, loaderVersion?: string): Promise<ResolvedJar> {
    const url = await getSource(type).resolveJar(mcVersion, loaderVersion);
    return { type, mcVersion, loaderVersion, url };
  }

  async ensureJar(resolved: ResolvedJar): Promise<string> {
    const target = this.cachePath(
      resolved.type,
      resolved.mcVersion,
      resolved.loaderVersion,
    );
    if (fs.existsSync(target) && fs.statSync(target).size > 0) {
      return target;
    }
    await this.download(resolved.url, target);
    return target;
  }

  private async download(url: string, target: string): Promise<void> {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${crypto.randomUUID()}.tmp`;
    const res = await fetch(url, {
      headers: { "User-Agent": "minecher/0.1 (Minecraft server manager; Node.js; https://github.com/minecher/minecher)" },
    });
    if (!res.ok || !res.body) {
      throw new VersionSourceError(
        `Download ${url} -> ${res.status} ${res.statusText}`,
      );
    }
    try {
      await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
      fs.renameSync(tmp, target);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  }
}
