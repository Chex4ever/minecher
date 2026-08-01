# API Reference

Базовый URL: `http://<host>:<port>/api`. Все эндпоинты (кроме `/health` и `/auth/login`) требуют заголовок `Authorization: Bearer <token>`.

## Обозначения

- Тело запроса/ответа — JSON.
- Коды ошибок: `400` (невалидный ввод), `401` (не авторизован), `403` (нет прав), `404` (не найдено), `409` (конфликт состояния, напр. сервер не запущен), `500`/`502`.
- Формат ошибки: `{ "error": "<code>", "message": "<текст>" }`.

## Аутентификация

### POST `/auth/login`
```json
{ "username": "admin", "password": "admin" }
```
→ `200`
```json
{ "token": "<jwt>", "user": { "id": "...", "username": "admin", "role": "admin", "email": null, "avatar": null } }
```

### GET `/auth/me`
→ `200` `{ "user": { "id", "username", "role", "email", "avatar", "createdAt" } }` (читается свежим из БД)

### PATCH `/auth/me`
```json
{ "username": "admin2", "email": "a@b.com" }
```
→ `200` `{ "user": { ... }, "token": "<jwt>" }` — `token` присутствует и обязателен для замены текущего, если `username` изменён (JWT содержит username). `email` — `string | null`, формат `email@host` (минимум, без валидации домена). `username` — 3–32 символа, `[A-Za-z0-9_-]`, уникальный; конфликт → `409`.

### POST `/auth/me/password`
```json
{ "currentPassword": "admin", "newPassword": "secret1" }
```
→ `200` `{ "ok": true }`. Неверный текущий пароль → `401`; `newPassword` короче 6 символов → `400`.

### POST `/auth/me/avatar`
`multipart/form-data`, поле `file` (png/jpg/jpeg/gif/webp, до 2 МБ). → `200` `{ "user": { ..., "avatar": "/api/auth/avatars/<userId>.<ext>" } }`. Замена файла: старый удаляется, расширение может смениться (старое значение `avatar` инвалидируется).

### DELETE `/auth/me/avatar`
→ `200` `{ "user": { ..., "avatar": null } }` (удаляет файл аватара).

### GET `/auth/avatars/:file` *(токен через Bearer или `?token=`)*
→ `200` `image/*` (файл аватара). Имя файла валидируется по `^[0-9a-f-]+\.(png|jpe?g|gif|webp)$` — иначе `404`.

### POST `/auth/users` *(admin)*
```json
{ "username": "bob", "password": "secret", "role": "operator" }
```
→ `201` `{ "user": { ... } }`

### GET `/auth/users` *(admin)*
→ `200` `{ "users": [...] }`

## Здоровье

### GET `/health` *(без токена)*
→ `200` `{ "ok": true, "uptime": 12.34 }`

## Серверы

### GET `/servers`
→ `200` `{ "servers": [ MinecraftServer ] }` (статус подмешивается из рантайма)

### GET `/servers/:id`
→ `200` `{ "server": MinecraftServer }`
Дополнительные поля: `server.serverPropsFile` — фактическое содержимое `server.properties` с диска (эффективные значения: `online-mode`, `server-port`, `motd` и др.), для вкладки Settings. Для типа `velocity` вместо него отдаётся `velocityTomlFile` — сгенерированный на старте `velocity.toml` (только для чтения).

### POST `/servers` *(operator)*
```json
{
  "name": "My Paper",
  "type": "paper",
  "version": "1.21.11",
  "loaderVersion": "..."        // только forge/fabric
  "autoStart": false,
  "autoRestart": true,
  "memoryMaxMb": 2048,
  "memoryMinMb": 2048,
  "port": 25565,
  "javaPath": null,
  "velocityProxyId": "..."          // опционально: id velocity-прокси (бэкенд)
}
```
→ `201` `{ "server": MinecraftServer }`

