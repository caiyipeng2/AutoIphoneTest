import Database from "better-sqlite3";

import type { DeviceMetadata, ParsedDeviceState } from "@test-center/adb";
import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";

import { normalizeDeviceTags, type NormalizedDeviceTag } from "./device-tags.js";

export interface DeviceObservation {
  readonly serial: DeviceSerial;
  readonly state: ParsedDeviceState;
  readonly metadata?: Partial<DeviceMetadata> | Readonly<Record<string, unknown>>;
}

export interface DeviceRecord {
  readonly serial: DeviceSerial;
  readonly state: ParsedDeviceState;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly connectionSeq: number;
  readonly tags: readonly NormalizedDeviceTag[];
  readonly group?: NormalizedDeviceTag;
}

export interface DeviceHistoryRecord {
  readonly connectionSeq: number;
  readonly state: ParsedDeviceState;
  readonly observedAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface DeviceMutation {
  readonly record: DeviceRecord;
  readonly changed: boolean;
  readonly connectionChanged: boolean;
}

interface DeviceRow {
  serial: string;
  state: ParsedDeviceState;
  metadata_json: string;
  first_seen_at: string;
  last_seen_at: string;
  connection_seq: number;
}

interface HistoryRow {
  connection_seq: number;
  state: ParsedDeviceState;
  observed_at: string;
  metadata_json: string;
}

interface TagRow {
  tag_key: string;
  tag_label: string;
}

interface GroupRow {
  group_key: string;
  group_label: string;
}

const METADATA_IGNORED_KEYS = new Set(["serial", "errors"]);

export class DeviceRepository {
  public constructor(private readonly database: Database.Database) {}

