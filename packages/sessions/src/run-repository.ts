import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import type { DeviceSerial } from "@test-center/contracts/device";
import { parseActionCommand, type ActionCommand } from "./action-command.js";

export type ActionType = ActionCommand["type"];

export interface TapActionPayload {
  readonly kind: "tap";
  readonly x: number;
  readonly y: number;
}

export interface SwipeActionPayload {
  readonly kind: "swipe";
  readonly path: readonly (readonly [number, number])[];
  readonly durationMs: number;
}

export type ActionPayload = TapActionPayload | SwipeActionPayload;

export interface CreateActionInput {
  readonly runId: string;
  readonly clientRequestId: string;
  readonly type: ActionType;
  readonly payload?: ActionPayload;
  readonly command?: ActionCommand;
  readonly sourceMetricsEpoch: number;
  readonly sourceFrameId?: string;
}

export interface ActionTargetView {
  readonly serial: DeviceSerial;
  readonly state: "QUEUED" | "DISPATCHING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN";
}

export interface ActionView {
  readonly id: string;
  readonly runId: string;
  readonly clientRequestId: string;
  readonly actionSeq: number;
  readonly type: ActionType;
  readonly payload?: ActionPayload;
  readonly command?: ActionCommand;
  readonly sourceMetricsEpoch: number;
  readonly sourceFrameId?: string;
  readonly state:
    "QUEUED" | "LEASED" | "DISPATCHING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN";
  readonly targets: readonly ActionTargetView[];
}

export interface CreateActionResult {
  readonly state: "CREATED" | "DEDUPLICATED";
  readonly action: ActionView;
}

interface ActionRow {
  readonly id: string;
  readonly run_id: string;
  readonly client_request_id: string;
  readonly action_seq: number;
  readonly action_type: "tap" | "swipe";
  readonly payload_json: string;
  readonly command_json: string | null;
  readonly state: ActionView["state"];
  readonly metrics_epoch: number;
}

interface TargetRow {
  readonly serial: string;
  readonly state: ActionTargetView["state"];
}

const NON_TERMINAL_STATES = ["QUEUED", "LEASED", "DISPATCHING"] as const;

export class RunActionRepository {
  public constructor(private readonly database: Database.Database) {}

  public create(input: CreateActionInput): CreateActionResult {
    validateCreateAction(input);
    const command = normalizeCommand(input);
    const payloadJson = canonicalJson({
      payload: input.payload ?? null,
      sourceFrameId: input.sourceFrameId ?? null,
    });
    const transaction = this.database.transaction(() => {
      const existing = this.database
        .prepare(
          `SELECT id, run_id, client_request_id, action_seq, action_type, payload_json, command_json, state, metrics_epoch
           FROM actions WHERE run_id = ? AND client_request_id = ?`,
        )
        .get(input.runId, input.clientRequestId) as ActionRow | undefined;
      if (existing !== undefined) {
        if (
          existing.action_type !== legacyActionType(command) ||
          existing.payload_json !== payloadJson ||
          existing.metrics_epoch !== input.sourceMetricsEpoch
        ) {
          throw new Error("Action client request already exists with a different payload.");
        }
        return { state: "DEDUPLICATED" as const, action: this.readAction(existing.id) };
      }

      const run = this.database
        .prepare("SELECT state, current_epoch FROM test_runs WHERE id = ?")
        .get(input.runId) as { state: string; current_epoch: number } | undefined;
      if (run === undefined) throw new Error("Run not found.");
      if (run.state !== "RUNNING")
        throw new Error("Actions are accepted only while the run is RUNNING.");

      const inFlight = this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM actions
           WHERE run_id = ? AND state IN (${NON_TERMINAL_STATES.map(() => "?").join(", ")})`,
        )
        .get(input.runId, ...NON_TERMINAL_STATES) as { count: number };
      if (inFlight.count > 0) throw new Error("A session action is already in flight.");

      const members = this.database
        .prepare(
          `SELECT serial FROM run_devices
           WHERE run_id = ? AND epoch = ? AND membership_state IN ('ACTIVE', 'RECOVERING')
           ORDER BY role = 'LEADER' DESC, serial ASC`,
        )
        .all(input.runId, run.current_epoch) as readonly { serial: string }[];
      if (members.length === 0) throw new Error("Run has no active devices.");

      const sequence = this.database
        .prepare("SELECT COALESCE(MAX(action_seq), 0) AS action_seq FROM actions WHERE run_id = ?")
        .get(input.runId) as { action_seq: number };
      const actionId = `act-${randomUUID()}`;
      const now = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO actions
           (id, run_id, action_seq, client_request_id, action_type, payload_json, command_json, state, metrics_epoch, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)`,
        )
        .run(
          actionId,
          input.runId,
          sequence.action_seq + 1,
          input.clientRequestId,
          legacyActionType(command),
          payloadJson,
          JSON.stringify(command),
          input.sourceMetricsEpoch,
          now,
          now,
        );
      for (const member of members) {
        this.database
          .prepare(
            `INSERT INTO action_targets (action_id, serial, state, created_at, updated_at)
             VALUES (?, ?, 'QUEUED', ?, ?)`,
          )
          .run(actionId, member.serial, now, now);
        this.database
          .prepare(
            `INSERT INTO device_action_results (action_id, serial, state, result_json, created_at, updated_at)
             VALUES (?, ?, 'PENDING', '{}', ?, ?)`,
          )
          .run(actionId, member.serial, now, now);
      }
      this.database
        .prepare(
          `INSERT INTO action_outbox
           (action_id, state, attempt_count, created_at, updated_at)
           VALUES (?, 'QUEUED', 0, ?, ?)`,
        )
        .run(actionId, now, now);
      this.database
        .prepare(
          `INSERT INTO action_transitions (action_id, from_state, to_state, reason, created_at)
           VALUES (?, NULL, 'QUEUED', 'ACTION_ACCEPTED', ?)`,
        )
        .run(actionId, now);
      return { state: "CREATED" as const, action: this.readAction(actionId) };
    });
    return transaction();
  }

  public get(actionId: string): ActionView | undefined {
    const row = this.database
      .prepare(
        `SELECT id, run_id, client_request_id, action_seq, action_type, payload_json, command_json, state, metrics_epoch
         FROM actions WHERE id = ?`,
      )
      .get(actionId) as ActionRow | undefined;
    return row === undefined ? undefined : this.readAction(row.id);
  }

  private readAction(actionId: string): ActionView {
    const row = this.database
      .prepare(
        `SELECT id, run_id, client_request_id, action_seq, action_type, payload_json, command_json, state, metrics_epoch
         FROM actions WHERE id = ?`,
      )
      .get(actionId) as ActionRow | undefined;
    if (row === undefined) throw new Error("Action could not be read back.");
    const envelope = JSON.parse(row.payload_json) as {
      payload: ActionPayload | null;
      sourceFrameId: string | null;
    };
    const command =
      row.command_json === null
        ? legacyCommand(row.action_type, envelope.payload)
        : parseActionCommand(JSON.parse(row.command_json));
    const targets = this.database
      .prepare("SELECT serial, state FROM action_targets WHERE action_id = ? ORDER BY serial ASC")
      .all(actionId) as readonly TargetRow[];
    return {
      id: row.id,
      runId: row.run_id,
      clientRequestId: row.client_request_id,
      actionSeq: row.action_seq,
      type: command.type,
      command,
      ...(envelope.payload === null ? {} : { payload: envelope.payload }),
      sourceMetricsEpoch: row.metrics_epoch,
      ...(envelope.sourceFrameId === null ? {} : { sourceFrameId: envelope.sourceFrameId }),
      state: row.state,
      targets: targets.map((target) => ({
        serial: target.serial as DeviceSerial,
        state: target.state,
      })),
    };
  }
}

