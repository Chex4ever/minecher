# Источники версий

Код: `server/src/versions/*`. Интерфейс — `VersionSource`:

```ts
interface VersionSource {
  type: ServerType;
  listVersions(): Promise<string[]>;
  listLoaderVersions(mcVersion: string): Promise<string[]>;
  resolveJar(version: string, loaderVersion?: string): Promise<string>;
}
```

`DownloadService` (`server/src/services/download.ts`) качает по `resolveJar` в кэш `data/versions/<type>/<version[-loader]>.jar` (скачивание через временный файл + rename).

## Vanilla
- Список версий: `GET https://launchermeta.mojang.com/mc/game/version_manifest_v2.json` → `versions[]` с `type === "release"`.
- Jar: из `versions[].url` → `downloads.server.url`.
- Порядок в ответе — как в манифесте (новые выше). Не реверсить.

## Paper
- **Только Fill v3.** `https://fill.papermc.io/v3/projects/paper`. Старый `api.papermc.io/v2` отвечает 410 и использовать его нельзя.
- Список версий: `versions` — объект вида `{ "<группа>": [ "1.21.11", ... ] }`; все значения сгруппированы по семействам и сортируются по semver по убыванию.
- Jar: `GET /v3/projects/paper/versions/<mc>/builds` → массив сборок → первая с `channel === "STABLE"` → `downloads["server:default"].url` (ключ `application` в v3 больше не используется).
- Обязателен валидный `User-Agent` с контактом (см. `source.ts`), иначе — отказ/рейт-лимит.

## Spigot
- Список: `GET https://api.getbukkit.org/v2/projects/spigot` (имя проекта) → `GET .../projects/<project>` → `versions[]`.
- Jar: `https://download.getbukkit.org/spigot/spigot-<version>.jar`.

## Forge
- Maven: `https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml` (XML-парсинг регулярками `<version>`).
- MC-версии — префикс до первого `-`; лоадеры — полные версии вида `1.20.1-47.2.0`.
- Jar: installer `https://maven.minecraftforge.net/.../forge-<full>/forge-<full>-installer.jar`; при первом старте выполняется `--installServer`.

## Fabric
- Мета: `https://meta.fabricmc.net/v2/versions` → `game[]`, `loader[]`, `installer[]`.
- MC-версии: `game[]` со `stable === true`; лоадеры: `loader[].version`.
- Jar (прямая ссылка): `https://meta.fabricmc.net/v2/versions/loader/<mc>/<loader>/<installer>/server/jar`.

## Custom
- «Свой сервер»: пустой источник (`listVersions: []`, `listLoaderVersions: []`).
- `resolveJar` бросает `VersionSourceError` — jar не скачивается, старт требует существующий `server.jar`/`fabric-server.jar` в рабочей директории (используется для импортированных серверов).

## Общее
- Таймаут запросов 30с (AbortController).
- Кэширование в памяти не реализовано; при повторных запросах списков происходит новый HTTP-вызов.
- Ошибки источников оборачиваются в `VersionSourceError`; маршруты `/api/versions/*` отвечают `502`.
