# Архитектура

## Обзор

Minecher — монорепозиторий на npm workspaces с двумя рантаймами:

```
┌─────────────┐  REST/JSON + WebSocket  ┌──────────────────────┐
│  Web UI     │◄───────────────────────►│  Server daemon       │
│ React+Vite  │                         │  Fastify + TS        │
└─────────────┘                         └──────────┬───────────┘
                                                   │ child_process
                                          ┌────────▼───────────┐
                                          │ java -jar (Minecraft) │
                                          └──────────────────────┘
```

- `packages/types` — только общие типы, собираются в `dist/` (без aliases).
- `server` — демон: HTTP API, WebSocket-консоль, управление процессами, логи, версии, бэкапы, планировщик, RCON.
- `web` — SPA (React 18 + Vite 5), обращается к API только по HTTP/WS.

Сервер не зависит от сборки веба; взаимодействие исключительно по сети.

## Слои сервера

### Вход: `server/src/index.ts`
- Применяет `dns.setDefaultResultOrder("ipv4first")`.
- Читает конфиг (`config.ts`), открывает SQLite (`db.ts`).
- Создаёт сервисы, собирает их в `AppContext` (`services/context.ts`).
- Регистрирует плагины Fastify (cors, jwt, websocket) и группы маршрутов.
- Создаёт администратора при пустой БД, запускает планировщик и автостарты.

### Маршруты (`server/src/routes/*`)
| Модуль | Назначение |
|---|---|
| `auth.ts` | login, me, управление пользователями (admin) |
| `servers.ts` | CRUD серверов, start/stop/restart/command |
| `logs.ts` | GET логов из индекса + WS-консоль |
| `versions.ts` | список типов, версий и лоадеров |
| `backups.ts` | список/создание/восстановление/удаление бэкапов |
| `schedules.ts` | CRUD расписаний + ручной RCON-эндпоинт |
| `imports.ts` | импорт из папки/`.mcs`, экспорт в `.mcs` |
| `ports.ts` | проверка доступности порта `GET /api/ports/:port` |

Аутентификация — preHandler `authenticate` (JWT) + `requireRole`. WS-консоль принимает токен через `?token=` (браузер не умеет заголовки на WebSocket).

### Сервисы (`server/src/services/*`)
- **eventBus** — типизированный EventEmitter, рассылает `ServerEvent` (status/log/stats/created/updated/deleted) всем WS-клиентам.
- **processManager** — ядро: спавнит `java -jar`, держит жизненный цикл, пишет `server.properties`, собирает статистику.
- **runtime** — встроенный JRE: скачивает Temurin в `data/runtime/jre` при первом старте, когда `javaPath` не задан; системная Java не требуется.
- **logStore** — каждый вывод сервера пишется в файл `data/logs/<id>/<date>.log` и в таблицу `log_index`; генерирует `log`-события.
- **download** — кэш jar в `data/versions/<type>/`, фолбэк на `resolveJar` из `VersionSource`.
- **backups** — zip мира (исключая logs и jar) через `archiver`, восстановление через staging-каталог + `adm-zip`.
- **imports** — копирование папки-сервера и распаковка/создание `.mcs`-архивов (`adm-zip`), автодетект типа, подбор порта.
- **scheduler** — cron через `cron-parser`, тик каждые 30 секунд, дедупликация срабатываний по id+время.
- **rcon** — RCON-клиент (TCP, 4-байтные фреймы), фолбэк для команд, когда stdin недоступен.
- **serverRepository** — доступ к таблице `servers`, маппинг строк в типизированные объекты.

## Поток лога

```
java stdout/stderr ──► processManager.handleOutput ──► logStore.append
                                                        ├─► файл logs/<id>/<date>.log
                                                        ├─► INSERT INTO log_index
                                                        └─► eventBus → WS-клиенты
```

## Web-интерфейс

- `api.ts` — тонкий клиент с JWT из localStorage; WS-URL строится с `?token=`.
- `auth.tsx` — контекст сессии/ролей.
- Страницы: `Login`, `Dashboard` (карточки серверов, создание), `ServerPage` (вкладки Console/Logs/Settings/Backups/Schedules).
- Vite dev-проксирует `/api` (включая ws) на `:8080`.

## Безопасность

- JWT подпись — `MC_AUTH_SECRET`; роли viewer < operator < admin.
- Хранение паролей — scrypt с солью.
- IPv6 вырезан намеренно (см. `docs/decisions.md`).
- В production `:8080` не должен быть открыт наружу напрямую.