Типы: `vanilla | paper | spigot | forge | fabric | velocity | custom`. `loaderVersion` для vanilla/paper/spigot/velocity/custom игнорируется. Для `custom` jar не скачивается — сервер использует существующий `server.jar`/`fabric-server.jar` из своей рабочей директории. Для `velocity` скачивается jar Velocity (рекомендуется 3.5.1, требует Java 21+; встроенный JRE — Temurin 25).

`velocityProxyId` — id существующего сервера типа `velocity`; если не `null`, сервер запускается как бэкенд прокси: `server-ip` принудительно `127.0.0.1`, в `config/paper-global.yml`/`paper.yml` включается Velocity modern forwarding с секретом прокси. Неверный id → `400` `{ "error": "invalid_proxy" }`.

Порт: если `port` не указан — сервер сам выбирает первый свободный блок портов, начиная с `25565`. Каждый сервер резервирует **блок из 5 последовательных портов**: `port` (игровой `server-port`), `port+1` (`rcon.port`), `port+2` (`query.port`), `port+3`/`port+4` (резерв). Если `port` указан, но весь блок не свободен (занят ОС или пересекается с блоком другого сервера) → `409` `{ "error": "port_busy", "message": "Port block N-M is not fully free" }`. Если заняты все блоки в диапазоне +50 → `409` `{ "error": "no_free_port" }`.

### GET `/ports/:port`
Проверка доступности порта (для UI-индикатора). Запроса требует токен. Опциональный query-параметр `?exclude=<serverId>` — исключить блок текущего сервера из проверки (используется во вкладке Settings, чтобы собственный порт сервера не считался занятым).
→ `200` `{ "port": 25565, "available": true, "usedBy": null }`
`available: false`, если какой-либо порт блока `port..port+4` занят ОС или входит в блок другого сервера minecher (запущенного или остановленного); тогда `usedBy` — имя первого такого сервера.

### PATCH `/servers/:id` *(operator)*
Частичное обновление полей: `name`, `autoStart`, `autoRestart`, `memoryMaxMb`, `memoryMinMb`, `port`, `javaPath`, `javaArgs: string[]`, `serverProps: Record<string,string>`, `velocityProxyId: string|null` (назначить бэкенд прокси / отвязать).
При смене `port` блок `port..port+4` проверяется на свободность (см. выше) — конфликт → `409` `{ "error": "port_busy" }`.
`velocityProxyId` должен ссылаться на существующий velocity-сервер (`400 invalid_proxy`); сам velocity-прокси не может быть бэкендом (`400 invalid_proxy`).
→ `200` `{ "server": MinecraftServer }`

### DELETE `/servers/:id` *(admin)*
Останавливает сервер (force), удаляет запись. Если удаляется velocity-прокси — у всех бэкендов `velocityProxyId` сбрасывается в `null`. Файлы остаются на диске.
→ `204`

### POST `/servers/:id/start` *(operator)*
Скачивает jar при необходимости (Forge — прогоняет installer), пишет конфигурацию и запускает java. Для обычных серверов синтезируется `server.properties` (+ `eula.txt`); для `velocity` — `velocity.toml` и `forwarding.secret`; для бэкенда за прокси дополнительно патчится `config/paper-global.yml`/`paper.yml` (modern forwarding) и `server-ip=127.0.0.1`. Java: `javaPath` (если задан) → встроенный JRE → системный. Первый старт любого сервера без `javaPath` качает JRE Temurin.
→ `200` `{ "ok": true }` | `500` `{ "error": "start_failed", ... }`

### POST `/servers/:id/stop` *(operator)*
```json
{ "force": false }        // опционально
```
Graceful stop через stdin `stop`, затем kill/SIGKILL.
→ `200` `{ "ok": true }`

### POST `/servers/:id/restart` *(operator)*
→ `200` `{ "ok": true }`

### POST `/servers/:id/command` *(operator)*
```json
{ "command": "op Steve" }
```
→ `200` `{ "ok": true }` | `409`, если сервер не запущен и RCON недоступен.

