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
| `GET /api/ports/:port` | 200 `{available, usedBy}`; занятый порт (слушатель ОС) → `available:false`; порт `70000` → 400 |
| `POST /api/servers` без `port` | автоподбор: занятый 25565 пропущен, выбран 25566 |
| `POST /api/servers` с занятым портом | 409 `{ "error": "port_busy" }` |
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

## Запуск реального сервера (ручной сценарий)

1. В UI создайте сервер `paper`, укажите память ≥ 1024 МБ.
2. Старт — в консоли должны появиться строки загрузки Paper; первый старт скачает ~450 МБ jar.
3. EULA принимается автоматически (`eula.txt` → `eula=true`); по умолчанию `online-mode=false` (можно включить в настройках).
4. Проверьте: `list` в консоли, вкладка Stats (RAM/CPU/игроки), вкладка Settings — в поле server.properties видно реальное содержимое, остановка через кнопку.

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
