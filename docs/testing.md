# Тестирование

Автоматизированных тестов пока нет. Верификация ручная. Эта страница — чек-лист, проверенные сценарии и известные ограничения.

## Базовые проверки после любых изменений

```bash
npm run typecheck          # обязательный гейт, собирает types первым
npm run build -w web       # проверка сборки веба
```

## Смоук-тест API (Windows PowerShell)

```powershell
$base = "http://localhost:8080/api"

# health
Invoke-RestMethod "$base/health"

# login → токен
$login = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType "application/json" `
  -Body '{"username":"admin","password":"admin"}'
$h = @{ Authorization = "Bearer $($login.token)" }

# версии (внешний источник)
Invoke-RestMethod "$base/versions/paper" -Headers $h

# создать сервер
$srv = Invoke-RestMethod "$base/servers" -Method Post -Headers $h -ContentType "application/json" `
  -Body '{"name":"Test","type":"paper","version":"1.21.11"}'
$id = $srv.server.id

# расписания
Invoke-RestMethod "$base/servers/$id/schedules" -Method Post -Headers $h -ContentType "application/json" `
  -Body '{"cron":"0 3 * * *","action":"backup"}'
# bad cron → 400
try { Invoke-RestMethod "$base/servers/$id/schedules" -Method Post -Headers $h -ContentType "application/json" `
  -Body '{"cron":"not-a-cron","action":"backup"}' } catch { $_.Exception.Response.StatusCode.value__ }

# бэкапы: create → list → restore (сервер должен быть остановлен)
$b = Invoke-RestMethod "$base/servers/$id/backups" -Method Post -Headers $h
Invoke-RestMethod "$base/servers/$id/backups/$($b.backup.id)/restore" -Method Post -Headers $h

# импорт из папки
$srv2 = Invoke-RestMethod "$base/imports/path" -Method Post -Headers $h -ContentType "application/json" `
  -Body '{"path":"C:\\servers\\beta173"}'
# экспорт → скачать .mcs
Invoke-WebRequest "$base/servers/$($srv2.server.id)/export" -Headers $h -OutFile out.mcs
# импорт .mcs (multipart, файл обязателен)
Invoke-WebRequest "$base/imports/mcs" -Method Post -Headers $h -Form @{ file = Get-Item out.mcs }
```

## Проверенные сценарии (выполнены при разработке)

| Сценарий | Результат |
|---|---|
| `GET /api/health`, `POST /api/auth/login` (admin/admin) | 200, валидный JWT |
| `POST /api/servers` + `GET /api/servers` | сервер создан и виден |
| `GET /api/versions/paper` (Fill v3) | 66 версий, новейшая корректная |
| `GET /api/versions/vanilla` | 102 релизные версии |
| `GET /api/versions/:type/:version/loaders` (forge/fabric) | список лоадеров |
| WS `/api/servers/:id/console?token=...` | приходит `{"type":"tail"}`; Node 24 глобальный WebSocket |
| `POST .../schedules` валидный cron | 201 |
| `POST .../schedules` некорректный cron | 400 `bad_cron` |
| `POST .../backups` → list → restore | zip создаётся (без logs/jar), restore атомарно заменяет каталог, `world/level.dat` на месте |
| Запуск реального Minecraft-сервера | **не выполнялся** (нет подходящей Java/времени) — см. ограничения |
| `GET /api/ports/:port` | 200 `{available, usedBy}`; порт в блоке другого сервера (включая +1/+2/+3/+4) → `available:false`, `usedBy` — имя сервера; `?exclude=<id>` освобождает собственный блок; порт `70000` → 400 |
| `POST /api/servers` без `port` | автоподбор блока: серверы на 25555/25565/25566/25567 → выбран свободный блок 25572 (блоки пересекаются, если диапазоны `[port, port+4]` имеют общий порт) |
| `POST /api/servers` с занятым портом (или пересекающим блок) | 409 `{ "error": "port_busy", "message": "Port block N-M is not fully free" }` |
| `PATCH /api/servers/:id` на порт из чужого блока | 409 `port_busy` |
| Старт сервера | `server.properties` на диске: `server-port=<port>`, `rcon.port=<port+1>`, `query.port=<port+2>`; слушается только `server-port` (rcon/query выключены) |
| `POST /api/servers/:id/start` с пустым `Content-Type: application/json` | 200 `{"ok":true}` (раньше 400 `FST_ERR_CTP_EMPTY_JSON_BODY`) |
| Первый старт без системной Java (сломанный PATH-java) | бандл Temurin скачан (Adoptium), распакован `Expand-Archive`, Paper стартует: лог `Starting: <data>/runtime/jre/bin/java.exe ...`, `System Info: Java ...` |
| Запуск при ротации/смене файла лога | 200; падения `ERR_STREAM_WRITE_AFTER_END` больше нет (раньше процесс умирал на `LogStore.append`) |
| Старт после EULA | `eula.txt` пишется с `eula=true`, `server.properties` содержит `online-mode=false`; сервер доходит до `Done (3.5s)!`, статус `running` |
| `GET /api/servers/:id` | `server.serverPropsFile` — реальное содержимое `server.properties` с диска (порт, motd, online-mode=false, gamemode и пр.) |
| Paper 26.2 (нужна Java 25+) | бандл Java 21 → апгрейд на Temurin 25 (маркер `.feature`), сервер доходит до `Done (7.3s)!`, статус `running` |
| `POST /api/imports/path` — импорт Beta 1.7.3 из папки | каталог скопирован (world/, server.jar из `1.7.3 beta server.jar`, ops/banned/white-list), type=custom, port=25566; запуск на бандле Java 25 → `Done (392083600ns)!`, статус `running` |
| `GET /api/servers/:id/export` | `.mcs` 6,8 МБ, валидный zip (29 записей), `mcs.json` корректен; раньше был баг `stream closed prematurely` + 0 байт (fastify `wrapThenable` двойной `send`) |
| `POST /api/imports/mcs` (round-trip) | импорт экспортированного `.mcs` → новый сервер `Beta roundtrip` (порт 25567 авто-подобран, т.к. 25566 занят), `world/` (6 region) и `server.jar` на месте, `mcs.json` НЕ копируется в каталог; запуск → `Done (388025300ns)!`, статус `running` |
| restore бэкапа через `adm-zip` | замена `extract-zip` (зависал на больших записях на Node 24) — распаковка работает |
| `pid` в БД при старте/остановке | `start` пишет реальный pid java в `servers.pid`, `stop`/exit очищает; API отдаёт `server.pid` из runtime |
| Reconcile: stale-статус | в БД `status='running', pid=<мёртвый>` → рестарт демона: `Stale status "running" reset to stopped (daemon restarted, no live process)`, `status=stopped`, `pid` очищен, WS-событие `status` |
| Reconcile: orphan-java | настоящий java (бандл, порт 25567) жив при рестарте демона + БД `running/pid=<этот pid>` → лог `Daemon restarted: terminating orphan java process <pid>`, процесс убит (порт освобождён), `status=stopped` |
| `GET /api/versions/velocity` | список стабильных версий Velocity (3.5.1/3.5.0/3.4.0/.../4.0.0), SNAPSHOT отфильтрованы |
| Создание `velocity`-прокси и `paper`-бэкенда, `PATCH` бэкенда с `velocityProxyId` | 201/200; `GET` бэкенда отдаёт `velocityProxyId` |
| Старт velocity-прокси | на диске `velocity.toml` (плоский формат, `config-version=2.8`, `bind = 0.0.0.0:<port>`, offline, modern forwarding, `[servers]` бэкенды, пустой `[forced-hosts]`) и `forwarding.secret`; лог `Listening on /[...]:<port>` (правильный порт!), без `deprecated configuration version`; MC status-ping на порт прокси → JSON `{"description":{"color":"green","text":"<name>"},"players":{"max":500}}` |
| Старт бэкенда за прокси | `server.properties`: `server-ip=127.0.0.1`, `online-mode=false`; слушается только `127.0.0.1:<port>` (нет `0.0.0.0`/`[::]`); `config/paper-global.yml` → `proxies.velocity.enabled=true`, `online-mode=false`, `secret=<из forwarding.secret>` (корректные отступы); лог Paper: `Using Java compression/cipher from Velocity` |
| `PATCH` с несуществующим `velocityProxyId` | 400 `{ "error": "invalid_proxy" }` |
| `PATCH` velocity-прокси с `velocityProxyId` (прокси не может быть бэкендом) | 400 `invalid_proxy` |
| DELETE velocity-прокси | у бэкендов `velocityProxyId` сбрасывается в `null` |
| Экспорт `.mcs` бэкенда | `forwarding.secret` НЕ в архиве; манифест содержит `velocityProxyId` |
| `POST /api/launcher/builds` vanilla 1.20.1 → download | сборка `done`, ZIP ~750 МБ; содержимое: `1.20.1.jar`, `libraries/**`, `assets/indexes/5.json` + `assets/objects/**` (полный индекс со звуками), `natives/{linux,macos,macos-arm64,windows,windows-arm64}/` **плоско** (`.dll`/`.so`/`.dylib` в корне), `launcher.json` (offline-account, серверы из БД с LAN-IP), `start.bat`/`start.sh`/`README.txt` |
| Запуск собранного vanilla-клиента (start.bat, Java 21) | клиент **дошёл до главного меню**: Datafixer bootstrap, LWJGL 3.3.1, OpenAL (звук), атласы текстур; офлайн-вход (`Failed to verify authentication` — ожидаемо при `accessToken=0`), «Setting user», окно открыто, процесс жив (~1,1 ГБ) |
| `POST /api/launcher/builds` fabric 1.20.1 (0.19.3) | `done`, ZIP ~756 МБ, mainClass `net.fabricmc.loader.impl.launch.knot.KnotClient`, `versions/1.20.1/1.20.1.jar` + профиль fabric-loader |
| Forge 1.20.1 (47.4.22) без подготовки | installer падает: `There is no Minecraft installation at: <dir>` (нет `versions/<mc>/{jar,json}` и `launcher_profiles.json`) |
| `POST /api/launcher/builds` forge 1.20.1 (47.4.22) | `done`, ZIP ~832 МБ; `versions/1.20.1/1.20.1.jar` + `versions/1.20.1-forge-47.4.22/…json` (наследует vanilla), `libraries/**` = forge-installer + vanilla; **в ZIP нет** служебного каталога `forge-install/`; `start.bat`: `-p <module path> --add-modules ALL-MODULE-PATH … -cp "<clientjar>;libraries/**"`, mainClass `cpw.mods.bootstraplauncher.BootstrapLauncher` |
| Запуск forge-клиента (Java 21/25) | BSL стартует и доходит до module resolution — падает `ResolutionException: Modules … export package … to module …` (известная несовместимость Forge 1.20.1 с Java >17; README сборки требует Java 17) |
| Ограничение командной строки Windows | прямой `-cp` из 100+ jar в bat превышает 8191 символ cmd.exe (`The input line is too long`) → решено Java-argfiles `launch-windows.args`/`launch-unix.args` (по аргументу на строку, `-cp` и значение раздельно); argfile **без BOM** (BOM превращает первый `-D…` в имя main class) |
| Повторная сборка (кэши) | клиентский jar/библиотеки/ассеты из `data/clients/cache/**` не перекачиваются: сборка за ~5–40с (Forge с installer ~35с) |

## Запуск реального сервера (ручной сценарий)

1. В UI создайте сервер `paper`, укажите память ≥ 1024 МБ.
2. Старт — в консоли должны появиться строки загрузки Paper; первый старт скачает ~450 МБ jar.
3. EULA принимается автоматически (`eula.txt` → `eula=true`); по умолчанию `online-mode=false` (можно включить в настройках).
4. Проверьте: `list` в консоли, вкладка Stats (RAM/CPU/игроки), вкладка Settings — в поле server.properties видно реальное содержимое, остановка через кнопку.

## Velocity (ручной сценарий)

1. Создайте сервер типа `velocity` (рекомендуемая версия 3.5.1, память ≥ 1024 МБ). Старт — прокси слушает порт из настроек, в консоли `Done (0,6s)!` и `Listening on /[...]:<port>` (не 25565 по умолчанию).
2. Создайте `paper`-бэкенд, в Settings выберите созданный прокси в поле «Velocity proxy», сохраните.
3. Старт бэкенда: `server.properties` → `server-ip=127.0.0.1`; слушается только `127.0.0.1`; после первого бута `config/paper-global.yml` патчится секретом (вступает в силу со второго старта — тогда в логе `Paper: Using Java compression/cipher from Velocity`).
4. Проверка входа: подключитесь к прокси (порт прокси), а не к бэкенду; Motd в списке серверов — зелёное имя прокси.
5. Ограничение: **modern forwarding требует клиенты/бэкенды 1.13+**; старые версии (например Beta 1.7.3) через прокси не зайдут — для них прокси не назначается.

## Клиентский лаунчер (ручной сценарий)

1. Вкладка **Launcher**: выберите тип (vanilla/forge/fabric), версию, лоадер (для forge/fabric), офлайн-ник; «Собрать».
2. В списке сборок — прогресс; после `done` — «Скачать» (ZIP ~750 МБ для 1.20.1, в том числе полные ассеты со звуками).
3. ПК (Windows): распакуйте, запустите `start.bat` (нужна Java 17+; для Forge 1.20.1 — **Java 17**). Linux/macOS: `chmod +x start.sh && ./start.sh`.
4. Android: скопируйте папку в `Android/data/net.kdt.pojavlaunch/files/.minecraft/`, откройте PojavLauncher, запустите версию (использует собственный Java/natives; start-скрипты не нужны), аккаунт — offline с тем же ником.
5. Multiplayer: адреса серверов — из `launcher.json`/`README.txt` (LAN-IP хоста). Серверы должны быть `online-mode=false`.

## Известные ограничения среды тестирования

- **Orphan-процессы.** `Start-Job`/`Stop-Job` в PowerShell не убивают дочерние `node`/`tsx`. Они держат порты и дают flaky «connection reset». Перед повторными тестами:
  ```powershell
  Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
  ```
- **Два каталога данных.** `npm run dev -w server` работает с cwd `server/`, поэтому данные ложатся в `server/data`, а скрипты, запущенные из корня, видят `data/` в корне. Всегда тестируйте против того каталога, в котором запущен сервер (проверяйте `MC_DATA_DIR` или вывод старта).
- **IPv6 vs IPv4.** Vite в dev слушает `127.0.0.1` (IPv4). Обращайтесь к вебу по `http://localhost:5173` или `127.0.0.1:5173`, а не по `::1`.
- **PowerShell-цитирование.** `curl -d '{"a":1}'` в PowerShell передаёт кавычки как есть → JSON-ошибка 400. Используйте `Invoke-RestMethod -ContentType "application/json"` с одинарными кавычками вокруг тела, либо файл.
- **No-body POST.** `Invoke-RestMethod` без тела шлёт `application/x-www-form-urlencoded` — сервер это обрабатывает (lenient-парсер). Пустой `Content-Type: application/json` тоже принимается (JSON-парсер возвращает `{}` вместо ошибки `FST_ERR_CTP_EMPTY_JSON_BODY`).
- **Java без правок системы.** Встроенный JRE скачивается в `data/runtime` при первом старте; системный `java`/`JAVA_HOME` больше не нужны. Если на PATH стоит сломанный stub (например, Oracle `javapath`, падающий с кодом `0xC0000409` даже на `java -version`) — это не влияет на запуск серверов. Проверка загрузки: сервер печатает `System Info: Java ...` без указания версии из PATH.
- **EULA и online-mode.** EULA принимается автоматически (при каждом старте пишется `eula.txt` → `eula=true`). `online-mode=false` — управляемый дефолт: если в настройках задано своё значение — оно сохраняется.
- **Начальная загрузка.** Давайте серверу 10–15с после старта перед первыми запросами (первый тик SQLite-индекса, связывание портов).
- **Клиентский лаунчер.** Forge-клиент 1.20.1 запускается только на **Java 17** (Java 21/25 дают `ResolutionException` при module resolution); vanilla/fabric 1.20.1 — на Java 17–21+. В тестируемой среде Java 17 не установлена — Forge проверен до этапа module resolution, полный вход в игру не воспроизводился. Сборки большие (~750–830 МБ) — для повторных тестов используйте кэши (`data/clients/cache/**`). Прямая выдача ZIP ~1 ГБ из `/download` может быть медленной на слабых каналах.
