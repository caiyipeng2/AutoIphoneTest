import Database from "better-sqlite3";

import { configureDatabase } from "./migrations.js";
import type { RuntimePaths } from "./runtime-paths.js";

export function openDatabase(paths: RuntimePaths): Database.Database {
  const database = new Database(paths.databasePath);
  configureDatabase(database);
  return database;
}
