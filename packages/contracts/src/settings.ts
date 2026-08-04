import { win32 } from "node:path";

import { z } from "zod";

export const SettingKeySchema = z.enum([
  "dataRoot",
  "serverPortRange",
  "appiumPortRange",
  "diskThresholds",
  "defaultPausePolicy",
  "defaultEvidencePolicy",
  "retentionDays",
]);

export const PortRangeSchema = z
  .object({
    start: z.number().int().min(1024).max(65535),
    end: z.number().int().min(1024).max(65535),
  })
  .refine((value) => value.start <= value.end, "Port range start must be at or below end.");

export const DiskThresholdsSchema = z
  .object({ warningBytes: z.number().int().positive(), dangerBytes: z.number().int().positive() })
  .strict();

export const DefaultPausePolicySchema = z.enum(["pause-all", "quarantine-failed-device"]);
export const DefaultEvidencePolicySchema = z.enum(["html-zip", "html-zip-json"]);
export const RetentionDaysSchema = z.number().int().min(1).max(3650);

export const SettingValueSchema = z.union([
  z
    .string()
    .refine(
      (value) =>
        win32.isAbsolute(value) &&
        win32.parse(value).root !== "\\" &&
        win32.parse(value).root !== "/",
      "dataRoot must be a fully qualified Windows path.",
    ),
  PortRangeSchema,
  DiskThresholdsSchema,
  DefaultPausePolicySchema,
  DefaultEvidencePolicySchema,
  RetentionDaysSchema,
]);

export interface SettingValue {
  readonly dataRoot: string;
  readonly serverPortRange: z.infer<typeof PortRangeSchema>;
  readonly appiumPortRange: z.infer<typeof PortRangeSchema>;
  readonly diskThresholds: z.infer<typeof DiskThresholdsSchema>;
  readonly defaultPausePolicy: z.infer<typeof DefaultPausePolicySchema>;
  readonly defaultEvidencePolicy: z.infer<typeof DefaultEvidencePolicySchema>;
  readonly retentionDays: number;
}

export type SettingKey = z.infer<typeof SettingKeySchema>;
