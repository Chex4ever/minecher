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
```

## Типы (packages/types)

- `MinecraftServer` — публичное представление записи + рантайм-поля `pid`, `status`, `stats`.
- `LogEntry` — `{ id, serverId, timestamp, stream, level, message }`.
- `ServerEvent` — дискриминированный союз `status | log | stats | created | updated | deleted` (у created/updated поле `server`, т.к. в `MinecraftServer` уже есть `type`).
- `ServerStatus`, `ServerType`, `ServerStats`, `BackupInfo`, `ScheduleInfo`, `User`, `VersionManifest`, `ApiError`.

## Уровень логов

Вычисляется автоматически из потока и текста:
- `stderr` → `error`
- `WARN`/`WARNING` → `warn`
- `ERROR`/`FATAL`/`SEVERE` → `error`
- `DEBUG`/`TRACE` → `debug`
- иначе → `info`

## Ротация логов

Перед первой записью за день проверяется размер файла: если > `MC_LOG_MAX_BYTES` (по умолчанию 50 МБ) — старый файл переименовывается в `<date>.log.1` и открывается новый.
