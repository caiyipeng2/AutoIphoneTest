import { createHash } from "node:crypto";

import {
  BridgeDescriptorSchema,
  QaAckSchema,
  QaArmedSchema,
  QaErrorSchema,
  QaHelloSchema,
  QaPongSchema,
  QaRejectedSchema,
  QaStateSchema,
  type BridgeDescriptor,
  type BridgeMessage,
  type BridgeHash,
} from "@test-center/contracts/bridge";

const MAX_LINE_LENGTH = 16 * 1024;
const DEFAULT_DIAGNOSTIC_LIMIT = 32;

export type BridgeProtocolErrorCode =
  | "INVALID_JSON"
  | "LINE_TOO_LARGE"
  | "MESSAGE_UNSUPPORTED"
  | "SCHEMA_VERSION_UNSUPPORTED"
  | "INVALID_MESSAGE"
  | "FOCUS_UNAVAILABLE"
  | "STATE_SEQUENCE_REPLAY"
  | "RUN_NONCE_MISMATCH"
  | "ARM_EXPIRED"
  | "ARM_NOT_FOUND"
  | "BRIDGE_INSTANCE_MISMATCH"
  | "DESCRIPTOR_MISMATCH"
  | "EVENT_SHAPE_MISMATCH"
  | "VIEW_MISMATCH"
  | "FOCUS_MISMATCH"
  | "METRICS_EPOCH_MISMATCH";

export interface BridgeProtocolError {
  readonly code: BridgeProtocolErrorCode;
  readonly message: string;
}

export type BridgeParseResult =
  | { readonly ok: true; readonly message: BridgeMessage }
  | { readonly ok: false; readonly error: BridgeProtocolError };

export interface BridgeProtocolParserOptions {
  readonly expectedRunNonceHash?: BridgeHash;
  readonly expectedEventShapeHash?: BridgeHash;
  readonly nowRealtimeMs?: () => number;
  readonly maxDiagnosticEntries?: number;
  readonly diagnosticSink?: (entry: string) => void;
}

export class BridgeProtocolParser {
  private readonly nowRealtimeMs: () => number;
  private readonly diagnostics: string[] = [];
  private readonly diagnosticLimit: number;
  private readonly activeArms = new Map<string, ArmedMessage>();
  private readonly lastStateSeq = new Map<string, number>();
  private currentBridgeInstanceId: string | undefined;

  public constructor(private readonly options: BridgeProtocolParserOptions = {}) {
    this.nowRealtimeMs = options.nowRealtimeMs ?? (() => Date.now());
    this.diagnosticLimit = options.maxDiagnosticEntries ?? DEFAULT_DIAGNOSTIC_LIMIT;
    if (!Number.isSafeInteger(this.diagnosticLimit) || this.diagnosticLimit <= 0) {
      throw new TypeError("maxDiagnosticEntries must be positive.");
    }
  }

  public parseLine(line: string): BridgeParseResult {
    if (line.length > MAX_LINE_LENGTH) {
      return this.reject(
        "LINE_TOO_LARGE",
        "Bridge message exceeded the maximum line length.",
        line,
      );
    }

    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      return this.reject("INVALID_JSON", "Bridge message is not valid JSON.", line);
    }
    if (!isRecord(value)) {
      return this.reject("INVALID_MESSAGE", "Bridge message must be a JSON object.", line);
    }
    if (value.schemaVersion !== 1) {
      return this.reject(
        "SCHEMA_VERSION_UNSUPPORTED",
        "Bridge schema version is unsupported.",
        line,
      );
    }

    const type = value.type;
    if (typeof type !== "string" || !isSupportedType(type)) {
      return this.reject("MESSAGE_UNSUPPORTED", "Bridge message type is unsupported.", line);
    }

    const parsed = schemaFor(type).safeParse(value);
    if (!parsed.success) {
      return this.reject("INVALID_MESSAGE", "Bridge message does not match its schema.", line);
    }
    const message = parsed.data as BridgeMessage;

