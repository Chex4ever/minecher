import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import type { EventBus } from "./eventBus.js";
import type { LogStore } from "./logStore.js";
import type { DownloadService } from "./download.js";
import type { ServerRepository } from "./serverRepository.js";
import type { ProcessManager } from "./processManager.js";
import type { BackupService } from "./backups.js";
import type { ImportService } from "./imports.js";
import type { RconClient } from "./rcon.js";
import type { SchedulerService } from "./scheduler.js";

export interface AppContext {
  config: AppConfig;
  db: Db;
  events: EventBus;
  logs: LogStore;
  downloads: DownloadService;
  servers: ServerRepository;
  processes: ProcessManager;
  backups: BackupService;
  imports: ImportService;
  rcon: RconClient;
  scheduler: SchedulerService;
}
