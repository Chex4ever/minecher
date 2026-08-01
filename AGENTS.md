# AGENTS.md — guide for AI coding agents

Guidelines for working on the **Minecher** repository: a Minecraft server manager with a web UI, REST API, centralized logs, backups, scheduler, and RCON.

## Repository layout

```
packages/types/   Shared TypeScript types only (@minecher/types). Built to dist/.
server/           Backend daemon: Fastify API, WebSocket console, process manager, logs, versions.
web/              Frontend: React 18 + Vite 5 + react-router.
docs/             Architecture, technical decisions (ADRs), API reference, testing notes.
```

npm workspaces monorepo. Root `package.json` defines `dev`, `build`, `typecheck` orchestration.

## Commands (run from repo root)

- `npm install` — install all workspaces.
- `npm run dev` — concurrently: types watch, server (tsx watch), web (vite). Backend on :8080, web on :5173.
- `npm run typecheck` — **always run after changes.** Builds types first, then `tsc --noEmit` in every workspace.
- `npm run build` — full production build.
- `npm run dev:server` / `npm run dev:web` — individual dev servers.
- No lint script is configured; the typecheck is the gate.

## Critical rules

- **Do not add code comments unless asked.** The codebase intentionally has none.
- **Docs stay in sync with code.** Any change to code, API surface, data layout, config/env vars, dependencies, or behavior REQUIRES reviewing and updating the matching docs: `README.md`, `AGENTS.md`, `docs/api.md`, `docs/data-model.md`, `docs/decisions.md`, `docs/process-management.md`, `docs/version-sources.md`, and the checked scenarios in `docs/testing.md`. Never merge/leave a change with stale documentation. If the change is a bugfix with no user-visible effect, say explicitly that no doc update is needed.
- **Tests are part of the change.** After modifying behavior, re-run the verification from `docs/testing.md` (typecheck, web build, smoke scenarios) and update the checked-scenarios table when behavior changed. Never claim a scenario is verified unless you actually ran it.
- **IPv6 is banned.** Server binds IPv4 only (`0.0.0.0`), vite binds `0.0.0.0` (IPv4-only; LAN-доступ к web-UI и API), `dns.setDefaultResultOrder("ipv4first")` in `server/src/index.ts`, and `MC_HOST` containing `:` is rejected in `server/src/config.ts`. Do not reintroduce IPv6 or `localhost`-with-IPv6 resolution in new code.
- **Shared types must be built before server/web typecheck works.** `packages/types` has no `paths` alias; `@minecher/types` resolves to its built `dist/`. The root `typecheck` script handles the build order — run `npm run typecheck`, not `tsc` directly.
- ESM everywhere (`"type": "module"`, NodeNext module resolution, `.js` extensions in relative imports).
- Keep `server/` free of a runtime dependency on the web build; they talk only over HTTP/WebSocket.

## Architecture in one screen

