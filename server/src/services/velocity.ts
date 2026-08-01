import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface VelocityBackend {
  name: string;
  address: string;
}

export function sanitizeVelocityName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 32);
  return clean || "server";
}

export function renderVelocityToml(opts: {
  port: number;
  motd: string;
  backends: VelocityBackend[];
}): string {
  const servers = opts.backends.map((b) => `${b.name} = "${b.address}"`).join("\n");
  const tryList =
    opts.backends.length > 0
      ? opts.backends.map((b) => `"${b.name}"`).join(",\n    ")
      : "";
  const cleanMotd = opts.motd.replace(/[<>]/g, "");
  return `config-version = "2.8"
bind = "0.0.0.0:${opts.port}"
motd = "<green>${cleanMotd}"
online-mode = false
force-key-authentication = false
prevent-client-proxy-connections = false
player-info-forwarding-mode = "modern"
forwarding-secret-file = "forwarding.secret"
announce-forge = true
kick-existing-players = false
ping-passthrough = "DISABLED"
enable-player-address-logging = true

[servers]
${servers}
try = [
    ${tryList}
]

[forced-hosts]

[query]
enabled = false
port = ${opts.port}
map = "Minecher"
show-plugins = false
`;
}

export function ensureVelocitySecret(dir: string): string {
  const file = path.join(dir, "forwarding.secret");
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, secret);
  return secret;
}

export function patchVelocityBackend(dir: string, secret: string): void {
  const global = path.join(dir, "config", "paper-global.yml");
  const paper = path.join(dir, "paper.yml");
  if (fs.existsSync(global)) {
    let content = fs.readFileSync(global, "utf8");
    content = setYamlValue(content, ["proxies", "velocity", "enabled"], "true");
    content = setYamlValue(content, ["proxies", "velocity", "online-mode"], "false");
    content = setYamlValue(content, ["proxies", "velocity", "secret"], secret);
    fs.writeFileSync(global, content);
    return;
  }
  if (fs.existsSync(paper)) {
    let content = fs.readFileSync(paper, "utf8");
    content = setYamlValue(content, ["settings", "velocity-support", "enabled"], "true");
    content = setYamlValue(content, ["settings", "velocity-support", "online-mode"], "false");
    content = setYamlValue(content, ["settings", "velocity-support", "secret"], secret);
    fs.writeFileSync(paper, content);
  }
}

function leadingSpaces(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 2;
    else break;
  }
  return n;
}

export function setYamlValue(content: string, keyPath: string[], value: string): string {
  const lines = content.split("\n");
  const parentPath = keyPath.slice(0, -1);
  const leafKey = keyPath[keyPath.length - 1];
  const stack: { indent: number; key: string }[] = [];
  let lastParentLine = -1;
  let replaced = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const indent = leadingSpaces(raw);
    const m = raw.match(/^(\s*)([^:#]+?)\s*:\s*(.*)$/);
    if (!m) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const key = m[2].trim();
    const hasValue = m[3].trim() !== "";
    if (hasValue) {
      const curPath = [...stack.map((s) => s.key), key];
      if (
        curPath.length === keyPath.length &&
        curPath.every((k, j) => k === keyPath[j])
      ) {
        lines[i] = `${m[1]}${leafKey}: ${value}`;
        replaced = true;
      }
      if (
        parentPath.length > 0 &&
        stack.length >= parentPath.length &&
        stack.slice(0, parentPath.length).every((s, j) => s.key === parentPath[j])
      ) {
        lastParentLine = i;
      }
    } else {
      if (stack.length && stack[stack.length - 1].indent === indent) stack.pop();
      stack.push({ indent, key });
      if (
        parentPath.length > 0 &&
        key === parentPath[parentPath.length - 1] &&
        stack.length === parentPath.length &&
        stack.every((s, j) => s.key === parentPath[j])
      ) {
        lastParentLine = i;
      }
    }
  }

  if (replaced) return lines.join("\n");

  const leafIndent = "  ".repeat(parentPath.length);
  if (lastParentLine >= 0) {
    lines.splice(lastParentLine + 1, 0, `${leafIndent}${leafKey}: ${value}`);
    return lines.join("\n");
  }
  if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
  for (let i = 0; i < parentPath.length; i++) {
    lines.push(`${"  ".repeat(i)}${parentPath[i]}:`);
  }
  lines.push(`${leafIndent}${leafKey}: ${value}`);
  return lines.join("\n");
}