function validateCreateAction(input: CreateActionInput): void {
  if (!input.runId.trim() || !input.clientRequestId.trim())
    throw new TypeError("Action runId and clientRequestId are required.");
  if (input.clientRequestId.length > 128)
    throw new TypeError("Action clientRequestId is too long.");
  if (!Number.isSafeInteger(input.sourceMetricsEpoch) || input.sourceMetricsEpoch < 0) {
    throw new TypeError("Action sourceMetricsEpoch must be a non-negative integer.");
  }
  const command = normalizeCommand(input);
  if (command.type === "tap") {
    if (input.payload?.kind !== "tap")
      throw new TypeError("Tap action payload does not match its type.");
    assertCoordinate(input.payload.x, "tap.x");
    assertCoordinate(input.payload.y, "tap.y");
  } else if (command.type === "swipe" || command.type === "drag") {
    if (input.payload?.kind !== "swipe")
      throw new TypeError("Swipe action payload does not match its type.");
    if (input.payload.path.length < 2 || input.payload.path.length > 64)
      throw new TypeError("Swipe path must contain 2-64 points.");
    for (const [x, y] of input.payload.path) {
      assertCoordinate(x, "swipe.x");
      assertCoordinate(y, "swipe.y");
    }
    if (
      !Number.isSafeInteger(input.payload.durationMs) ||
      input.payload.durationMs < 1 ||
      input.payload.durationMs > 60_000
    ) {
      throw new TypeError("Swipe durationMs must be an integer from 1 to 60000.");
    }
  }
  if (command.type !== "tap" && command.type !== "swipe" && input.payload !== undefined) {
    throw new TypeError("Lifecycle action must not contain a payload.");
  }
  if (
    input.sourceFrameId !== undefined &&
    (!input.sourceFrameId.trim() || input.sourceFrameId.length > 128)
  ) {
    throw new TypeError("Action sourceFrameId is invalid.");
  }
}

function normalizeCommand(input: CreateActionInput): ActionCommand {
  const command =
    input.command ??
    (input.payload === undefined
      ? parseActionCommand({ type: input.type })
      : input.payload.kind === "tap"
        ? parseActionCommand({ type: "tap", x: input.payload.x, y: input.payload.y })
        : parseActionCommand({
            type: "swipe",
            path: input.payload.path,
            durationMs: input.payload.durationMs,
          }));
  if (command.type !== input.type)
    throw new TypeError("Action command type does not match action type.");
  return command;
}

function legacyActionType(command: ActionCommand): "tap" | "swipe" {
  return command.type === "swipe" ? "swipe" : "tap";
}

function legacyCommand(_type: "tap" | "swipe", payload: ActionPayload | null): ActionCommand {
  if (payload === null) throw new Error("Legacy action payload is missing.");
  return payload.kind === "tap"
    ? parseActionCommand({ type: "tap", x: payload.x, y: payload.y })
    : parseActionCommand({ type: "swipe", path: payload.path, durationMs: payload.durationMs });
}

function assertCoordinate(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be a finite normalized coordinate from 0 to 1.`);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
