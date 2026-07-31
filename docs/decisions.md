# Технические решения (ADR)

Здесь зафиксированы ключевые решения и их обоснование.

## ADR-001: Node.js + TypeScript для демона

- **Решение:** Fastify (HTTP + WebSocket), better-sqlite3, ESM (`NodeNext`).
- **Почему:** один язык на весь стек, богатая экосистема для интеграции с Minecraft API, быстрый старт; Fastify — типобезопасный и быстрый.
- **Альтернативы:** Python (проще, но разрыв со стеком), Go (один бинарник, но больше работы с типами событийного потока).

## ADR-002: Запуск серверов через `java -jar` в child_process

- **Решение:** не Docker. Демон скачивает jar в кэш и спавнит `java -jar server.jar nogui` с настраиваемыми JVM-аргументами.
- **Почему:** ноль внешних зависимостей, полный контроль над stdin/stdout для веб-консоли, простота копирования мира/настроек.
- **Альтернативы:** Docker — изоляция, но тяжелее в настройке и требует демон на хосте.

## ADR-003: SQLite + файлы логов на диске

- **Решение:** SQLite (WAL) для метаданных/индекса логов, сырые логи в файлах `logs/<id>/<date>.log`.
- **Почему:** одиночный хост, нулевые внешние зависимости, файлы логов удобно читать/ротировать; SQLite достаточно для объёмов одного сервера.
- **Альтернатива:** PostgreSQL — только для мультихостовой фермы.

## ADR-004: WebSocket-консоль с полным stdin/stdout

- **Решение:** WS-эндпоинт `/api/servers/:id/console` — подписывается на события `log`/`status`, принимает команды `{type:"command"}`.
- **Токен через query** (`?token=`) — браузеры не умеют ставить заголовки на WebSocket.
- Вкладка Logs использует REST-индекс, а консоль — живой поток.

## ADR-005: IPv6 вырезан на корню

- **Решение:** сервер слушает только IPv4 (`0.0.0.0`), vite — `127.0.0.1`, исходящие запросы форсируют IPv4 (`dns.setDefaultResultOrder("ipv4first")`), `MC_HOST` с `:`/`::` отклоняется в `config.ts`.
- **Почему:** требование пользователя; устраняет класс проблем с `localhost`→`::1` и тестами.
- **Правило для кода:** не вводить IPv6-адреса, `localhost`/`::1` в новых путях.

## ADR-006: VersionSource-адаптеры + кэш jar

- **Решение:** интерфейс `VersionSource` (`listVersions`, `listLoaderVersions`, `resolveJar`) на тип; `DownloadService` кэширует по `versions/<type>/<version[-loader]>.jar`.
- **PaperMC:** миграция на Fill v3 (`fill.papermc.io`). API v2 (`api.papermc.io/v2`) вернул 410 и запрещён. В v3 URL загрузки уже встроен в ответ (`downloads["server:default"].url`, первый STABLE build). Обязателен непустой `User-Agent` с контактом.
- **Forge:** `resolveJar` отдаёт installer; на первом старте запускается `java -jar ... --installServer`.

## ADR-007: Жизненный цикл и политика рестартов

- Статусы: `starting → running → stopping → stopped` + `crash-loop`/`error`.
- Graceful stop: `stop\n` в stdin → kill через 15с → SIGKILL через 3с.
- Авторестарт: по умолчанию вкл; >3 рестартов за 60с → `crash-loop`, отказ.
- Автостарт при подъёме демона — флаг `autoStart`.

## ADR-008: Статистика без плагинов

- RAM/CPU через `/proc` (Linux) и PowerShell `Get-Process` (Windows), тик каждые 2с → событие `stats`.
- Игроки — парсинг строк лога (`joined/left the game`, `There are N of a max of M`).
- TPS: **не реализован** (null). Для vanilla штатного источника нет; план — лёгкий плагин (Spark) или сбор по RCON.

## ADR-009: Бэкапы

- **Решение:** zip всего каталога сервера, исключая `logs` и jar (`archiver`), в `data/backups/<id>/<timestamp>.zip`; восстановление через staging-каталог + `adm-zip` (атомарный swap с `.old-*`).
- Восстановление требует остановленного сервера и роли admin.
- **Замена `extract-zip` на `adm-zip`:** `extract-zip` (yauzl/fd-slicer) зависает на больших записях на современном Node (воспроизведено на Node 24: чтение записи >~500 КБ не доходит до `end`, promise не резолвится). `adm-zip` — синхронный, надёжный, распаковывает корректно. То же самое решение применено в импорте `.mcs` (ADR-016).

## ADR-010: Планировщик

