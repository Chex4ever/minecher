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
{ "token": "<jwt>", "user": { "id": "...", "username": "admin", "role": "admin" } }
```

### GET `/auth/me`
→ `200` `{ "user": { ... } }`

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
Дополнительное поле `server.serverPropsFile` — фактическое содержимое `server.properties` с диска (эффективные значения: `online-mode`, `server-port`, `motd` и др.), для вкладки Settings.

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
  "javaPath": null
}
```
→ `201` `{ "server": MinecraftServer }`

Типы: `vanilla | paper | spigot | forge | fabric | custom`. `loaderVersion` для vanilla/paper/spigot/custom игнорируется. Для `custom` jar не скачивается — сервер использует существующий `server.jar`/`fabric-server.jar` из своей рабочей директории.

Порт: если `port` не указан — сервер сам выбирает первый свободный порт, начиная с `25565` (перебирает `port+1`). Если порт указан и занят → `409` `{ "error": "port_busy", "message": "Port N is already in use" }`. Если заняты все порты в диапазоне +50 → `409` `{ "error": "no_free_port" }`.

### GET `/ports/:port`
Проверка доступности порта (для UI-индикатора). Запроса требует токен.
→ `200` `{ "port": 25565, "available": true, "usedBy": null }`
`available: false`, если порт занят ОС или уже используется запущенным сервером minecher; тогда `usedBy` — имя сервера.

### PATCH `/servers/:id` *(operator)*
Частичное обновление полей: `name`, `autoStart`, `autoRestart`, `memoryMaxMb`, `memoryMinMb`, `port`, `javaPath`, `javaArgs: string[]`, `serverProps: Record<string,string>`.
→ `200` `{ "server": MinecraftServer }`

### DELETE `/servers/:id` *(admin)*
Останавливает сервер (force), удаляет запись. Файлы остаются на диске.
→ `204`

### POST `/servers/:id/start` *(operator)*
Скачивает jar при необходимости (Forge — прогоняет installer), пишет `server.properties`, запускает java. Java: `javaPath` (если задан) → встроенный JRE → системный. Первый старт любого сервера без `javaPath` качает JRE Temurin.
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
→ `200` `{ "types": ["vanilla","paper","spigot","forge","fabric","custom"] }`

### GET `/versions/:type`
→ `200` `{ "type": "paper", "versions": ["26.2", "..."] }` | `502`, если внешний источник недоступен.

### GET `/versions/:type/:version/loaders`
→ `200` `{ "type": "forge", "version": "1.20.1", "loaders": ["1.20.1-47.2.0", ...] }`
Для vanilla/paper/spigot вернёт `loaders: []`.

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
→ `201` `{ "server": MinecraftServer }` | `400` `{ "error": "import_failed", ... }` (нет файла, не `.mcs`, `mcs.json` отсутствует, неподдерживаемый `format`).

### GET `/servers/:id/export` *(operator)*
Экспорт сервера в `.mcs`-архив (zip: `mcs.json` — манифест, остальное — файлы сервера, кроме `logs/**`, `*.log`, `session.lock`). Сервер должен быть остановлен.
→ `200` `application/zip` (Content-Disposition `attachment`) | `400` `{ "error": "export_failed", ... }`.

## RCON

### POST `/servers/:id/rcon` *(operator)*
```json
{ "command": "list" }
```
Используется, если в `serverProps` задано `enable-rcon=true`, `rcon.port`, `rcon.password`.
→ `200` `{ "ok": true, "response": "<вывод команды>" }` | `409`, если RCON недоступен.
