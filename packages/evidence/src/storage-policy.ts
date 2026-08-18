export const GIBIBYTE = 1024 ** 3;

export const DEFAULT_STORAGE_THRESHOLDS = {
  warningBytes: 20 * GIBIBYTE,
  dangerBytes: 5 * GIBIBYTE,
} as const;

export type StoragePressure = "NORMAL" | "WARNING" | "BLOCKED";

export type StorageOperation =
  "START_RUN" | "START_VIDEO" | "ACTION_WRITE" | "EVIDENCE_WRITE" | "REPORT_WRITE";

export interface StorageThresholds {
  readonly warningBytes: number;
  readonly dangerBytes: number;
}

export interface StoragePressureIncident {
  readonly category: "STORAGE_PRESSURE";
  readonly severity: Exclude<StoragePressure, "NORMAL">;
  readonly message: string;
  readonly freeBytes?: number;
}

export interface StorageDecision {
  readonly operation: StorageOperation;
  readonly pressure: StoragePressure;
  readonly allowed: boolean;
  readonly freeBytes?: number;
  readonly incident?: StoragePressureIncident;
}

/** Pure storage gate used by run/video creation and pressure-aware writes. */
export class StoragePolicy {
  private readonly thresholds: StorageThresholds;

  public constructor(thresholds: StorageThresholds = DEFAULT_STORAGE_THRESHOLDS) {
    if (!isPositiveInteger(thresholds.warningBytes) || !isPositiveInteger(thresholds.dangerBytes)) {
      throw new TypeError("Storage thresholds must be positive safe integers.");
    }
    if (thresholds.dangerBytes >= thresholds.warningBytes) {
      throw new TypeError("Storage dangerBytes must be below warningBytes.");
    }
    this.thresholds = { ...thresholds };
  }

  public classify(freeBytes: number | undefined): StoragePressure {
    if (freeBytes === undefined || !isValidFreeBytes(freeBytes)) return "BLOCKED";
    if (freeBytes < this.thresholds.dangerBytes) return "BLOCKED";
    if (freeBytes < this.thresholds.warningBytes) return "WARNING";
    return "NORMAL";
  }

  public decide(operation: StorageOperation, freeBytes: number | undefined): StorageDecision {
    const pressure = this.classify(freeBytes);
    const allowed = pressure !== "BLOCKED" || !startsNewData(operation);
    const incident =
      pressure === "NORMAL"
        ? undefined
        : {
            category: "STORAGE_PRESSURE" as const,
            severity: pressure,
            message:
              pressure === "BLOCKED"
                ? "Free space is below the danger threshold; new runs and videos are blocked."
                : "Free space is below the warning threshold.",
            ...(freeBytes === undefined ? {} : { freeBytes }),
          };
    return {
      operation,
      pressure,
      allowed,
      ...(freeBytes === undefined ? {} : { freeBytes }),
      ...(incident === undefined ? {} : { incident }),
    };
  }
}

function startsNewData(operation: StorageOperation): boolean {
  return operation === "START_RUN" || operation === "START_VIDEO";
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidFreeBytes(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
