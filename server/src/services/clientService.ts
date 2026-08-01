import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import AdmZip from "adm-zip";
import type { ClientBuildInfo, ClientLauncherType } from "@minecher/types";
import type { AppConfig } from "../config.js";
import { subDir } from "../config.js";
import type { Db } from "../db.js";
import { fetchJson } from "../versions/source.js";
import { ensureBundledJava } from "./runtime.js";
import type { ZipArchive } from "archiver";

const require = createRequire(import.meta.url);
const archiver = require("archiver") as { ZipArchive: typeof ZipArchive };

const UA =
  "minecher/0.1 (Minecraft server manager; Node.js; https://github.com/minecher/minecher)";
const MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const RESOURCES_URL = "https://resources.download.minecraft.net";
const FABRIC_META = "https://meta.fabricmc.net/v2/versions";
const FORGE_MAVEN = "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";

const MAX_CONCURRENT_DOWNLOADS = 6;
const MAX_KEEP_BUILDS = 10;
const NATIVES_COMBOS: { classifier: string; dir: string }[] = [
  { classifier: "natives-windows", dir: "windows" },
  { classifier: "natives-windows-arm64", dir: "windows-arm64" },
  { classifier: "natives-linux", dir: "linux" },
  { classifier: "natives-linux-arm64", dir: "linux-arm64" },
  { classifier: "natives-macos", dir: "macos" },
  { classifier: "natives-macos-arm64", dir: "macos-arm64" },
  { classifier: "natives-osx", dir: "macos" },
  { classifier: "natives-osx-arm64", dir: "macos-arm64" },
];

interface ManifestEntry {
  id: string;
  type: string;
  url: string;
}
interface VanillaManifest {
  latest: { release: string; snapshot: string };
  versions: ManifestEntry[];
}

interface LibraryDownload {
  path: string;
  url: string;
}
interface Library {
  name?: string;
  url?: string;
  downloads?: { artifact?: LibraryDownload; classifiers?: Record<string, LibraryDownload> };
}
interface ArgRule {
  action: "allow" | "disallow";
  os?: { name?: string; arch?: string };
}
type ArgEntry = string | { rules?: ArgRule[]; value: string | string[] };
interface VersionJson {
  id: string;
  inheritsFrom?: string;
  mainClass: string;
  downloads?: { client?: { url: string } };
  assetIndex?: { id: string; url: string };
  libraries: Library[];
  arguments?: { game?: ArgEntry[]; jvm?: ArgEntry[] };
  minecraftArguments?: string;
  javaVersion?: { majorVersion?: number };
}

interface AssetIndexJson {
  objects: Record<string, { hash: string; size: number }>;
}

