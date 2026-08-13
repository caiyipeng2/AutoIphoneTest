import { z } from "zod";

export const IncidentCategorySchema = z.enum([
  "ADB_DISCONNECTED",
  "APPIUM_SESSION_LOST",
  "APP_CRASH_OR_ANR",
  "WRONG_FOREGROUND",
  "BRIDGE_TIMEOUT",
  "BRIDGE_STATE_MISMATCH",
  "TEXT_FOCUS_MISMATCH",
  "METRICS_CHANGED",
  "LOW_DISK",
]);
export type IncidentCategory = z.infer<typeof IncidentCategorySchema>;

export const FailurePolicySchema = z.enum(["PAUSE_ALL", "QUARANTINE_FAILED_DEVICE"]);
export type FailurePolicy = z.infer<typeof FailurePolicySchema>;

export const IncidentSchema = z
  .object({
    schemaVersion: z.literal(1),
    incidentId: z.string().regex(/^inc-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    runId: z.string().min(1).max(128),
    serial: z.string().min(1).max(256).optional(),
    category: IncidentCategorySchema,
    generation: z.number().int().positive().optional(),
    detectedAtRealtimeMs: z.number().finite().nonnegative(),
    detectedAt: z.string().datetime({ offset: true }),
    source: z.string().min(1).max(128),
    evidenceRef: z.string().min(1).max(512).optional(),
    details: z.record(z.string(), z.string()).default({}),
  })
  .strict();
export type Incident = z.infer<typeof IncidentSchema>;

export function parseIncident(value: unknown): Incident {
  return IncidentSchema.parse(value);
}