- `server/src/index.ts` wires services into an `AppContext` (`server/src/services/context.ts`) and registers route groups. On boot it runs `processes.reconcile()` (stale-status cleanup, see Process manager details) before `autoStartAll`.
- `server/src/services/processManager.ts` — spawns `java -jar`, lifecycle, restart policy, stats, writes `server.properties` on start, Forge installer step. Java resolution: `server.javaPath` → bundled JRE → `JAVA_HOME` → PATH `java`.
- `server/src/services/runtime.ts` — downloads/installs bundled Temurin JRE into `data/runtime/jre` (zip cache + `Expand-Archive`/`tar`), used when `javaPath` unset; system Java is NOT required.
- `server/src/services/logStore.ts` — appends every log line to `data/logs/<serverId>/<date>.log` and indexes it in SQLite (`log_index`); emits `log` events. Handles rotation and date rollover without crashing (`ERR_STREAM_WRITE_AFTER_END` must not propagate).
- `server/src/services/eventBus.ts` — typed event emitter broadcasting `ServerEvent` to WebSocket clients.
- `server/src/versions/*` — `VersionSource` adapters (vanilla/paper/spigot/forge/fabric/velocity) + `DownloadService` cache in `data/versions/`.
- `server/src/services/velocity.ts` — Velocity config generation: flat `velocity.toml` (3.5.x/4.x format, `config-version=2.8`), `forwarding.secret` (32-byte hex, written BOM-less), and a line-based YAML patcher for `proxies.velocity`/`settings.velocity-support` in paper configs. Backends (servers with `velocityProxyId`) run on `server-ip=127.0.0.1` and are reachable only via the proxy.
- `server/src/services/rcon.ts` — RCON protocol client (TCP, 4-byte-length frames), used as fallback for commands.
- `server/src/services/scheduler.ts` — cron via `cron-parser`, tick every 30s, actions start/stop/restart/backup/command.
- `server/src/services/backups.ts` — zip server dir (excl. logs/jar) with `archiver`, restore via staging dir with `adm-zip` (NOT `extract-zip` — it hangs on large entries under modern Node).
- `server/src/services/imports.ts` — `ImportService`: `importPath` (copy folder → staging → `servers.create()` → atomic rename), `importMcS` (`.mcs` zip → `adm-zip` extract), `exportMcS` (zip with `mcs.json` manifest). Auto-detects type from jar/dir layout; type `custom` skips jar download.
- `server/src/services/clientService.ts` — client launcher: assembles a full Minecraft **client** (vanilla/Forge/Fabric: client jar + all libraries + full assets incl. sounds + natives) into a downloadable zip with `launcher.json`, `start.bat`/`start.sh` (PC) and PojavLauncher compatibility (Android). Serial build queue, shared caches under `data/clients/cache/`, offline auth (UUID = MD5(`OfflinePlayer:<name>`)), ZIP in `data/clients/`. Scripts use Java **argfiles** (`launch-windows.args`/`launch-unix.args`, one arg per line, `-cp` + value on separate lines, BOM-less) — a 100+ jar `-cp` overflows cmd.exe's 8191-char limit. Natives are extracted **flat** from classifier jars. Forge 1.20.1: installer needs `versions/<mc>/{jar,json}` + stub `launcher_profiles.json`, profile inherits vanilla jar, launched via `BootstrapLauncher` with module path AND full classpath; requires Java 17 (fails module resolution on 21/25). See ADR-020.

## API surface (summary)

- `POST /api/auth/login`, `GET /api/auth/me`, `POST|GET /api/auth/users` (admin).
- `GET|POST /api/servers`, `GET|PATCH|DELETE /api/servers/:id`, `POST /api/servers/:id/{start,stop,restart,command}`.
- `GET /api/servers/:id/logs`, `GET /api/servers/:id/console` (WebSocket).
- `GET /api/versions`, `GET /api/versions/:type`, `GET /api/versions/:type/:version/loaders`.
- `GET /api/launcher/versions?type=`, `GET /api/launcher/versions/:type/:mc/loaders`, `POST|GET /api/launcher/builds`, `GET /api/launcher/builds/:id[/download]`, `DELETE /api/launcher/builds/:id` (download requires `status=done`).
- `GET|POST /api/servers/:id/backups`, `POST .../backups/:bid/restore`, `DELETE .../backups/:bid`.
- `GET|POST /api/servers/:id/schedules`, `PATCH|DELETE .../schedules/:sid`.
- `POST /api/servers/:id/rcon`.
- `GET /api/ports/:port` — availability probe for a 5-port block (`?exclude=<serverId>` ignores the caller's own block).
- `POST /api/imports/path` (import from folder), `POST /api/imports/mcs` (multipart `.mcs`), `GET /api/servers/:id/export` (`.mcs` download). Server types include `custom` (no jar download; existing jar required). Export stream: async handler must `return` the stream — calling `reply.send(stream)` without returning makes fastify `wrapThenable` send `undefined` again (0-byte response + `stream closed prematurely`).
- Auth: JWT in `Authorization: Bearer <token>`; the WS console accepts `?token=` because browsers cannot set headers on WebSocket.
- Roles: viewer < operator < admin. No-body POSTs must not 415: lenient `application/x-www-form-urlencoded` parser registered in `index.ts`; the `application/json` parser also accepts empty bodies (returns `{}`) so UI no-body POSTs (start/stop/restart) don't 400. `POST /api/servers` omitting `port` auto-picks the first free 5-port block from 25565 (`server/src/services/ports.ts`); explicit port whose block is not fully free (OS-busy or overlapping another server's block `port..port+4`) → 409 `port_busy`.

