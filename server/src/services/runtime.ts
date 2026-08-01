import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { AppConfig } from "../config.js";
import { subDir } from "../config.js";

const execFileAsync = promisify(execFile);

const USER_AGENT =
  "minecher/0.1 (Minecraft server manager; Node.js; https://github.com/minecher/minecher)";

let inflight: Promise<string> | null = null;

function configuredFeature(): string {
  return process.env.MC_JAVA_VERSION ?? "25";
}

function markerPath(config: AppConfig): string {
  return path.join(config.dataDir, "runtime", ".feature");
}

function hasFeature(config: AppConfig, feature: string): boolean {
  try {
    return fs.readFileSync(markerPath(config), "utf8").trim() === feature;
  } catch {
    return false;
  }
}

export function bundledJavaPath(config: AppConfig): string | null {
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const java = path.join(subDir(config, "runtime", "jre"), "bin", exe);
  return fs.existsSync(java) ? java : null;
}

export function ensureBundledJava(config: AppConfig, log: (msg: string) => void): Promise<string> {
  const feature = configuredFeature();
  const existing = bundledJavaPath(config);
  if (existing && hasFeature(config, feature)) return Promise.resolve(existing);
  if (inflight) return inflight;
  inflight = install(config, log, feature).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function install(config: AppConfig, log: (msg: string) => void, feature: string): Promise<string> {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "aarch64" : process.arch === "ia32" ? "x86" : process.arch;
  const url = `https://api.adoptium.net/v3/binary/latest/${feature}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;

  const runtimeDir = subDir(config, "runtime");
  for (const entry of fs.readdirSync(runtimeDir)) {
    if (entry.startsWith(".tmp-")) {
      fs.rmSync(path.join(runtimeDir, entry), { recursive: true, force: true });
    }
  }
  const archive = path.join(runtimeDir, `jre-${feature}-${os}-${arch}.${os === "windows" ? "zip" : "tar.gz"}`);
  if (!fs.existsSync(archive) || fs.statSync(archive).size === 0) {
    log(`Downloading bundled Java runtime (Temurin ${feature})...`);
    await download(url, archive);
  }
  const tmp = path.join(runtimeDir, `.tmp-${crypto.randomUUID()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    log("Extracting Java runtime...");
    const jre = await extractWithRetry(archive, tmp, os, log);
    const target = path.join(runtimeDir, "jre");
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(jre, target);
    fs.writeFileSync(markerPath(config), feature);
    fs.rmSync(tmp, { recursive: true, force: true });
    const java = bundledJavaPath(config);
    if (!java) throw new Error("Failed to locate bundled java after extraction");
    return java;
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

function findJavaHome(dir: string, depth = 0): string | null {
  if (depth > 3) return null;
  const exe = process.platform === "win32" ? "java.exe" : "java";
  if (fs.existsSync(path.join(dir, "bin", exe))) return dir;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = findJavaHome(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

async function extractWithRetry(
  archive: string,
  dest: string,
  os: string,
  log: (msg: string) => void,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      if (os === "windows") {
        await execFileAsync("tar", ["-xf", archive, "-C", dest]);
      } else {
        await execFileAsync("tar", ["-xzf", archive, "-C", dest]);
      }
    } catch (err) {
      for (const entry of fs.readdirSync(dest)) {
        fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
      }
      if (attempt >= 3) throw err;
      log(`Java runtime extraction failed (attempt ${attempt}/3); retrying...`);
      continue;
    }
    const jre = findJavaHome(dest);
    if (jre) return jre;
    if (attempt >= 3) throw new Error("Java runtime archive did not contain bin/java");
    log("Java runtime extraction incomplete; retrying...");
  }
}

async function download(url: string, target: string): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok || !res.body) {
    throw new Error(`Download ${url} -> ${res.status} ${res.statusText}`);
  }
  try {
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