  public upsert(
    observation: DeviceObservation,
    observedAt = new Date().toISOString(),
  ): DeviceMutation {
    const existing = this.selectDevice(observation.serial);
    if (existing === undefined) {
      const metadata = cleanMetadata(observation.metadata);
      const insert = this.database.transaction(() => {
        this.database
          .prepare(
            `INSERT INTO devices (serial, state, metadata_json, first_seen_at, last_seen_at, connection_seq, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            observation.serial,
            observation.state,
            serialize(metadata),
            observedAt,
            observedAt,
            observedAt,
            observedAt,
          );
        this.insertHistory(observation.serial, 1, observation.state, observedAt, metadata);
      });
      insert.immediate();
      return { record: this.require(observation.serial), changed: true, connectionChanged: true };
    }

    const previousMetadata = parseMetadata(existing.metadata_json);
    const metadata = mergeMetadata(previousMetadata, observation.metadata);
    const stateChanged = existing.state !== observation.state;
    const metadataChanged = serialize(previousMetadata) !== serialize(metadata);
    const nextSeq = stateChanged ? existing.connection_seq + 1 : existing.connection_seq;
    const update = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE devices
           SET state = ?, metadata_json = ?, last_seen_at = ?, connection_seq = ?, updated_at = ?
           WHERE serial = ?`,
        )
        .run(
          observation.state,
          serialize(metadata),
          observedAt,
          nextSeq,
          observedAt,
          observation.serial,
        );
      if (stateChanged)
        this.insertHistory(observation.serial, nextSeq, observation.state, observedAt, metadata);
    });
    update.immediate();
    return {
      record: this.require(observation.serial),
      changed: stateChanged || metadataChanged,
      connectionChanged: stateChanged,
    };
  }

  public markMissing(
    seenSerials: ReadonlySet<DeviceSerial>,
    observedAt = new Date().toISOString(),
  ): DeviceMutation[] {
    const rows = this.database
      .prepare<[], DeviceRow>(
        "SELECT serial, state, metadata_json, first_seen_at, last_seen_at, connection_seq FROM devices WHERE state IN ('ONLINE', 'UNAUTHORIZED')",
      )
      .all();
    return rows
      .filter((row) => !seenSerials.has(parseDeviceSerial(row.serial)))
      .map((row) =>
        this.upsert({ serial: parseDeviceSerial(row.serial), state: "OFFLINE" }, observedAt),
      );
  }

  public list(): DeviceRecord[] {
    return this.database
      .prepare<[], DeviceRow>(
        "SELECT serial, state, metadata_json, first_seen_at, last_seen_at, connection_seq FROM devices ORDER BY last_seen_at DESC, serial ASC",
      )
      .all()
      .map((row) => this.toRecord(row));
  }

  public get(serial: DeviceSerial): DeviceRecord | undefined {
    const row = this.selectDevice(serial);
    return row === undefined ? undefined : this.toRecord(row);
  }

  public history(serial: DeviceSerial): DeviceHistoryRecord[] {
    return this.database
      .prepare<[string], HistoryRow>(
        "SELECT connection_seq, state, observed_at, metadata_json FROM device_connections WHERE serial = ? ORDER BY id ASC",
      )
      .all(serial)
      .map((row) => ({
        connectionSeq: row.connection_seq,
        state: row.state,
        observedAt: row.observed_at,
        metadata: parseMetadata(row.metadata_json),
      }));
  }

  public setTags(
    serial: DeviceSerial,
    labels: readonly string[],
    group?: string,
    changedAt = new Date().toISOString(),
  ): DeviceRecord {
    if (this.selectDevice(serial) === undefined) throw new Error(`Unknown device '${serial}'.`);
    const normalized = normalizeDeviceTags(labels, group);
    const update = this.database.transaction(() => {
      this.database.prepare("DELETE FROM device_tags WHERE serial = ?").run(serial);
      const insertTag = this.database.prepare(
        "INSERT INTO device_tags (serial, tag_key, tag_label, created_at) VALUES (?, ?, ?, ?)",
      );
      for (const tag of normalized.tags) insertTag.run(serial, tag.key, tag.label, changedAt);
      this.database.prepare("DELETE FROM device_groups WHERE serial = ?").run(serial);
      if (normalized.group !== undefined) {
        this.database
          .prepare(
            "INSERT INTO device_groups (serial, group_key, group_label, updated_at) VALUES (?, ?, ?, ?)",
          )
          .run(serial, normalized.group.key, normalized.group.label, changedAt);
      }
      this.database
        .prepare("INSERT INTO audit_events (event_type, payload_json, created_at) VALUES (?, ?, ?)")
        .run(
          "device.tags.changed",
          JSON.stringify({ serial, tags: normalized.tags, group: normalized.group ?? null }),
          changedAt,
        );
    });
    update.immediate();
    return this.require(serial);
  }

  private selectDevice(serial: DeviceSerial): DeviceRow | undefined {
    return this.database
      .prepare<[string], DeviceRow>(
        "SELECT serial, state, metadata_json, first_seen_at, last_seen_at, connection_seq FROM devices WHERE serial = ?",
      )
      .get(serial);
  }

  private require(serial: DeviceSerial): DeviceRecord {
    const record = this.get(serial);
    if (record === undefined) throw new Error(`Device '${serial}' was not persisted.`);
    return record;
  }

  private toRecord(row: DeviceRow): DeviceRecord {
    const tags = this.database
      .prepare<[string], TagRow>(
        "SELECT tag_key, tag_label FROM device_tags WHERE serial = ? ORDER BY tag_key ASC",
      )
      .all(row.serial)
      .map((tag) => ({ key: tag.tag_key, label: tag.tag_label }));
    const group = this.database
      .prepare<[string], GroupRow>(
        "SELECT group_key, group_label FROM device_groups WHERE serial = ?",
      )
      .get(row.serial);
    return {
      serial: parseDeviceSerial(row.serial),
      state: row.state,
      metadata: parseMetadata(row.metadata_json),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      connectionSeq: row.connection_seq,
      tags,
      ...(group === undefined ? {} : { group: { key: group.group_key, label: group.group_label } }),
    };
  }

  private insertHistory(
    serial: DeviceSerial,
    connectionSeq: number,
    state: ParsedDeviceState,
    observedAt: string,
    metadata: Readonly<Record<string, unknown>>,
  ): void {
    this.database
      .prepare(
        "INSERT INTO device_connections (serial, connection_seq, state, observed_at, metadata_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(serial, connectionSeq, state, observedAt, serialize(metadata));
  }
}

function cleanMetadata(metadata: DeviceObservation["metadata"]): Record<string, unknown> {
  if (metadata === undefined) return {};
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key, value]) => !METADATA_IGNORED_KEYS.has(key) && value !== undefined,
    ),
  );
}

function mergeMetadata(
  previous: Readonly<Record<string, unknown>>,
  next: DeviceObservation["metadata"],
): Record<string, unknown> {
  return { ...previous, ...cleanMetadata(next) };
}

function parseMetadata(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function serialize(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(value);
}