interface BuildRow {
  id: string;
  launcher_type: string;
  mc_version: string;
  loader_version: string | null;
  username: string;
  status: string;
  progress: number;
  message: string;
  size_bytes: number | null;
  zip_path: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface Assembled {
  versionId: string;
  mainClass: string;
  jvmArgs: string[];
  gameArgs: string[];
  assetIndexId: string;
  clientJarName: string;
  javaVersion: number | null;
}

interface BuildContext {
  build: ClientBuildInfo;
  scratch: string;
  libsDir: string;
  cacheLibs: string;
  assetsCache: string;
}

interface ServerAddress {
  name: string;
  host: string;
  port: number;
  onlineMode: boolean;
}

export interface CreateBuildInput {
  launcherType: ClientLauncherType;
  mcVersion: string;
  loaderVersion?: string;
  username: string;
}

function rowToBuild(row: BuildRow): ClientBuildInfo {
  return {
    id: row.id,
    launcherType: row.launcher_type as ClientLauncherType,
    mcVersion: row.mc_version,
    loaderVersion: row.loader_version,
    username: row.username,
    status: row.status as ClientBuildInfo["status"],
    progress: row.progress,
    message: row.message,
    sizeBytes: row.size_bytes,
    zipPath: row.zip_path,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function offlineUuid(name: string): string {
  const digest = crypto.createHash("md5").update(`OfflinePlayer:${name}`).digest();
  digest[6] = (digest[6] & 0x0f) | 0x30;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sanitizeName(value: string, fallback = "player"): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function validateUsername(username: string): void {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
    throw new Error("Username must be 1-16 characters of A-Z, a-z, 0-9 or _");
  }
}

function mavenPath(name: string): string {
  const parts = name.split(":");
  const group = parts[0] ?? "";
  const artifact = parts[1] ?? "";
  const version = parts[2] ?? "";
  const classifier = parts.length > 3 ? `-${parts.slice(3).join(":")}` : "";
  return `${group.split(".").join("/")}/${artifact}/${version}/${artifact}-${version}${classifier}.jar`;
}

function lanHost(): string {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const net of entries ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

async function mapPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    runners.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift() as T;
          await worker(item);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

async function ensureDownloaded(url: string, target: string): Promise<void> {
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA } });
  } catch (err) {
    throw new Error(`Download ${url} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok || !res.body) {
    throw new Error(`Download ${url} -> ${res.status} ${res.statusText}`);
  }
  try {
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    if (err instanceof Error && /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED/.test(err.message)) {
      fs.rmSync(target, { force: true });
      throw new Error(`Download ${url} interrupted: ${err.message}`);
    }
    throw err;
  }
}

async function getVanillaVersionJson(mcVersion: string): Promise<VersionJson> {
  const manifest = await fetchJson<VanillaManifest>(MANIFEST_URL);
  const entry = manifest.versions.find((v) => v.id === mcVersion);
  if (!entry) throw new Error(`Vanilla version "${mcVersion}" not found`);
  return fetchJson<VersionJson>(entry.url);
}

function substitute(args: ArgEntry[], map: Record<string, string>): string[] {
  const out: string[] = [];
  for (const arg of args) {
    if (typeof arg === "string") {
      out.push(arg);
      continue;
    }
    if (arg.rules && arg.rules.length > 0) continue;
    if (Array.isArray(arg.value)) out.push(...arg.value);
    else out.push(arg.value);
  }
  return out.map((arg) => {
    let result = arg;
    for (const [key, value] of Object.entries(map)) {
      result = result.split(key).join(value);
    }
    return result;
  });
}

function resolveLaunchArgs(
  versionJson: VersionJson,
  ctx: { username: string; uuid: string; versionId: string; assetIndexId: string },
): { jvm: string[]; game: string[] } {
  const map: Record<string, string> = {
    "${auth_player_name}": ctx.username,
    "${version_name}": ctx.versionId,
    "${game_directory}": ".",
    "${assets_root}": "assets",
    "${assets_index_name}": ctx.assetIndexId,
    "${auth_uuid}": ctx.uuid,
    "${auth_access_token}": "0",
    "${auth_session}": "0",
    "${clientid}": "",
    "${auth_xuid}": "",
    "${user_properties}": "{}",
    "${user_type}": "legacy",
    "${version_type}": "release",
    "${resolution_width}": "854",
    "${resolution_height}": "480",
    "${launcher_name}": "minecher",
    "${launcher_version}": "0.1",
    "${library_directory}": "libraries",
    "${root_directory}": ".",
    "${natives_directory}": "natives",
  };
  const jvm = substitute(versionJson.arguments?.jvm ?? [], map)
    .filter((arg) => arg !== "${classpath}" && arg !== "-cp" && arg !== "--classpath")
    .filter((arg) => !arg.startsWith("-Djava.library.path="));
  let game: string[];
  if (versionJson.arguments?.game) {
    game = substitute(versionJson.arguments.game, map);
  } else if (versionJson.minecraftArguments) {
    game = versionJson.minecraftArguments
      .split(" ")
      .map((arg) => {
        let result = arg;
        for (const [key, value] of Object.entries(map)) result = result.split(key).join(value);
        return result;
      });
  } else {
    game = [];
  }
  return { jvm, game };
}

function quoteShell(arg: string): string {
  return arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function quoteBat(arg: string): string {
  return arg.includes(" ") ? `"${arg.replace(/"/g, '""')}"` : arg;
}

export class ClientService {
  private queue: string[] = [];
  private runningId: string | null = null;
  private memory = new Map<string, ClientBuildInfo>();
  private cacheLibsDir: string;
  private assetsCacheDir: string;

  constructor(private config: AppConfig, private db: Db) {
    this.cacheLibsDir = subDir(this.config, "clients", "cache", "libraries");
    this.assetsCacheDir = subDir(this.config, "clients", "assets");
    this.cleanupBoot();
  }

  listBuilds(): ClientBuildInfo[] {
    const rows = this.db.prepare("SELECT * FROM client_builds ORDER BY created_at DESC").all() as BuildRow[];
    return rows.map(rowToBuild);
  }

