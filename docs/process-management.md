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
3. `writeServerProps`: синтез `server.properties` из существующего файла (ключи сохраняются) + управляемые значения: `online-mode=false` (по умолчанию, переопределяется настройками), принудительные `server-port` и `motd` (`§a<name>`). Файл переписывается на каждом старте; рядом пишется `eula.txt` → `eula=true` (автопринятие EULA).
4. `spawnJava`: `java [-Xms{M} -Xmx{M}] <javaArgs> -jar <jar> nogui`, cwd — рабочая директория. Java ищется в `server.javaPath` → встроенный JRE (`data/runtime/jre`, авто-скачивание Temurin) → `JAVA_HOME/bin/java` → `java` из PATH.
5. `stdout`/`stderr` → `handleOutput` → `logStore.append` (строки разбиваются по `\r?\n` с буфером недописанного хвоста).

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

## Ограничения Windows

- PowerShell-опрос `Get-Process` по PID (~50–150 мс) каждые 2с. На большой ферме серверов стоит реже опрашивать или собрать за один вызов.
- `Start-Job`/`Start-Process` в тестовых скриптах оставляют orphan-процессы node, держащие порты — убивайте их перед повторным тестом (см. `docs/testing.md`).