## Логи

### GET `/servers/:id/logs?offset=0&limit=200&q=<текст>&stream=stdout|stderr&level=info|warn|error|debug|all`
Запись `limit` до 2000. Отсортировано по времени (возрастание).
→ `200` `{ "entries": [ LogEntry ] }`

`LogEntry`: `{ id, serverId, timestamp, stream, level, message }`.

## Консоль (WebSocket)

### GET `/api/servers/:id/console?token=<jwt>` (upgrade)
Токен передаётся query-параметром (браузеры не ставят заголовки на WS).

Сообщения сервера:
- `{ "type": "tail", "entries": LogEntry[] }` — последние 100 записей при подключении.
- `{ "type": "log", "entry": LogEntry }` — живая запись.
- `{ "type": "status", "status": "running" }` — смена статуса.
- `{ "type": "error", "message": "..." }`.

Сообщения клиента:
- `{ "type": "command", "command": "save-all" }` — отправить команду (operator/admin).

## Версии

### GET `/versions`
→ `200` `{ "types": ["vanilla","paper","spigot","forge","fabric","velocity","custom"] }`

### GET `/versions/:type`
→ `200` `{ "type": "paper", "versions": ["26.2", "..."] }` | `502`, если внешний источник недоступен.

### GET `/versions/:type/:version/loaders`
→ `200` `{ "type": "forge", "version": "1.20.1", "loaders": ["1.20.1-47.2.0", ...] }`
Для vanilla/paper/spigot вернёт `loaders: []`.

## Клиентский лаунчер

Сборка играбельного клиента в ZIP (аналогично TLauncher): jar клиента + все библиотеки + полные ассеты (включая звуки) + `launcher.json` + `start.bat`/`start.sh` для ПК. Для Android папка совместима с PojavLauncher (раскладывается как `.minecraft`). Все маршруты — за авторизацией.

### GET `/launcher/versions?type=vanilla|forge|fabric`
Список версий клиента (без бета/снапшотов).
→ `200` `{ "type": "vanilla", "versions": ["1.20.1", ...] }` | `400 bad_type` | `502` при недоступности источника.

### GET `/launcher/versions/:type/:mc/loaders`
Лоадеры для версии (Forge: `1.20.1-47.4.22`; Fabric: `0.19.3`). Для vanilla — `[]`.
→ `200` `{ "type": "forge", "mcVersion": "1.20.1", "loaders": [...] }`.

### POST `/launcher/builds` *(любая авторизованная роль)*
Создаёт сборку и ставит её в очередь (сборки выполняются последовательно).
```json
{ "launcherType": "vanilla|forge|fabric", "mcVersion": "1.20.1", "loaderVersion": "1.20.1-47.4.22", "username": "Steve" }
```
`loaderVersion` обязателен для forge/fabric (можно получить через `/loaders`), для vanilla игнорируется. `username` — офлайн-ник (UUID вычисляется как `MD5("OfflinePlayer:<name>")`).
→ `201` `{ "build": ClientBuildInfo }`

`ClientBuildInfo = { id, launcherType, mcVersion, loaderVersion, username, status, progress, message, sizeBytes, zipPath, error, createdAt, updatedAt }`, `status: queued | building | done | error`.

### GET `/launcher/builds`
→ `200` `{ "builds": [ ClientBuildInfo ] }` (новые сверху).

### GET `/launcher/builds/:id`
→ `200` `{ "build": ClientBuildInfo }` | `404`.

### GET `/launcher/builds/:id/download`
Готовый ZIP (только `status === "done"`). `Content-Disposition: attachment`, `Content-Type: application/zip`, `Content-Length`.
→ `200` stream | `404` | `409 not_ready`.

### DELETE `/launcher/builds/:id` *(operator)*
Удаляет запись и файл ZIP.
→ `204` | `404`.

## Бэкапы

### GET `/servers/:id/backups`
→ `200` `{ "backups": [ BackupInfo ] }` — `BackupInfo = { id, serverId, path, sizeBytes, createdAt }`.

