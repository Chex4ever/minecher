# Модель данных

## Корневой каталог

По умолчанию `data/` относительно cwd процесса (в dev через `npm run dev -w server` — это `server/data`). Переопределяется `MC_DATA_DIR`.

```
data/
  minecher.db                SQLite (WAL) — на самом деле в подпапке db/ (см. ниже)
  servers/<id>/              рабочая директория java-процесса
    server.jar               jar сервера (или fabric-server.jar; для forge — installer; для velocity — velocity-3.x.jar → server.jar)
    server.properties        синтезируется на старте: существующие ключи + online-mode=false (по умолч.) + port/motd + rcon.port (port+1) / query.port (port+2)
    eula.txt                 пишется с eula=true при каждом старте
    velocity.toml            (velocity) синтезируется на старте: offline, modern forwarding, бэкенды из velocityProxyId
    forwarding.secret        (velocity) секрет modern forwarding (генерируется при первом старте, 32 байта hex)
    world/, world_nether/    миры
    libraries/               (forge) зависимости после --installServer
  versions/<type>/           кэш скачанных jar: <version>.jar | <version>-<loader>.jar
  logs/<serverId>/<date>.log  сырые логи, ротация по размеру (MC_LOG_MAX_BYTES)
  backups/<serverId>/<timestamp>.zip
  db/minecher.db             файл SQLite (WAL)
  runtime/                   встроенный Java runtime
    jre/                     распакованный JRE (bin/java.exe)
    jre-<feature>-<os>-<arch>.zip   кэш архива скачивания
  tmp/                       временные каталоги импорта/загрузки (чистятся после операции)
  export/                    сгенерированные .mcs-архивы при экспорте (раздаются и удаляются)
  clients/                   сборки клиентского лаунчера (см. ниже)
```

## Формат архива .mcs

Портативный архив minecher для переноса сервера между установками. Это zip-файл:
- `mcs.json` — манифест (в корне архива);
- файлы сервера — в корне архива (копия рабочей директории без `logs/**`, `*.log`, `session.lock`).

```json
{
  "format": 1,
  "name": "Beta 1.7.3",
  "type": "custom",
  "version": "1.7.3 beta",
  "memoryMaxMb": 1024,
  "memoryMinMb": 1024,
  "javaArgs": [],
  "javaPath": null,
  "serverProps": {},
  "port": 25566,
  "autoStart": false,
  "autoRestart": true,
  "velocityProxyId": null,
  "exportedAt": "2026-07-31T20:03:16.429Z"
}
```
При импорте, если заданный/мета-порт занят и порт не указан пользователем явно — выбирается свободный блок (см. резервирование 5 портов на сервер). `velocityProxyId` восстанавливается только при наличии прокси с таким id.

## Схема SQLite

```sql
users(
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,        -- scrypt, формат "<salt>:<hex>"
  role          TEXT NOT NULL DEFAULT 'viewer',  -- viewer|operator|admin
  created_at    TEXT NOT NULL
)

servers(
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,       -- vanilla|paper|spigot|forge|fabric|velocity|custom
  version        TEXT NOT NULL,
  jar_path       TEXT,                -- "<version>" или "<version>-<loader>"
  status         TEXT NOT NULL DEFAULT 'stopped',
  auto_start     INTEGER NOT NULL DEFAULT 0,
  auto_restart   INTEGER NOT NULL DEFAULT 1,
  restarts_count INTEGER NOT NULL DEFAULT 0,
  java_path      TEXT,
  memory_max_mb  INTEGER NOT NULL DEFAULT 1024,
  memory_min_mb  INTEGER NOT NULL DEFAULT 1024,
  java_args      TEXT NOT NULL,       -- JSON string[]
  server_props   TEXT NOT NULL,       -- JSON Record<string,string>
  port           INTEGER NOT NULL DEFAULT 25565,   -- начало блока из 5 портов: port, +1 rcon, +2 query, +3/+4 резерв
  velocity_proxy_id TEXT,             -- id velocity-прокси, за которым запускается этот бэкенд (NULL — не бэкенд)
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  last_started_at TEXT,
  last_stopped_at  TEXT,
  pid            INTEGER,             -- pid последнего java-процесса; для сверки статусов при старте демона
)

log_index(
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,            -- ISO-8601
  stream    TEXT NOT NULL,            -- stdout|stderr|system
  level     TEXT NOT NULL,            -- trace|debug|info|warn|error
  message   TEXT NOT NULL
)
CREATE INDEX idx_log_server_ts ON log_index(server_id, timestamp);
CREATE INDEX idx_log_ts        ON log_index(timestamp);

backups(
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL,
  path       TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)

schedules(
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL,
  cron       TEXT NOT NULL,
  action     TEXT NOT NULL,           -- start|stop|restart|backup|command
  command    TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
)

settings(
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)

client_builds(
  id            TEXT PRIMARY KEY,
  launcher_type TEXT NOT NULL,          -- vanilla|forge|fabric
  mc_version    TEXT NOT NULL,
  loader_version TEXT,
  username      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',  -- queued|building|done|error
  progress      REAL NOT NULL DEFAULT 0,
  message       TEXT,
  error         TEXT,
  size_bytes    INTEGER,
  zip_path      TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
)
```

