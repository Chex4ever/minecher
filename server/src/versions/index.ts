import type { ServerType } from "@minecher/types";
import { VersionSource } from "./source.js";
import { VanillaSource } from "./vanilla.js";
import { PaperSource } from "./paper.js";
import { SpigotSource } from "./spigot.js";
import { ForgeSource } from "./forge.js";
import { FabricSource } from "./fabric.js";
import { CustomSource } from "./custom.js";

const sources: Record<ServerType, VersionSource> = {
  vanilla: new VanillaSource(),
  paper: new PaperSource(),
  spigot: new SpigotSource(),
  forge: new ForgeSource(),
  fabric: new FabricSource(),
  custom: new CustomSource(),
};

export function getSource(type: ServerType): VersionSource {
  return sources[type];
}

export function listSourceTypes(): ServerType[] {
  return Object.keys(sources) as ServerType[];
}