### POST `/servers/:id/backups` *(operator)*
Создаёт zip каталога сервера (без `logs` и jar). Без тела.
→ `201` `{ "backup": BackupInfo }`

### POST `/servers/:id/backups/:backupId/restore` *(admin)*
Сервер должен быть остановлен. Атомарная замена каталога.
→ `200` `{ "ok": true }` | `400`, если сервер запущен или бэкапа нет.

### DELETE `/servers/:id/backups/:backupId` *(operator)*
→ `204`

## Расписания

### GET `/servers/:id/schedules`
→ `200` `{ "schedules": [ ScheduleInfo ] }` — `ScheduleInfo = { id, serverId, cron, action, command?, enabled, createdAt }`.

### POST `/servers/:id/schedules` *(operator)*
```json
{ "cron": "0 3 * * *", "action": "backup" }
```
`action`: `start | stop | restart | backup | command` (для `command` обязателен `command`).
Некорректный cron → `400`.
→ `201` `{ "schedule": ScheduleInfo }`

### PATCH `/servers/:id/schedules/:scheduleId` *(operator)*
```json
{ "enabled": false }      // или cron/action/command
```
→ `200` `{ "schedule": ScheduleInfo }`

### DELETE `/servers/:id/schedules/:scheduleId` *(operator)*
→ `204`

## Импорт и экспорт

### POST `/imports/path` *(operator)*
Импорт сервера из существующей папки на диске (например, старый сервер без minecher). Папка копируется в `data/servers/<id>/`, `server.jar` переименовывается в ожидаемое имя, `logs`/`backups` исключаются.
```json
{
  "path": "C:\\servers\\beta173",   // обязателен, абсолютный путь к папке
  "name": "Beta 1.7.3",             // по умолчанию — имя папки
  "type": "custom",                 // по умолчанию — автодетект
  "version": "1.7.3 beta",          // по умолчанию "imported"
  "port": 25565                     // по умолчанию — из server.properties, затем авто-подбор от 25565
}
```
→ `201` `{ "server": MinecraftServer }` | `400` `{ "error": "import_failed", ... }` (путь не существует, нет `.jar`, папка внутри `data/`, порт занят при явном задании).

Автодетект типа: `fabric-server.jar` → fabric; каталог `versions/` → paper; `spigot.yml` → spigot; каталог `libraries/` → forge; иначе `custom`.

### POST `/imports/mcs` *(operator)*
Импорт из архива minecher `.mcs` (multipart/form-data).
- Поле `file` — файл `.mcs` (обязательно).
- Опциональные поля: `name` (имя сервера), `port` (порт; если не задан и порт из метаданных занят — автоматически подбирается свободный).
- Связка `velocityProxyId` из манифеста восстанавливается только если прокси с таким id существует; иначе `null`.
→ `201` `{ "server": MinecraftServer }` | `400` `{ "error": "import_failed", ... }` (нет файла, не `.mcs`, `mcs.json` отсутствует, неподдерживаемый `format`).

### GET `/servers/:id/export` *(operator)*
Экспорт сервера в `.mcs`-архив (zip: `mcs.json` — манифест, остальное — файлы сервера, кроме `logs/**`, `*.log`, `session.lock`, `forwarding.secret`). Сервер должен быть остановлен. Манифест содержит `velocityProxyId` (восстанавливается при импорте только если такой прокси существует).
→ `200` `application/zip` (Content-Disposition `attachment`) | `400` `{ "error": "export_failed", ... }`.

## RCON

### POST `/servers/:id/rcon` *(operator)*
```json
{ "command": "list" }
```
Используется, если в `serverProps` задано `enable-rcon=true` и `rcon.password`. Порт RCON принудительно равен `server.port + 1` (см. резервирование блока портов).
→ `200` `{ "ok": true, "response": "<вывод команды>" }` | `409`, если RCON недоступен.
