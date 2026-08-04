import { win32 } from "node:path";

import Database from "better-sqlite3";
import { z } from "zod";

import {
  DefaultEvidencePolicySchema,
  DefaultPausePolicySchema,
  DiskThresholdsSchema,
  PortRangeSchema,
  RetentionDaysSchema,
  SettingKeySchema,
  type SettingKey,
  type SettingValue,
} from "@test-center/contracts/settings";

const DataRootSchema = z
  .string()
  .refine(
    (value) =>
      win32.isAbsolute(value) &&
      win32.parse(value).root !== "\\" &&
      win32.parse(value).root !== "/",
    "dataRoot must be a fully qualified Windows path.",
  );

const SETTING_SCHEMAS: Record<SettingKey, z.ZodTypeAny> = {
  dataRoot: DataRootSchema,
  serverPortRange: PortRangeSchema,
  appiumPortRange: PortRangeSchema,
  diskThresholds: DiskThresholdsSchema,
  defaultPausePolicy: DefaultPausePolicySchema,
  defaultEvidencePolicy: DefaultEvidencePolicySchema,
  retentionDays: RetentionDaysSchema,
};

export function getSetting<K extends SettingKey>(
  database: Database.Database,
  key: K,
): SettingValue[K] | undefined {
  const row = database
    .prepare<[string], { value_json: string }>("SELECT value_json FROM settings WHERE key = ?")
    .get(key);
  if (row === undefined) {
    return undefined;
  }
  return SETTING_SCHEMAS[key].parse(JSON.parse(row.value_json)) as SettingValue[K];
}

export function setSetting<K extends SettingKey>(
  database: Database.Database,
  key: K | string,
  value: unknown,
): void {
  const parsedKey = SettingKeySchema.safeParse(key);
  if (!parsedKey.success) {
    throw new TypeError(`Unknown setting '${key}'.`);
  }
  const typedKey = parsedKey.data;
  let parsedValue: SettingValue[typeof typedKey];
  try {
    parsedValue = SETTING_SCHEMAS[typedKey].parse(value) as SettingValue[typeof typedKey];
  } catch (error) {
    throw new TypeError(
      `Invalid setting '${typedKey}': ${error instanceof Error ? error.message : "invalid value"}`,
      {
        cause: error,
      },
    );
  }
  validateCrossSetting(database, typedKey, parsedValue);
  database
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(typedKey, JSON.stringify(parsedValue), new Date().toISOString());
}

function validateCrossSetting<K extends SettingKey>(
  database: Database.Database,
  key: K,
  value: SettingValue[K],
): void {
  if (key === "diskThresholds") {
    const thresholds = value as SettingValue["diskThresholds"];
    if (thresholds.dangerBytes >= thresholds.warningBytes) {
      throw new TypeError("diskThresholds.dangerBytes must be below warningBytes.");
    }
  }
  if (key === "serverPortRange" || key === "appiumPortRange") {
    const otherKey = key === "serverPortRange" ? "appiumPortRange" : "serverPortRange";
    const other = getSetting(database, otherKey);
    if (
      other !== undefined &&
      rangesOverlap(
        value as SettingValue["serverPortRange"],
        other as SettingValue["appiumPortRange"],
      )
    ) {
      throw new TypeError("serverPortRange and appiumPortRange must not overlap.");
    }
  }
}

function rangesOverlap(
  left: SettingValue["serverPortRange"],
  right: SettingValue["appiumPortRange"],
): boolean {
  return left.start <= right.end && right.start <= left.end;
}
