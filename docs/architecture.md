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
| `auth.ts` | login, me (свежий из БД), профиль (username/email), смена пароля, загрузка/удаление аватара, раздача аватаров, управление пользователями (admin) |
| `servers.ts` | CRUD серверов, start/stop/restart/command |
| `logs.ts` | GET логов из индекса + WS-консоль |
| `versions.ts` | список типов, версий и лоадеров |
| `backups.ts` | список/создание/восстановление/удаление бэкапов |
| `schedules.ts` | CRUD расписаний + ручной RCON-эндпоинт |
| `imports.ts` | импорт из папки/`.mcs`, экспорт в `.mcs` |
| `ports.ts` | резервирование блока 5 портов на сервер (`port..port+4`: игровой, rcon, query, резерв), подбор свободного блока, проверка `GET /api/ports/:port` |
| `client.ts` | клиентский лаунчер: версии/лоадеры, сборки (create/list/get/download/delete) |

Аутентификация — preHandler `authenticate` (JWT) + `requireRole`. WS-консоль принимает токен через `?token=` (браузер не умеет заголовки на WebSocket). Аватары хранятся в `data/avatars/<userId>.<ext>` и раздаются по `GET /api/auth/avatars/:file` с токеном (Bearer или `?token=`, т.к. `<img>` не умеет заголовки). Смена username выдаёт новый JWT (payload содержит username), фронт подменяет токен.

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
- **clientService** — сборка клиентского лаунчера: версии/лоадеры (vanilla manifest, meta.fabricmc.net, Forge maven), очередь сборок, скачивание клиентского jar/библиотек/полных ассетов, Forge-установка `--installClient`, генерация `launcher.json`, Java-argfiles и `start.bat`/`start.sh`, упаковка в ZIP. Подробности и решения — ADR-020, layout — `docs/data-model.md`.
- **serverRepository** — доступ к таблице `servers`, маппинг строк в типизированные объекты.

## Поток лога

```
java stdout/stderr ──► processManager.handleOutput ──► logStore.append
                                                        ├─► файл logs/<id>/<date>.log
                                                        ├─► INSERT INTO log_index
                                                        └─► eventBus → WS-клиенты
```

## Web-интерфейс

- `api.ts` — тонкий клиент с JWT из localStorage; WS-URL строится с `?token=`, аватар-URL — с `?token=` для `<img>`.
- `auth.tsx` — контекст сессии (`Session = User`) и ролей; `updateUser` обновляет сессию после правок профиля.
- Страницы: `Login`, `Dashboard` (карточки серверов, создание; клик по username/аватару → `/settings`), `Account` (`/settings` — смена username/email, пароля, аватара), `ServerPage` (вкладки Console/Logs/Settings/Backups/Schedules), `Launcher` (сборка клиента: форма версии/лоадера/ника, список сборок с прогрессом, скачивание ZIP, модал с инструкцией для PojavLauncher).
- Vite dev-проксирует `/api` (включая ws) на `:8080`.
- Для доступа через интернет/NAT используется `vite preview` (`npm run preview -w web`): та же прокси-конфигурация (`preview.proxy`), но без HMR — статическая сборка `web/dist`, минимум соединений. Конфигурация вынесена в `web/vite.config.ts` (`server.proxy` и `preview.proxy` идентичны).

## Безопасность

- JWT подпись — `MC_AUTH_SECRET`; роли viewer < operator < admin.
- Хранение паролей — scrypt с солью.
- IPv6 вырезан намеренно (см. `docs/decisions.md`).
- В production `:8080` не должен быть открыт наружу напрямую.