## Типы (packages/types)

- `MinecraftServer` — публичное представление записи + рантайм-поля `pid`, `status`, `stats`.
- `LogEntry` — `{ id, serverId, timestamp, stream, level, message }`.
- `ServerEvent` — дискриминированный союз `status | log | stats | created | updated | deleted` (у created/updated поле `server`, т.к. в `MinecraftServer` уже есть `type`).
- `ServerStatus`, `ServerType`, `ServerStats`, `BackupInfo`, `ScheduleInfo`, `User`, `VersionManifest`, `ApiError`.
- `ClientLauncherType` (`vanilla|forge|fabric`), `ClientBuildStatus` (`queued|building|done|error`), `ClientBuildInfo`, `LauncherVersionsResponse`.

## Клиентские сборки (data/clients)

```
clients/
  <launcherType>-<mcVersion>[-<loader>]-<username>-<id8>.zip   готовые сборки (до ~10, LRU)
  cache/
    jars/vanilla/<mc>.jar                  клиентские jar (кэш, общий для vanilla/forge/fabric)
    libraries/**                           общий кэш библиотек (maven-пути)
  assets/objects/<ab>/<sha1>               общий кэш ассетов (objects + indexes)
  build/<id>/                              рабочий каталог одной сборки (чистится после, см. ниже)
```

Содержимое ZIP (корень сборки):
- `libraries/**` — все библиотеки (maven-пути): vanilla + лоадер. Для Forge — из installer + vanilla.
- `versions/<mc>/<mc>.jar` — клиентский jar vanilla (Forge наследует его); `versions/<full>/<full>.json` — профиль версии (Forge: `1.20.1-forge-47.4.22`, наследует vanilla, отдельного jar нет).
- `natives/<os>/` — нативные библиотеки, распакованные из classifier-джар плоско (файлы `.dll`/`.so`/`.dylib` прямо в каталоге): `windows`/`windows-arm64`/`linux`/`linux-arm64`/`macos`/`macos-arm64`.
- `assets/indexes/<id>.json` + `assets/objects/**` — **полный** индекс ассетов со звуками (флагов включения нет).
- `launcher.json` — манифест: `{ launcher, client: {type,mcVersion,loader,versionId,assetIndex,mainClass}, account: {username,uuid,offline:true}, servers: [{name,host,port,onlineMode}] }` (серверы из БД, host — LAN-IP хоста).
- `launch-windows.args` / `launch-unix.args` — JVM-аргументы и `-cp` в Java-argfile (по одному аргументу на строку; разделители classpath `;`/`:`) — иначе командная строка превышает лимит cmd.exe (8191 символ).
- `start.bat` / `start.sh` — `java -Djava.library.path=<natives по платформе> @launch-<os>.args <mainClass> <game args>`; для Forge (Java 25) см. ограничение в testing.md.
- `README.txt` — инструкция: ПК (start.bat/sh, нужна Java 17+) и Android (PojavLauncher, скопировать как `.minecraft`).

Процесс сборки (`server/src/services/clientService.ts`): очередь serial (`pump()`), статусы в `client_builds`. Vanilla/Fabric — `net.minecraft.client.main.Main`/`KnotClient`, обычный `-cp` + `-Djava.library.path`. Forge 1.20.1 — клиентская установка через installer: в scratch-каталог кладутся `versions/<mc>/{jar,json}` + заглушка `launcher_profiles.json` (иначе installer падает «There is no Minecraft installation»), затем `java -jar forge-...-installer.jar --installClient <dir>`; сгенерированный профиль `versions/<mc>-forge-<build>/<full>.json` наследует vanilla (jar — `versions/<mc>/<mc>.jar`), библиотеки — из `libraries/` installer + vanilla; запуск через `cpw.mods.bootstraplauncher.BootstrapLauncher` с module-path (`-p ...jar;...`, `--add-modules ALL-MODULE-PATH`), classpath обязателен целиком (BSL читает `java.class.path`).


## Уровень логов

Вычисляется автоматически из потока и текста:
- `stderr` → `error`
- `WARN`/`WARNING` → `warn`
- `ERROR`/`FATAL`/`SEVERE` → `error`
- `DEBUG`/`TRACE` → `debug`
- иначе → `info`

## Ротация логов

Перед первой записью за день проверяется размер файла: если > `MC_LOG_MAX_BYTES` (по умолчанию 50 МБ) — старый файл переименовывается в `<date>.log.1` и открывается новый.
