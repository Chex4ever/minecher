import type { ServerType } from "@minecher/types";
import type { VersionSource } from "./source.js";
import { VersionSourceError } from "./source.js";

export class CustomSource implements VersionSource {
  readonly type: ServerType = "custom";

  async listVersions(): Promise<string[]> {
    return [];
  }

  async listLoaderVersions(_mcVersion: string): Promise<string[]> {
    return [];
  }

  async resolveJar(): Promise<string> {
    throw new VersionSourceError("custom servers have no downloadable jar");
  }
}
