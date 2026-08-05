import type { DeviceSerial } from "@test-center/contracts/device";
import { ALLOWLISTED_GETPROP_KEYS, type AdbCommand, type GetPropKey } from "./commands.js";

export type MetadataField =
  | "model"
  | "product"
  | "device"
  | "manufacturer"
  | "androidRelease"
  | "apiLevel"
  | "abiList"
  | "physicalSize"
  | "overrideSize"
  | "physicalDensity"
  | "overrideDensity"
  | "batteryPercentage"
  | "charging"
  | "orientation";

export interface DeviceMetadataError {
  readonly field: MetadataField;
  readonly category: "COMMAND_FAILED" | "FIELD_UNAVAILABLE" | "INVALID_VALUE";
  readonly message: string;
}

export interface DeviceSize {
  readonly width: number;
  readonly height: number;
}

export interface DisplayFacts {
  readonly width?: number;
  readonly height?: number;
  readonly density?: number;
  readonly rotation?: number;
  readonly state?: string;
}

export interface DeviceMetadata {
  readonly serial: DeviceSerial;
  readonly model?: string;
  readonly product?: string;
  readonly device?: string;
  readonly manufacturer?: string;
  readonly androidRelease?: string;
  readonly apiLevel?: number;
  readonly abiList?: readonly string[];
  readonly physicalSize?: DeviceSize;
  readonly overrideSize?: DeviceSize;
  readonly physicalDensity?: number;
  readonly overrideDensity?: number;
  readonly batteryPercentage?: number;
  readonly charging?: boolean;
  readonly orientation?: 0 | 90 | 180 | 270;
  readonly displayFacts?: DisplayFacts;
  readonly errors: readonly DeviceMetadataError[];
}

type MutableDeviceMetadata = { -readonly [K in keyof DeviceMetadata]?: DeviceMetadata[K] };

export interface MetadataCommandResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface MetadataExecutor {
  execute(command: AdbCommand): Promise<MetadataCommandResult>;
}

interface CollectionTask {
  readonly fields: readonly MetadataField[];
  readonly command: AdbCommand;
  readonly apply: (stdout: string, values: MutableDeviceMetadata) => void;
}

export async function collectDeviceMetadata(
  serial: DeviceSerial,
  executor: MetadataExecutor,
): Promise<DeviceMetadata> {
  const values: MutableDeviceMetadata = { serial };
  const errors: DeviceMetadataError[] = [];
  const tasks = createTasks(serial);
  await runWithLimit(tasks, 4, async (task) => {
    try {
      const result = await executor.execute(task.command);
      if (result.timedOut || result.exitCode !== 0) {
        addErrors(errors, task.fields, "COMMAND_FAILED", describeFailure(task.command, result));
        return;
      }
      const before = { ...values };
      task.apply(result.stdout, values);
      for (const field of task.fields) {
        if (!hasField(values, field)) {
          addErrors(
            errors,
            [field],
            "FIELD_UNAVAILABLE",
            `${field} was not present in ADB output.`,
          );
        }
      }
      if (
        task.fields.includes("orientation") &&
        values.orientation === undefined &&
        before.orientation !== undefined
      ) {
        values.orientation = before.orientation;
      }
    } catch (error) {
      addErrors(
        errors,
        task.fields,
        "COMMAND_FAILED",
        error instanceof Error ? error.message : "ADB command failed.",
      );
    }
  });
  return { ...values, serial, errors };
}