  getBuild(id: string): ClientBuildInfo | null {
    if (this.memory.has(id)) return this.memory.get(id) ?? null;
    const row = this.db.prepare("SELECT * FROM client_builds WHERE id=?").get(id) as BuildRow | undefined;
    return row ? rowToBuild(row) : null;
  }

  zipPath(id: string): string | null {
    return this.getBuild(id)?.zipPath ?? null;
  }

  async listVersions(type: ClientLauncherType): Promise<string[]> {
    switch (type) {
      case "vanilla": {
        const manifest = await fetchJson<VanillaManifest>(MANIFEST_URL);
        return manifest.versions.filter((v) => v.type === "release").map((v) => v.id);
      }
      case "fabric": {
        const meta = await fetchJson<{ game: { version: string; stable: boolean }[] }>(FABRIC_META);
        return meta.game.filter((g) => g.stable).map((g) => g.version).reverse();
      }
      case "forge": {
        const xml = await fetchForgeXml();
        return [...new Set(parseForgeXml(xml).map((v) => v.split("-")[0]).filter(Boolean))].sort(compareVersions);
      }
      default:
        return [];
    }
  }

  async listLoaders(type: ClientLauncherType, mcVersion: string): Promise<string[]> {
    if (type === "fabric") {
      const meta = await fetchJson<{ loader: { version: string }[] }>(FABRIC_META);
      return meta.loader.map((l) => l.version);
    }
    if (type === "forge") {
      const xml = await fetchForgeXml();
      return parseForgeXml(xml).filter((v) => v.startsWith(`${mcVersion}-`));
    }
    return [];
  }