## Data layout (default `<cwd>/data`)

```
data/
  db/minecher.db           SQLite (WAL): users, servers, log_index, backups, schedules, settings
  servers/<id>/            java process working dir: server.jar, world/, server.properties, logs/; velocity proxies get velocity.toml + forwarding.secret; paper backends get server-ip=127.0.0.1 + patched paper config
  versions/<type>/         cached downloaded jars (keyed by version[-loader])
  logs/<serverId>/<date>.log
  backups/<serverId>/<timestamp>.zip
  runtime/                   bundled JRE: jre/ + jre-<feature>-<os>-<arch>.zip cache
  tmp/                       import/upload staging (cleaned after each op)
  export/                    generated .mcs archives (streamed then removed)
  clients/                   client launcher builds: <type>-<mc>[-<loader>]-<player>-<id8>.zip (LRU ~10), cache/{jars/vanilla,libraries,assets/{indexes,objects}}, build/<id>/ scratch (wiped per build; stale rows marked error on boot)
```

Dev note: running `npm run dev -w server` sets cwd to `server/`, so dev data lands in `server/data`. `tsx watch` ignores `data/**` to avoid restart loops.

## Process manager details

- Lifecycle: `starting → running → stopping → stopped`, plus `crash-loop` / `error`.
- Graceful stop: write `stop\n` to stdin, kill after 15s, SIGKILL after 3s more.
- Auto-restart: enabled by default; >3 restarts within 60s → `crash-loop` state and give up.
- Stats every 2s (RAM/CPU) emitted as `stats` events. Windows RAM/CPU via PowerShell `Get-Process`.
- Player count parsed from log lines (`joined the game` / `left the game` / `There are N of a max of M players online`).
- Status reconciliation on boot (`reconcile()`): live java pid is persisted to `servers.pid` (written on spawn, cleared on exit); on daemon start any non-`stopped` server not running in-memory is reset — a live `java` process under that pid is killed as orphan (`Daemon restarted: terminating orphan java process`), otherwise status resets to `stopped` with a `Stale status ...` log line. Live-process check is by exact process name via `Get-Process -Id` / `/proc/<pid>/comm` — `Get-Process -Name java` is unreliable (bundled JRE not found by name on Node 24).
- `server.properties` is synthesized on every start (existing keys preserved; `online-mode=false` default overridable via settings; `server-port`, `rcon.port` (=port+1), `query.port` (=port+2) and `motd` forced from the record — each server reserves a 5-port block `port..port+4`) and `eula.txt` is written with `eula=true`. `GET /api/servers/:id` adds `serverPropsFile` (effective on-disk props) for the Settings tab.

## Version sources (verified endpoints)

- **vanilla**: `https://launchermeta.mojang.com/mc/game/version_manifest_v2.json`
- **paper**: Fill v3 — `https://fill.papermc.io/v3/projects/paper`. `api.papermc.io/v2` returns 410 and must NOT be used. Uses `.downloads["server:default"].url` of the first STABLE build.
- **spigot**: `https://api.getbukkit.org/v2/projects/spigot` + `https://download.getbukkit.org/spigot/spigot-<v>.jar`
- **forge**: `https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`; jar is the installer, run with `--installServer` on first start.
- **fabric**: `https://meta.fabricmc.net/v2/versions` → `.../loader/<mc>/<loader>/<installer>/server/jar`
- A valid, non-generic `User-Agent` is required (PaperMC rejects generic UAs).

## Testing

There is no automated test suite yet. Verification is manual:
1. `npm run typecheck` must pass in all workspaces.
2. `npm run build -w web` must succeed.
3. Boot server (`npm run dev:server`), then smoke-test endpoints with curl / PowerShell. A checked flow: login → create server → schedule CRUD (bad cron → 400) → backup create/list/restore → WS console `tail`.
4. Be careful testing on Windows: `Invoke-RestMethod` POST without a body sends `application/x-www-form-urlencoded` (handled), `Start-Job` leaves orphan `node` processes that hold ports and cause flaky "connection reset" — kill them before re-testing, and expect two possible `data/` dirs depending on cwd.

See `docs/testing.md` for detailed scenarios and known limitations.