function createTasks(serial: DeviceSerial): CollectionTask[] {
  const propertyFields: Record<GetPropKey, MetadataField> = {
    "ro.product.model": "model",
    "ro.product.name": "product",
    "ro.product.device": "device",
    "ro.product.manufacturer": "manufacturer",
    "ro.build.version.release": "androidRelease",
    "ro.build.version.sdk": "apiLevel",
    "ro.product.cpu.abilist": "abiList",
  };
  const propertyTasks = ALLOWLISTED_GETPROP_KEYS.map((key) => ({
    fields: [propertyFields[key]] as const,
    command: { kind: "getProp", serial, key } as const,
    apply: (stdout: string, values: MutableDeviceMetadata) => {
      const value = stdout.trim();
      if (!value) return;
      const field = propertyFields[key];
      if (field === "apiLevel") values.apiLevel = Number(value);
      else if (field === "abiList")
        values.abiList = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      else values[field] = value as never;
    },
  }));
  return [
    ...propertyTasks,
    {
      fields: ["physicalSize", "overrideSize"] as const,
      command: { kind: "wmSize", serial },
      apply: (stdout, values) => {
        const parsed = parseSizes(stdout);
        if (parsed.physical !== undefined) values.physicalSize = parsed.physical;
        if (parsed.override !== undefined) values.overrideSize = parsed.override;
      },
    },
    {
      fields: ["physicalDensity", "overrideDensity"] as const,
      command: { kind: "wmDensity", serial },
      apply: (stdout, values) => {
        const parsed = parseDensities(stdout);
        if (parsed.physical !== undefined) values.physicalDensity = parsed.physical;
        if (parsed.override !== undefined) values.overrideDensity = parsed.override;
      },
    },
    {
      fields: ["batteryPercentage", "charging"] as const,
      command: { kind: "dumpsysBattery", serial },
      apply: (stdout, values) => {
        const level = stdout.match(/\blevel:\s*(\d{1,3})\b/i)?.[1];
        const status = stdout.match(/\bstatus:\s*(\d+)\b/i)?.[1];
        const acPowered = stdout.match(/\bAC powered:\s*(true|false)\b/i)?.[1];
        if (level !== undefined && Number(level) >= 0 && Number(level) <= 100)
          values.batteryPercentage = Number(level);
        if (status !== undefined) values.charging = [2, 5].includes(Number(status));
        else if (acPowered !== undefined) values.charging = acPowered === "true";
      },
    },
    {
      fields: ["orientation"] as const,
      command: { kind: "dumpsysDisplay", serial },
      apply: (stdout, values) => {
        const orientation = stdout.match(/mCurrentOrientation\s*=\s*([0-3])/i)?.[1];
        if (orientation !== undefined)
          values.orientation = (Number(orientation) * 90) as 0 | 90 | 180 | 270;
        const displayFacts = parseDisplayFacts(stdout);
        if (Object.keys(displayFacts).length > 0) values.displayFacts = displayFacts;
      },
    },
  ];
}

function parseSizes(stdout: string): { physical?: DeviceSize; override?: DeviceSize } {
  const physical = parseSize(stdout, "Physical size");
  const override = parseSize(stdout, "Override size");
  return {
    ...(physical === undefined ? {} : { physical }),
    ...(override === undefined ? {} : { override }),
  };
}

function parseSize(stdout: string, label: string): DeviceSize | undefined {
  const match = stdout.match(new RegExp(`${label}:\\s*(\\d+)x(\\d+)`, "i"));
  return match === null ? undefined : { width: Number(match[1]), height: Number(match[2]) };
}

function parseDensities(stdout: string): { physical?: number; override?: number } {
  const physical = parseDensity(stdout, "Physical density");
  const override = parseDensity(stdout, "Override density");
  return {
    ...(physical === undefined ? {} : { physical }),
    ...(override === undefined ? {} : { override }),
  };
}

function parseDensity(stdout: string, label: string): number | undefined {
  const match = stdout.match(new RegExp(`${label}:\\s*(\\d+)`, "i"));
  return match === null ? undefined : Number(match[1]);
}

function parseDisplayFacts(stdout: string): DisplayFacts {
  const info = stdout.match(
    /(\d+)\s*x\s*(\d+).*?density\s+([\d.]+).*?rotation\s+(\d+).*?state\s+([A-Z]+)/i,
  );
  return {
    ...(info === null
      ? {}
      : {
          width: Number(info[1]),
          height: Number(info[2]),
          density: Number(info[3]),
          rotation: Number(info[4]),
          state: info[5],
        }),
  };
}

function hasField(values: Partial<DeviceMetadata>, field: MetadataField): boolean {
  const value = values[field];
  return value !== undefined && (!Array.isArray(value) || value.length > 0);
}

function addErrors(
  errors: DeviceMetadataError[],
  fields: readonly MetadataField[],
  category: DeviceMetadataError["category"],
  message: string,
): void {
  for (const field of fields)
    if (!errors.some((error) => error.field === field)) errors.push({ field, category, message });
}

function describeFailure(command: AdbCommand, result: MetadataCommandResult): string {
  return `${command.kind} failed with exitCode=${String(result.exitCode)}${result.stderr.trim() ? `: ${result.stderr.trim()}` : "."}`;
}

async function runWithLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const consume = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
}
