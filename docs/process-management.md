# Управление процессами

Код: `server/src/services/processManager.ts`.

## Жизненный цикл

```
 stopped ──start()──► starting ──spawn ok──► running
    ▲                                          │
    │                                          ▼ stop()
 stopped ◄──exit (graceful)── stopping ◄──writing "stop"
    ▲
    │ exit без "stopping" + авторестарт (<=3 за 60с)
    └── 5s pause ──► starting
```

- `crash-loop` — более 3 рестартов за 60с: отказ от авторестарта.
- `error` — `spawn` бросил исключение (например, не найдена java).

## Встроенный Java runtime

Если `server.javaPath` не задан, демон использует собственный JRE вместо системного Java. Установка (однократная, при первом старте любого сервера):

1. Качается JRE Temurin с `api.adoptium.net` (feature-версия из `MC_JAVA_VERSION`, по умолчанию 25 — требуется для Paper 26.1+) в кэш `data/runtime/jre-<feature>-<os>-<arch>.zip`.
2. Распаковка в `data/runtime/.tmp-<uuid>/`: на Windows — `Expand-Archive` (PowerShell), на Linux/macOS — `tar -xzf`.
3. Атомарный переезд найденного `jdk-*/` → `data/runtime/jre`. Неудачные tmp-каталоги чистятся.
4. Установленная версия пишется в маркер `data/runtime/.feature`. Если `MC_JAVA_VERSION` изменился — бандл переустанавливается (маркер не совпадает), даже если `jre/` уже есть.

Код: `server/src/services/runtime.ts`. Если установка невозможна (нет сети) — логируется предупреждение и используется системный `java` (последний резерв).
- Статус персистится в `servers.status` и транслируется событием `status`.

## Запуск

1. Создаётся рабочая директория `data/servers/<id>/`.
2. `ensureJar`: если jar нет в рабочей директории — `DownloadService` качает в кэш и копирует в `server.jar`. Для `forge` дополнительно запускается `java -jar server.jar --installServer` (генерирует `libraries/`). Для типа `custom` скачивание пропускается, но `server.jar`/`fabric-server.jar` обязан существовать в рабочей директории (иначе старт не выполняется) — этот тип нужен для импортированных серверов.
3. Конфигурация в зависимости от типа:
   - **обычный сервер** → `writeServerProps`: синтез `server.properties` из существующего файла (ключи сохраняются) + управляемые значения: `online-mode=false` (по умолчанию, переопределяется настройками), принудительные `server-port`, `rcon.port` (= порт сервера +1), `query.port` (= порт сервера +2) и `motd` (`§a<name>`). Файл переписывается на каждом старте; рядом пишется `eula.txt` → `eula=true` (автопринятие EULA). Если сервер — бэкенд прокси (`velocityProxyId` задан): дополнительно `server-ip=127.0.0.1` (loopback) и `configureVelocityBackend` — патч `config/paper-global.yml`/`paper.yml` (modern forwarding) секретом прокси.
   - **velocity** → `writeVelocityConfig`: пишет `velocity.toml` (плоский формат 3.5.x/4.x, `config-version=2.8`, offline, modern forwarding, `[servers]` из бэкендов, `try = [...]`) и `forwarding.secret` (генерируется при отсутствии). Бэкенды = серверы с `velocityProxyId` = этот прокси; адреса `127.0.0.1:<port>`.
4. `spawnJava`: `java [-Xms{M} -Xmx{M}] <javaArgs> -jar <jar> [nogui]` (для `velocity` `nogui` не передаётся), cwd — рабочая директория. Java ищется в `server.javaPath` → встроенный JRE (`data/runtime/jre`, авто-скачивание Temurin) → `JAVA_HOME/bin/java` → `java` из PATH.
5. `stdout`/`stderr` → `handleOutput` → `logStore.append` (строки разбиваются по `\r?\n` с буфером недописанного хвоста). Для бэкенда за прокси по строке `Done (...)` повторно патчится конфиг paper (файл `config/paper-global.yml` появляется только после первого бута) — вступает в силу со следующего старта.

## Остановка

1. `stopping`, в stdin пишется `stop\n`.
2. Таймаут 15с → `SIGTERM`.
3. Ещё 3с → `SIGKILL`.
`force: true` пропускает graceful-стадию.

## Команды

`sendCommand`:
- если процесс запущен и stdin writable → пишет `command\n` в stdin;
- иначе, если доступен RCON → `rcon.send` (логирует и ответ);
- иначе → исключение "Server is not running".

## Статистика

Тик каждые 2с (`stats`-событие):
- `uptimeMs` — от старта процесса.
- `memoryUsedMb`, `cpuPercent` — Linux: `/proc/<pid>/stat` (utime+stime) + `/proc/<pid>/status` (VmRSS); Windows: PowerShell `Get-Process` (WorkingSet64, CPU). CPU% вычисляется дельтой от предыдущего сэмпла.
- `playersOnline/Max` — парсинг логов:
  - `": <uuid> joined the game"` → +1
  - `": <uuid> left the game"` → -1
  - `"There are N of a max of M players online"` → точная установка
  - `"players.online=N"` → установка N
- `tps` — всегда `null` (см. ADR-008).

## Автостарт

`autoStartAll` в `index.ts` при старте демона запускает все серверы с `auto_start=1`. В dev это не очень удобно (эффект при каждом `tsx watch` рестарте) — используйте флаг сознательно.

## Сверка статусов при старте (reconcile)

Статусы персистятся в `servers.status`, а pid живого java — в `servers.pid`. Если демон был убит жёстко, в БД могут остаться `running`/`starting`/`stopping` без живого процесса — веб показывал бы фейковый статус до следующего опроса.

Перед `autoStartAll` в `index.ts` вызывается `processes.reconcile()`. Для каждого сервера с `status !== "stopped"`, который не running in-memory:

- если `servers.pid` указывает на живой **java**-процесс — это orphan из прошлой сессии: логируется `Daemon restarted: terminating orphan java process <pid>` и процесс убивается (`killOrphan`: `SIGTERM`, ожидание до 6с, затем `SIGKILL`);
- иначе — `Stale status "<status>" reset to stopped (<reason>)` и статус сбрасывается в `stopped`;
- в обоих случаях `pid` очищается, `status=stopped` и транслируется WS-событие `status`.

`processAlive(pid)` (kill 0) различает живой/мёртвый pid; `probeProcess(pid)` определяет тип процесса (Windows: PowerShell `Get-Process -Id` → имя; POSIX: `/proc/<pid>/comm`). Детект «живого java» по имени процесса недостоверен для бандл-JRE на Node 24 (см. ADR-017), поэтому orphan признаётся только по точному совпадению `java`.

## Ограничения Windows

- PowerShell-опрос `Get-Process` по PID (~50–150 мс) каждые 2с. На большой ферме серверов стоит реже опрашивать или собрать за один вызов.
- `Start-Job`/`Start-Process` в тестовых скриптах оставляют orphan-процессы node, держащие порты — убивайте их перед повторным тестом (см. `docs/testing.md`).
