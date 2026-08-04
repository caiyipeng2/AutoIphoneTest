import { DeviceSerialSchema, type DeviceSerial } from "@test-center/contracts/device";

export type ParsedDeviceState = "ONLINE" | "UNAUTHORIZED" | "OFFLINE" | "UNKNOWN";

export interface ParsedAdbDevice {
  readonly serial: DeviceSerial;
  readonly state: ParsedDeviceState;
  readonly model?: string;
  readonly product?: string;
  readonly device?: string;
  readonly transportId?: string;
  readonly facts: Readonly<Record<string, string>>;
}

export function parseDevicesOutput(output: string): ParsedAdbDevice[] {
  const devices = new Map<string, ParsedAdbDevice>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^List of devices attached$/i.test(line) || /^\* daemon\b/i.test(line)) {
      continue;
    }
    const columns = line.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
    if (columns === null) continue;
    const rawState = columns[2];
    if (rawState === undefined) continue;
    const serialResult = DeviceSerialSchema.safeParse(columns[1]);
    if (!serialResult.success) continue;
    const serial = serialResult.data as DeviceSerial;
    const state = parseState(rawState);
    const facts = parseFacts(columns[3] ?? "");
    const next: ParsedAdbDevice = {
      serial,
      state,
      facts,
      ...(facts.model === undefined ? {} : { model: facts.model }),
      ...(facts.product === undefined ? {} : { product: facts.product }),
      ...(facts.device === undefined ? {} : { device: facts.device }),
      ...(facts.transport_id === undefined ? {} : { transportId: facts.transport_id }),
    };
    const previous = devices.get(serial);
    devices.set(serial, previous === undefined ? next : mergeDevice(previous, next));
  }
  return [...devices.values()];
}

function parseState(value: string): ParsedDeviceState {
  switch (value.toLowerCase()) {
    case "device":
      return "ONLINE";
    case "unauthorized":
      return "UNAUTHORIZED";
    case "offline":
      return "OFFLINE";
    default:
      return "UNKNOWN";
  }
}

function parseFacts(descriptor: string): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const token of descriptor.split(/\s+/)) {
    const separator = token.indexOf(":");
    if (separator <= 0 || separator === token.length - 1) continue;
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (/^[a-z][a-z0-9_]*$/i.test(key)) facts[key] = value;
  }
  return facts;
}

function mergeDevice(previous: ParsedAdbDevice, next: ParsedAdbDevice): ParsedAdbDevice {
  const facts = { ...previous.facts, ...next.facts };
  return {
    ...previous,
    state: next.state,
    facts,
    ...(facts.model === undefined ? {} : { model: facts.model }),
    ...(facts.product === undefined ? {} : { product: facts.product }),
    ...(facts.device === undefined ? {} : { device: facts.device }),
    ...(facts.transport_id === undefined ? {} : { transportId: facts.transport_id }),
  };
}