  createBuild(input: CreateBuildInput): ClientBuildInfo {
    validateUsername(input.username);
    const now = new Date().toISOString();
    const row: BuildRow = {
      id: crypto.randomUUID(),
      launcher_type: input.launcherType,
      mc_version: input.mcVersion,
      loader_version: input.loaderVersion ?? null,
      username: input.username,
      status: "queued",
      progress: 0,
      message: "Queued",
      size_bytes: null,
      zip_path: null,
      error: null,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO client_builds (id, launcher_type, mc_version, loader_version, username, status, progress, message, size_bytes, zip_path, error, created_at, updated_at)
         VALUES (@id, @launcher_type, @mc_version, @loader_version, @username, @status, @progress, @message, @size_bytes, @zip_path, @error, @created_at, @updated_at)`,
      )
      .run(row);
    const info = rowToBuild(row);
    this.memory.set(info.id, info);
    this.cleanupOld();
    this.queue.push(info.id);
    void this.pump();
    return info;
  }

  deleteBuild(id: string): boolean {
    const build = this.getBuild(id);
    if (!build) return false;
    this.memory.delete(id);
    this.queue = this.queue.filter((q) => q !== id);
    if (build.zipPath) fs.rmSync(build.zipPath, { force: true });
    fs.rmSync(subDir(this.config, "clients", "build", id), { recursive: true, force: true });
    this.db.prepare("DELETE FROM client_builds WHERE id=?").run(id);
    return true;
  }

  private update(id: string, patch: Partial<ClientBuildInfo>): void {
    const info = this.getBuild(id);
    if (!info) return;
    const next: ClientBuildInfo = { ...info, ...patch, updatedAt: new Date().toISOString() };
    this.memory.set(id, next);
    this.db
      .prepare(
        "UPDATE client_builds SET status=?, progress=?, message=?, size_bytes=?, zip_path=?, error=?, updated_at=? WHERE id=?",
      )
      .run(
        next.status,
        next.progress,
        next.message,
        next.sizeBytes,
        next.zipPath,
        next.error,
        next.updatedAt,
        id,
      );
  }

  private async pump(): Promise<void> {
    if (this.runningId) return;
    const id = this.queue.shift();
    if (!id) return;
    this.runningId = id;
    try {
      await this.runBuild(id);
    } finally {
      this.runningId = null;
      void this.pump();
    }
  }

  private cleanupBoot(): void {
    const buildRoot = subDir(this.config, "clients", "build");
    for (const entry of fs.readdirSync(buildRoot)) {
      fs.rmSync(path.join(buildRoot, entry), { recursive: true, force: true });
    }
    const stale = this.db
      .prepare("SELECT * FROM client_builds WHERE status IN ('queued','building')")
      .all() as BuildRow[];
    for (const row of stale) {
      this.db
        .prepare("UPDATE client_builds SET status='error', error=?, progress=0, updated_at=? WHERE id=?")
        .run("Build interrupted by daemon restart", new Date().toISOString(), row.id);
    }
    this.cleanupOld();
  }

  private cleanupOld(): void {
    const rows = this.db
      .prepare("SELECT * FROM client_builds WHERE status='done' ORDER BY created_at DESC")
      .all() as BuildRow[];
    for (const row of rows.slice(MAX_KEEP_BUILDS)) {
      if (row.zip_path) fs.rmSync(row.zip_path, { force: true });
      this.db.prepare("DELETE FROM client_builds WHERE id=?").run(row.id);
    }
  }

  private async runBuild(id: string): Promise<void> {
    const build = this.getBuild(id);
    if (!build) return;
    const scratch = subDir(this.config, "clients", "build", id);
    const ctx: BuildContext = {
      build,
      scratch,
      libsDir: path.join(scratch, "libraries"),
      cacheLibs: this.cacheLibsDir,
      assetsCache: this.assetsCacheDir,
    };
    try {
      this.update(id, { status: "building", progress: 0.02, message: "Starting build", error: null });
      let assembled: Assembled;
      if (build.launcherType === "vanilla") {
        assembled = await this.assembleVanilla(ctx);
      } else if (build.launcherType === "fabric") {
        assembled = await this.assembleFabric(ctx);
      } else {
        assembled = await this.assembleForge(ctx);
      }
      this.update(id, { progress: 0.94, message: "Extracting natives" });
      await this.extractNatives(ctx.libsDir, path.join(scratch, "natives"));
      this.update(id, { progress: 0.95, message: "Finalizing bundle" });
      await this.writeLauncherJson(ctx, assembled);
      await this.writeScripts(ctx, assembled);
      await this.zipBuild(ctx, assembled);
      fs.rmSync(scratch, { recursive: true, force: true });
      this.update(id, { status: "done", progress: 1, message: "Done" });
    } catch (err) {
      this.update(id, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        message: "Build failed",
      });
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  private async assembleVanilla(ctx: BuildContext): Promise<Assembled> {
    const { build } = ctx;
    this.update(ctx.build.id, { progress: 0.03, message: "Fetching version metadata" });
    const versionJson = await getVanillaVersionJson(build.mcVersion);
    const assetIndex = versionJson.assetIndex;
    if (!assetIndex) throw new Error(`Version "${build.mcVersion}" has no asset index`);
    if (!versionJson.downloads?.client?.url) throw new Error(`Version "${build.mcVersion}" has no client jar`);

    const clientJarName = `${build.mcVersion}.jar`;
    const jarTarget = this.clientJarCache(clientJarName);
    this.update(ctx.build.id, { progress: 0.08, message: "Downloading client jar" });
    await ensureDownloaded(versionJson.downloads.client.url, jarTarget);
    fs.copyFileSync(jarTarget, path.join(ctx.scratch, clientJarName));

    await this.downloadLibraries(ctx, versionJson, 0.12, 0.5);
    await this.downloadAssets(ctx, assetIndex, 0.5, 0.9);

    const args = resolveLaunchArgs(versionJson, {
      username: build.username,
      uuid: offlineUuid(build.username),
      versionId: build.mcVersion,
      assetIndexId: assetIndex.id,
    });
    return {
      versionId: build.mcVersion,
      mainClass: versionJson.mainClass,
      jvmArgs: args.jvm,
      gameArgs: args.game,
      assetIndexId: assetIndex.id,
      clientJarName,
      javaVersion: versionJson.javaVersion?.majorVersion ?? null,
    };
  }

  private async assembleFabric(ctx: BuildContext): Promise<Assembled> {
    const { build } = ctx;
    this.update(ctx.build.id, { progress: 0.03, message: "Fetching Fabric metadata" });
    const loader = build.loaderVersion || (await this.listLoaders("fabric", build.mcVersion)).at(-1);
    if (!loader) throw new Error("No Fabric loader found");
    const profile = await fetchJson<VersionJson>(
      `${FABRIC_META}/loader/${build.mcVersion}/${loader}/profile/json`,
    );
    const vanillaJson = await getVanillaVersionJson(build.mcVersion);
    const assetIndex = vanillaJson.assetIndex;
    if (!assetIndex) throw new Error(`Vanilla "${build.mcVersion}" has no asset index`);
    if (!vanillaJson.downloads?.client?.url) throw new Error(`Vanilla "${build.mcVersion}" has no client jar`);

    const versionId = profile.id || `fabric-loader-${loader}-${build.mcVersion}`;
    const clientJarName = `${build.mcVersion}.jar`;
    const jarTarget = this.clientJarCache(clientJarName);
    this.update(ctx.build.id, { progress: 0.08, message: "Downloading client jar" });
    await ensureDownloaded(vanillaJson.downloads.client.url, jarTarget);
    fs.copyFileSync(jarTarget, path.join(ctx.scratch, clientJarName));

    this.update(ctx.build.id, { progress: 0.1, message: "Downloading Fabric libraries" });
    await this.downloadLibraries(ctx, profile, 0.1, 0.35);
    this.update(ctx.build.id, { progress: 0.36, message: "Downloading vanilla libraries" });
    await this.downloadLibraries(ctx, vanillaJson, 0.36, 0.5);
    await this.downloadAssets(ctx, assetIndex, 0.5, 0.9);

    const args = resolveLaunchArgs(vanillaJson, {
      username: build.username,
      uuid: offlineUuid(build.username),
      versionId,
      assetIndexId: assetIndex.id,
    });
    return {
      versionId,
      mainClass: profile.mainClass || vanillaJson.mainClass,
      jvmArgs: args.jvm,
      gameArgs: args.game,
      assetIndexId: assetIndex.id,
      clientJarName,
      javaVersion: vanillaJson.javaVersion?.majorVersion ?? null,
    };
  }

  private async assembleForge(ctx: BuildContext): Promise<Assembled> {
    const { build } = ctx;
    this.update(ctx.build.id, { progress: 0.03, message: "Fetching Forge metadata" });
    const loader = build.loaderVersion || (await this.listLoaders("forge", build.mcVersion)).at(-1);
    if (!loader) throw new Error("No Forge build found for this Minecraft version");

    const installDir = path.join(ctx.scratch, "forge-install");
    const installerPath = path.join(this.cacheLibsDir, `net/minecraftforge/forge/${loader}/forge-${loader}-installer.jar`);
    this.update(ctx.build.id, { progress: 0.05, message: "Downloading Forge installer" });
    await ensureDownloaded(
      `${FORGE_MAVEN.replace("maven-metadata.xml", "")}${loader}/forge-${loader}-installer.jar`,
      installerPath,
    );

    const vanillaJson = await getVanillaVersionJson(build.mcVersion);
    if (!vanillaJson.downloads?.client?.url) throw new Error(`Vanilla "${build.mcVersion}" has no client jar`);

    const baseJarName = `${build.mcVersion}.jar`;
    const baseJarTarget = this.clientJarCache(baseJarName);
    this.update(ctx.build.id, { progress: 0.08, message: "Preparing vanilla base for installer" });
    await ensureDownloaded(vanillaJson.downloads.client.url, baseJarTarget);
    const baseVersionDir = path.join(installDir, "versions", build.mcVersion);
    fs.mkdirSync(baseVersionDir, { recursive: true });
    fs.copyFileSync(baseJarTarget, path.join(baseVersionDir, baseJarName));
    fs.writeFileSync(path.join(baseVersionDir, `${build.mcVersion}.json`), JSON.stringify(vanillaJson));

    const forgeVersionId = `${build.mcVersion}-forge-${loader.replace(`${build.mcVersion}-`, "")}`;
    fs.writeFileSync(
      path.join(installDir, "launcher_profiles.json"),
      JSON.stringify({
        profiles: { forge: { name: "forge", type: "custom", lastVersionId: forgeVersionId } },
      }),
    );

    this.update(ctx.build.id, { progress: 0.12, message: "Running Forge installer (--installClient)" });
    await this.runForgeInstaller(installerPath, installDir);

    const versionsDir = path.join(installDir, "versions");
    const versionDir = fs
      .readdirSync(versionsDir)
      .filter((n) => n !== build.mcVersion)
      .map((n) => path.join(versionsDir, n))
      .find((p) => fs.statSync(p).isDirectory());
    if (!versionDir) throw new Error("Forge installer did not produce a client version profile");
    const versionId = path.basename(versionDir);
    const versionJson = JSON.parse(fs.readFileSync(path.join(versionDir, `${versionId}.json`), "utf8")) as VersionJson;

    const clientJarName = `versions/${build.mcVersion}/${build.mcVersion}.jar`;
    const versionProfileDir = path.join(ctx.scratch, "versions", versionId);
    fs.mkdirSync(path.join(ctx.scratch, "versions", build.mcVersion), { recursive: true });
    fs.mkdirSync(versionProfileDir, { recursive: true });
    fs.copyFileSync(baseJarTarget, path.join(ctx.scratch, clientJarName));
    fs.writeFileSync(path.join(versionProfileDir, `${versionId}.json`), JSON.stringify(versionJson));
    const generatedJar = path.join(versionDir, `${versionId}.jar`);
    if (fs.existsSync(generatedJar)) {
      fs.copyFileSync(generatedJar, path.join(versionProfileDir, `${versionId}.jar`));
    }

    const generatedLibs = path.join(installDir, "libraries");
    if (fs.existsSync(generatedLibs)) {
      fs.cpSync(generatedLibs, ctx.libsDir, { recursive: true });
    }
    this.update(ctx.build.id, { progress: 0.45, message: "Downloading vanilla libraries" });
    await this.downloadLibraries(ctx, vanillaJson, 0.45, 0.6);

    const assetIndex = vanillaJson.assetIndex ?? versionJson.assetIndex;
    if (!assetIndex) throw new Error("No asset index found for Forge client");
    await this.downloadAssets(ctx, assetIndex, 0.6, 0.9);
    fs.rmSync(installDir, { recursive: true, force: true });

    const args = resolveLaunchArgs(versionJson, {
      username: build.username,
      uuid: offlineUuid(build.username),
      versionId,
      assetIndexId: assetIndex.id,
    });
    return {
      versionId,
      mainClass: versionJson.mainClass,
      jvmArgs: args.jvm,
      gameArgs: args.game,
      assetIndexId: assetIndex.id,
      clientJarName,
      javaVersion: vanillaJson.javaVersion?.majorVersion ?? null,
    };
  }

  private clientJarCache(name: string): string {
    return path.join(subDir(this.config, "clients", "cache", "jars", "vanilla"), name);
  }

  private async runForgeInstaller(installerPath: string, installDir: string): Promise<void> {
    const java = await ensureBundledJava(this.config, () => {});
    const proc = spawn(java, ["-jar", installerPath, "--installClient", installDir], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => {
      out = (out + d.toString()).slice(-2_000_000);
    });
    proc.stderr?.on("data", () => undefined);
    const code = await new Promise<number | null>((resolve) => proc.on("exit", (c) => resolve(c)));
    if (code !== 0) {
      const tail = out.trim().split("\n").slice(-5).join("\n");
      throw new Error(`Forge installer exited with code ${code}: ${tail}`);
    }
  }

  private async downloadLibraries(ctx: BuildContext, versionJson: VersionJson, start: number, end: number): Promise<void> {
    const { build } = ctx;
    const total = versionJson.libraries.length;
    let done = 0;
    await mapPool(versionJson.libraries, MAX_CONCURRENT_DOWNLOADS, async (lib) => {
      const downloads = lib.downloads?.artifact
        ? [lib.downloads.artifact]
        : lib.name && lib.url
          ? [{ path: mavenPath(lib.name), url: `${lib.url}${mavenPath(lib.name)}` }]
          : [];
      const classifiers = lib.downloads?.classifiers ? Object.entries(lib.downloads.classifiers) : [];
      for (const dl of downloads) {
        const target = path.join(ctx.cacheLibs, dl.path);
        await ensureDownloaded(dl.url, target);
        fs.mkdirSync(path.dirname(path.join(ctx.libsDir, dl.path)), { recursive: true });
        fs.copyFileSync(target, path.join(ctx.libsDir, dl.path));
      }
      for (const [name, dl] of classifiers) {
        if (!NATIVES_COMBOS.some((c) => c.classifier === name)) continue;
        const target = path.join(ctx.cacheLibs, dl.path);
        await ensureDownloaded(dl.url, target);
        fs.mkdirSync(path.dirname(path.join(ctx.libsDir, dl.path)), { recursive: true });
        fs.copyFileSync(target, path.join(ctx.libsDir, dl.path));
      }
      done += 1;
      if (done % 5 === 0 || done === total) {
        const p = start + (end - start) * (done / Math.max(1, total));
        this.update(build.id, { progress: p, message: `Downloading libraries ${done}/${total}` });
      }
    });
  }

  private async downloadAssets(ctx: BuildContext, assetIndex: { id: string; url: string }, start: number, end: number): Promise<void> {
    const { build } = ctx;
    const indexJson = await fetchJson<AssetIndexJson>(assetIndex.url);
    fs.mkdirSync(path.join(ctx.scratch, "assets", "indexes"), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.scratch, "assets", "indexes", `${assetIndex.id}.json`),
      JSON.stringify(indexJson, null, 2),
    );
    const entries = Object.entries(indexJson.objects);
    const total = entries.length;
    this.update(build.id, { message: `Downloading assets 0/${total}` });
    let done = 0;
    let lastUpdate = Date.now();
    await mapPool(entries, MAX_CONCURRENT_DOWNLOADS, async ([_key, obj]) => {
      const target = path.join(ctx.assetsCache, "objects", obj.hash.slice(0, 2), obj.hash);
      await ensureDownloaded(`${RESOURCES_URL}/${obj.hash.slice(0, 2)}/${obj.hash}`, target);
      done += 1;
      const now = Date.now();
      if (done === total || now - lastUpdate > 250) {
        lastUpdate = now;
        const p = start + (end - start) * (done / Math.max(1, total));
        this.update(build.id, { progress: p, message: `Downloading assets ${done}/${total}` });
      }
    });
    this.update(build.id, { progress: end, message: `Downloaded ${total} assets` });
  }

  private extractNatives(libsDir: string, nativesDir: string): void {
    const jars: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.includes("-natives-") && entry.name.endsWith(".jar")) jars.push(p);
      }
    };
    if (!fs.existsSync(libsDir)) return;
    walk(libsDir);
    for (const jar of jars) {
      const match = jar.match(/-natives-([a-z]+(?:-[a-z0-9]+)?)\.jar$/i);
      const combo = match ? NATIVES_COMBOS.find((c) => c.classifier === `natives-${match[1].toLowerCase()}`) : undefined;
      if (!combo) continue;
      const target = path.join(nativesDir, combo.dir);
      fs.mkdirSync(target, { recursive: true });
      for (const entry of new AdmZip(jar).getEntries()) {
        if (entry.isDirectory) continue;
        if (entry.entryName.includes("META-INF")) continue;
        const out = path.join(target, path.basename(entry.entryName));
        if (!fs.existsSync(out)) fs.writeFileSync(out, entry.getData());
      }
    }
  }

  private serverAddresses(): ServerAddress[] {
    const rows = this.db
      .prepare("SELECT name, type, port, server_props FROM servers ORDER BY created_at ASC")
      .all() as { name: string; type: string; port: number; server_props: string }[];
    const host = lanHost();
    return rows
      .filter((s) => s.type !== "velocity")
      .map((s) => {
        let onlineMode = true;
        try {
          const props = JSON.parse(s.server_props) as Record<string, string>;
          onlineMode = (props["online-mode"] ?? "true") !== "false";
        } catch {
          onlineMode = true;
        }
        return { name: s.name, host, port: s.port, onlineMode };
      });
  }

  private async writeLauncherJson(ctx: BuildContext, assembled: Assembled): Promise<void> {
    const { build } = ctx;
    const launcher = {
      launcher: "minecher",
      launcherVersion: "0.1",
      client: {
        type: build.launcherType,
        mcVersion: build.mcVersion,
        loader: build.loaderVersion,
        versionId: assembled.versionId,
        assetIndex: assembled.assetIndexId,
        mainClass: assembled.mainClass,
      },
      account: { username: build.username, uuid: offlineUuid(build.username), offline: true },
      servers: this.serverAddresses(),
    };
    fs.writeFileSync(path.join(ctx.scratch, "launcher.json"), JSON.stringify(launcher, null, 2));
  }

  private writeScripts(ctx: BuildContext, assembled: Assembled): void {
    const { build } = ctx;
    const game = assembled.gameArgs.map((a) => quoteShell(a)).join(" ");
    const gameBat = assembled.gameArgs.map((a) => quoteBat(a)).join(" ");

    const libraryJars: string[] = [];
    const walkLibs = (dir: string, prefix: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = `${prefix}${entry.name}`;
        if (entry.isDirectory()) walkLibs(path.join(dir, entry.name), `${rel}/`);
        else if (entry.name.endsWith(".jar")) libraryJars.push(rel);
      }
    };
    walkLibs(path.join(ctx.scratch, "libraries"), "libraries/");

    const argFor = (sep: string): string[] => {
      const cp = [assembled.clientJarName, ...libraryJars].join(sep);
      return [...assembled.jvmArgs.map((a) => a.replaceAll("${classpath_separator}", sep)), "-cp", cp];
    };
    const windowsArgs = argFor(";").map((a) => (a.includes(" ") ? `"${a.replace(/"/g, '\\"')}"` : a)).join("\n");
    const unixArgs = argFor(":").map((a) => (a.includes(" ") ? `"${a.replace(/"/g, '\\"')}"` : a)).join("\n");
    fs.writeFileSync(path.join(ctx.scratch, "launch-windows.args"), windowsArgs);
    fs.writeFileSync(path.join(ctx.scratch, "launch-unix.args"), unixArgs);