    if (message.type === "QA_HELLO") return this.acceptHello(message);
    if (message.type === "QA_STATE") return this.acceptState(message, line);
    if (message.type === "QA_ARMED") return this.acceptArmed(message, line);
    if (message.type === "QA_ACK") return this.acceptAck(message, line);
    if (message.type === "QA_REJECTED") {
      if (message.actionId !== undefined) this.activeArms.delete(message.actionId);
    }
    return { ok: true, message };
  }

  public getDiagnostics(): readonly string[] {
    return [...this.diagnostics];
  }

  private acceptHello(message: Extract<BridgeMessage, { type: "QA_HELLO" }>): BridgeParseResult {
    if (this.currentBridgeInstanceId !== message.bridgeInstanceId) {
      this.currentBridgeInstanceId = message.bridgeInstanceId;
      this.activeArms.clear();
      this.lastStateSeq.clear();
    }
    return { ok: true, message };
  }

  private acceptState(
    message: Extract<BridgeMessage, { type: "QA_STATE" }>,
    line: string,
  ): BridgeParseResult {
    if (message.textInputAvailable && message.focusedControlId == null) {
      return this.reject(
        "FOCUS_UNAVAILABLE",
        "Text-capable state must report focusedControlId.",
        line,
      );
    }
    const previous = this.lastStateSeq.get(message.bridgeInstanceId);
    if (previous !== undefined && message.stateSeq <= previous) {
      return this.reject(
        "STATE_SEQUENCE_REPLAY",
        "QA_STATE stateSeq must increase within a bridge instance.",
        line,
      );
    }
    this.lastStateSeq.set(message.bridgeInstanceId, message.stateSeq);
    return { ok: true, message };
  }

  private acceptArmed(message: ArmedMessage, line: string): BridgeParseResult {
    if (
      this.options.expectedRunNonceHash !== undefined &&
      message.runNonceHash !== this.options.expectedRunNonceHash
    ) {
      return this.reject(
        "RUN_NONCE_MISMATCH",
        "QA_ARMED run nonce hash does not match the active run.",
        line,
      );
    }
    if (
      this.options.expectedEventShapeHash !== undefined &&
      message.expectedEventShapeHash !== this.options.expectedEventShapeHash
    ) {
      return this.reject(
        "EVENT_SHAPE_MISMATCH",
        "QA_ARMED event shape hash does not match the active descriptor.",
        line,
      );
    }
    if (BigInt(message.expiresAtRealtimeMs) <= BigInt(Math.floor(this.nowRealtimeMs()))) {
      return this.reject("ARM_EXPIRED", "QA_ARMED lease has already expired.", line);
    }
    if (
      this.currentBridgeInstanceId !== undefined &&
      this.currentBridgeInstanceId !== message.bridgeInstanceId
    ) {
      return this.reject("BRIDGE_INSTANCE_MISMATCH", "QA_ARMED bridge instance is stale.", line);
    }
    this.currentBridgeInstanceId = message.bridgeInstanceId;
    this.activeArms.set(message.actionId, message);
    return { ok: true, message };
  }

  private acceptAck(
    message: Extract<BridgeMessage, { type: "QA_ACK" }>,
    line: string,
  ): BridgeParseResult {
    const armed = this.activeArms.get(message.actionId);
    if (armed === undefined) return this.reject("ARM_NOT_FOUND", "QA_ACK has no active arm.", line);
    if (armed.bridgeInstanceId !== message.bridgeInstanceId)
      return this.reject("BRIDGE_INSTANCE_MISMATCH", "QA_ACK bridge instance is stale.", line);
    if (BigInt(armed.expiresAtRealtimeMs) <= BigInt(Math.floor(this.nowRealtimeMs())))
      return this.reject("ARM_EXPIRED", "QA_ACK arrived after the arm expired.", line);
    if (armed.descriptorHash !== message.descriptorHash)
      return this.reject(
        "DESCRIPTOR_MISMATCH",
        "QA_ACK descriptor hash does not match QA_ARMED.",
        line,
      );
    if (armed.expectedEventShapeHash !== message.eventShapeHash)
      return this.reject(
        "EVENT_SHAPE_MISMATCH",
        "QA_ACK event shape hash does not match QA_ARMED.",
        line,
      );
    if (armed.expectedView !== message.view)
      return this.reject("VIEW_MISMATCH", "QA_ACK view does not match QA_ARMED.", line);
    if (armed.expectedFocus !== (message.focusedControlId ?? null))
      return this.reject("FOCUS_MISMATCH", "QA_ACK focus does not match QA_ARMED.", line);
    if (armed.metricsEpoch !== message.metricsEpoch)
      return this.reject(
        "METRICS_EPOCH_MISMATCH",
        "QA_ACK metrics epoch does not match QA_ARMED.",
        line,
      );
    this.activeArms.delete(message.actionId);
    return { ok: true, message };
  }

  private reject(
    code: BridgeProtocolErrorCode,
    message: string,
    rawLine?: string,
  ): BridgeParseResult {
    if (rawLine !== undefined) this.recordDiagnostic(rawLine, code);
    return { ok: false, error: { code, message } };
  }

  private recordDiagnostic(rawLine: string, code: BridgeProtocolErrorCode): void {
    const entry = `${code}: ${redactDiagnostic(rawLine).slice(0, 512)}`;
    this.diagnostics.push(entry);
    while (this.diagnostics.length > this.diagnosticLimit) this.diagnostics.shift();
    this.options.diagnosticSink?.(entry);
  }
}

export function parseBridgeLine(
  line: string,
  options: BridgeProtocolParserOptions = {},
): BridgeParseResult {
  return new BridgeProtocolParser(options).parseLine(line);
}

export function canonicalizeBridgeDescriptor(input: BridgeDescriptor): string {
  const descriptor = BridgeDescriptorSchema.parse(input);
  return canonicalizeValue(descriptor);
}

export function hashBridgeDescriptor(input: BridgeDescriptor): BridgeHash {
  return `sha256:${createHash("sha256").update(canonicalizeBridgeDescriptor(input), "utf8").digest("hex")}` as BridgeHash;
}

type SupportedType = BridgeMessage["type"];
type ArmedMessage = Extract<BridgeMessage, { type: "QA_ARMED" }>;

function isSupportedType(value: string): value is SupportedType {
  return [
    "QA_HELLO",
    "QA_STATE",
    "QA_ARMED",
    "QA_ACK",
    "QA_REJECTED",
    "QA_PONG",
    "QA_ERROR",
  ].includes(value);
}

function schemaFor(type: SupportedType) {
  switch (type) {
    case "QA_HELLO":
      return QaHelloSchema;
    case "QA_STATE":
      return QaStateSchema;
    case "QA_ARMED":
      return QaArmedSchema;
    case "QA_ACK":
      return QaAckSchema;
    case "QA_REJECTED":
      return QaRejectedSchema;
    case "QA_PONG":
      return QaPongSchema;
    case "QA_ERROR":
      return QaErrorSchema;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalizeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Descriptor contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeValue(entry)}`)
      .join(",")}}`;
  }
  throw new TypeError("Descriptor contains an unsupported value.");
}

function redactDiagnostic(value: string): string {
  return value.replace(/("(?:nonce|hmac|token|password)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2");
}