- cron через `cron-parser`, тик каждые 30с, дедупликация по `scheduleId:nextTime`.
- Действия: start/stop/restart/backup/command; некорректный cron → 400.

## ADR-011: Авторизация

- JWT (`@fastify/jwt`), хранение паролей scrypt с солью, роли viewer < operator < admin.
- Границы: создание серверов — operator; удаление/restore/пользователи — admin; просмотр — viewer.

## ADR-012: Толерантность к no-body POST

- В `index.ts` зарегистрирован lenient-парсер `application/x-www-form-urlencoded` (пустое тело → `{}`), чтобы POST без JSON не отдавал 415 (важно для PowerShell/curl и простоты инструментов).
- `application/json` тоже принимает пустое тело (→ `{}`): UI шлёт `Content-Type: application/json` даже для no-body POST (start/stop/restart), иначе был бы `400 FST_ERR_CTP_EMPTY_JSON_BODY`.

## ADR-013: No comments

- Код без комментариев по требованию проекта; вся документация — в `docs/` и `AGENTS.md`.

## ADR-014: Встроенный Java runtime

- **Решение:** системная Java больше не нужна. При первом старте сервера демон качает JRE Temurin (feature-версия `MC_JAVA_VERSION`, по умолчанию 25 — требуется для Paper 26.1+) с `api.adoptium.net` и устанавливает в `data/runtime/jre`. Приоритет: `server.javaPath` → встроенный JRE → `JAVA_HOME` → `java` из PATH (последние два — только резерв при отсутствии сети).
- **Почему:** на Windows PATH часто содержит сломанный stub Oracle (`javapath`), падающий с `0xC0000409` ещё на `java -version` — серверы просто не стартовали. Бандл даёт воспроизводимую среду без правок системных переменных.
- **Реализация:** zip кэшируется (`runtime/jre-<feature>-<os>-<arch>.zip`), распаковка на Windows через `Expand-Archive` (PowerShell), на Linux/macOS — `tar`; атомарный переезд в `jre/`. `extract-zip` не подошёл (зависал на больших архивах).

## ADR-015: Управляемые defaults server.properties

- **Решение:** `server.properties` переписывается на каждом старте (ключи из файла мира сохраняются). EULA принимается автоматически: `eula.txt` → `eula=true`. `online-mode=false` — дефолт (управляемый: значение из настроек сервера имеет приоритет), `server-port`/`motd` принудительные (из настроек).
- **Почему:** сервер должен запускаться без ручных шагов (EULA), а offline-доступ (`online-mode=false`) — типичный дефолт для локального/своих-игроков сервера.
- **API:** `GET /servers/:id` отдаёт `serverPropsFile` (эффективное содержимое файла), чтобы вкладка Settings показывала реальную конфигурацию, а не только переопределения из БД.

## ADR-016: Импорт/экспорт серверов

- **Решение:** новый тип сервера `custom` и два способа импорта + экспорт.
  - `POST /api/imports/path` — импорт из существующей папки: копирование в staging (`data/tmp/import-<uuid>`), `servers.create()`, затем атомарный `renameSync` в `data/servers/<id>`. Причина: первый вариант создавал каталог под `randomUUID()`, а `create()` генерировал другой id — каталог и запись расходились. `server.jar` переименовывается в ожидаемое имя (`server.jar`/`fabric-server.jar`), `logs`/`backups` исключаются.
  - `POST /api/imports/mcs` — импорт `.mcs`-архива (multipart). Распаковка через `adm-zip` (см. ADR-009 про зависание `extract-zip`).
  - `GET /api/servers/:id/export` — `.mcs` = zip c `mcs.json` (манифест: имя, тип, версия, память, javaArgs, javaPath, serverProps, порт, автостарт/рестарт) + файлы сервера (кроме `logs/**`, `*.log`, `session.lock`).
  - Порт при импорте: явный пользовательский → жёстко (занят → 400); иначе приоритет `meta.port` → `server.properties` → авто-подбор от 25565.
- **Почему:** цель — перенос существующих серверов (включая старые beta-версии, где jar не скачивается из источников) и миграция между установками minecher.
- **Формат `custom`:** `VersionSource`-заглушка (пустые списки, `resolveJar` бросает ошибку); `ensureJar` пропускает скачивание, но требует наличие jar в рабочей директории.
- **Экспорт стримом:** маршрут возвращает `fs.createReadStream` из async-хендлера. Важно: `reply.send(stream)` без возврата из async-функции приводит к повторному `reply.send(undefined)` (fastify `wrapThenable`) — ответ `content-length: 0` и `stream closed prematurely`.