    const serverLines = this.serverAddresses()
      .map((s) => `       - ${s.name}: ${s.host}:${s.port}${s.onlineMode ? "" : " (offline mode)"}`)
      .join("\n");

    const bat = `@echo off\r\ncd /d "%~dp0"\r\nset "NATIVES=natives\\windows"\r\nif "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NATIVES=natives\\windows-arm64"\r\njava -Djava.library.path="%NATIVES%" @launch-windows.args ${assembled.mainClass} ${gameBat}\r\nif errorlevel 1 pause\r\n`;
    const sh = `#!/bin/sh\ncd "$(dirname "$0")"\nOS=$(uname -s)\nMACH=$(uname -m)\nif [ "$OS" = "Darwin" ]; then\n  NATIVES=natives/macos\n  case "$MACH" in\n    arm64|aarch64) NATIVES=natives/macos-arm64;;\n  esac\nelse\n  NATIVES=natives/linux\n  case "$MACH" in\n    arm64|aarch64) NATIVES=natives/linux-arm64;;\n  esac\nfi\nexec java -Djava.library.path="$NATIVES" @launch-unix.args ${assembled.mainClass} ${game}\n`;
    fs.writeFileSync(path.join(ctx.scratch, "start.bat"), bat);
    fs.writeFileSync(path.join(ctx.scratch, "start.sh"), sh);

    const servers = this.serverAddresses();
    const serverText =
      servers.length > 0
        ? `Server addresses (see also launcher.json):\n${serverLines}`
        : "No servers are configured yet — create one in the Minecher dashboard.";

    const note = `Minecher client bundle - ${build.launcherType} ${build.mcVersion}${build.loaderVersion ? ` (${build.loaderVersion})` : ""}

Account: username="${build.username}" (offline mode, uuid ${offlineUuid(build.username)})

How to launch:
  PC (Windows): run start.bat (requires Java ${assembled.javaVersion ?? "17+"}).
  PC (Linux/macOS): chmod +x start.sh && ./start.sh
  Android (PojavLauncher):
    1. Install PojavLauncher (Play Store or https://pojavlauncherteam.github.io).
    2. Copy this folder into the device storage, e.g.
       Android/data/net.kdt.pojavlaunch/files/.minecraft/
    3. Open PojavLauncher and launch this version (it uses its own Java
       runtime and natives, so the bundled start scripts are not used on Android).
    4. Set account type "offline" with the username above.
    5. Multiplayer: connect to the address below.

${serverText}

The client connects in offline mode. Servers must run with online-mode=false,
otherwise the connection will be rejected.
`;
    fs.writeFileSync(path.join(ctx.scratch, "README.txt"), note);
  }

  private async zipBuild(ctx: BuildContext, _assembled: Assembled): Promise<void> {
    const { build } = ctx;
    const tag = build.loaderVersion ? `${build.mcVersion}-${build.loaderVersion}` : build.mcVersion;
    const zipPath = path.join(
      subDir(this.config, "clients"),
      `${build.launcherType}-${sanitizeName(tag, "client")}-${sanitizeName(build.username, "player")}-${build.id.slice(0, 8)}.zip`,
    );
    fs.rmSync(zipPath, { force: true });
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = new archiver.ZipArchive({ zlib: { level: 0 } });
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      archive.glob("**/*", { cwd: ctx.scratch, dot: true });
      archive.glob("objects/**/*", { cwd: this.assetsCacheDir }, { prefix: "assets" });
      void archive.finalize();
    });
    const size = fs.statSync(zipPath).size;
    this.update(build.id, { progress: 0.99, message: "Bundle created", sizeBytes: size, zipPath });
  }
}

async function fetchForgeXml(): Promise<string> {
  const res = await fetch(FORGE_MAVEN, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${FORGE_MAVEN} -> ${res.status}`);
  return res.text();
}

function parseForgeXml(xml: string): string[] {
  const out: string[] = [];
  const re = /<version>([^<]+)<\/version>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) out.push(match[1]);
  return out;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
