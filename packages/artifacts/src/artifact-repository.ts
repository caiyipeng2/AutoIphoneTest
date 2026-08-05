import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import {
  AppArtifactSchema,
  InstalledArtifactSchema,
  type ArtifactMetadata,
  type InstalledArtifact,
  type SourceArtifact,
} from "@test-center/contracts/artifact";

import { ContentStore, type PublishedContent, type StagedContent } from "./content-store.js";
import type { InstalledIdentity } from "./installed-identity.js";

export interface SourceArtifactInput {
  readonly kind: "APK" | "AAB";
  readonly metadata?: ArtifactMetadata;
}

export interface ArtifactPublishResult {
  readonly artifact: SourceArtifact;
  readonly state: "CREATED" | "DEDUPLICATED";
}

export interface InstalledArtifactResult {
  readonly artifact: InstalledArtifact;
  readonly state: "CREATED" | "DEDUPLICATED";
}

interface ArtifactRow {
  id: string;
  kind: "APK" | "AAB";
  sha256: string;
  size_bytes: number;
  stored_path: string;
  original_name: string;
  package_name: string | null;
  version_name: string | null;
  version_code: number | null;
  signer_sha256: string | null;
  created_at: string;
}

export class ArtifactRepository {
  public constructor(
    private readonly database: Database.Database,
    private readonly store: ContentStore,
  ) {}

  public async publishSource(
    staged: StagedContent,
    input: SourceArtifactInput,
    createdAt = new Date().toISOString(),
  ): Promise<ArtifactPublishResult> {
    const published = await this.store.publish(staged);
    const existing = this.findSource(input.kind, published.sha256);
    if (existing !== undefined) {
      await this.recordAttempt(
        input.kind,
        published.originalName,
        published.sha256,
        "DEDUPLICATED",
        undefined,
        createdAt,
      );
      return { artifact: this.toArtifact(existing), state: "DEDUPLICATED" };
    }

    const artifact = createSourceArtifact(published, input, createdAt);
    try {
      const insert = this.database.transaction(() => {
        this.database
          .prepare(
            "INSERT INTO artifact_contents (sha256, size_bytes, stored_path, original_name, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            published.sha256,
            published.sizeBytes,
            published.storedPath,
            published.originalName,
            createdAt,
          );
        this.database
          .prepare(
            `INSERT INTO artifacts (id, kind, sha256, package_name, version_name, version_code, signer_sha256, metadata_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            artifact.id,
            artifact.kind,
            artifact.sha256,
            artifact.packageName ?? null,
            artifact.versionName ?? null,
            artifact.versionCode ?? null,
            artifact.signerSha256 ?? null,
            JSON.stringify(input.metadata ?? {}),
            artifact.createdAt,
          );
        this.database
          .prepare(
            "INSERT INTO artifact_import_attempts (kind, original_name, sha256, state, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(input.kind, published.originalName, published.sha256, "PUBLISHED", createdAt);
      });
      insert.immediate();
      return { artifact, state: "CREATED" };
    } catch (error) {
      await this.store.removePublished(published);
      await this.recordAttempt(
        input.kind,
        published.originalName,
        published.sha256,
        "FAILED",
        error instanceof Error ? error.message : "Artifact metadata transaction failed.",
        createdAt,
      );
      throw error;
    }
  }

  public list(): SourceArtifact[] {
    return this.database
      .prepare<[], ArtifactRow>(
        `SELECT a.id, a.kind, a.sha256, c.size_bytes, c.stored_path, c.original_name,
                a.package_name, a.version_name, a.version_code, a.signer_sha256, a.created_at
         FROM artifacts a JOIN artifact_contents c ON c.sha256 = a.sha256
         WHERE a.kind IN ('APK', 'AAB') ORDER BY a.created_at DESC`,
      )
      .all()
      .map((row) => this.toArtifact(row));
  }

  public registerInstalled(
    identity: InstalledIdentity,
    createdAt = new Date().toISOString(),
  ): InstalledArtifactResult {
    const existing = this.database
      .prepare<
        [string, string, number, string, string],
        {
          id: string;
          device_serial: string;
          package_name: string;
          version_name: string;
          version_code: number;
          signer_sha256: string;
          installed_set_sha256: string;
          observed_at: string;
          created_at: string;
        }
      >(
        `SELECT id, device_serial, package_name, version_name, version_code, signer_sha256,
                installed_set_sha256, observed_at, created_at
         FROM artifacts
         WHERE kind = 'INSTALLED' AND device_serial = ? AND package_name = ? AND version_code = ?
           AND signer_sha256 = ? AND installed_set_sha256 = ?`,
      )
      .get(
        identity.deviceSerial,
        identity.packageName,
        identity.versionCode,
        identity.signerSha256,
        identity.installedSetSha256,
      );
    if (existing !== undefined) {
      return { artifact: this.toInstalledArtifact(existing), state: "DEDUPLICATED" };
    }
    const artifact = InstalledArtifactSchema.parse({
      id: randomUUID(),
      kind: "INSTALLED",
      deviceSerial: identity.deviceSerial,
      packageName: identity.packageName,
      versionName: identity.versionName,
      versionCode: identity.versionCode,
      signerSha256: identity.signerSha256,
      installedSetSha256: identity.installedSetSha256,
      observedAt: identity.observedAt,
      createdAt,
    }) as InstalledArtifact;
    const insert = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO artifacts (id, kind, device_serial, package_name, version_name, version_code, signer_sha256, installed_set_sha256, observed_at, metadata_json, created_at)
           VALUES (?, 'INSTALLED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          artifact.id,
          artifact.deviceSerial,
          artifact.packageName,
          artifact.versionName,
          artifact.versionCode,
          artifact.signerSha256,
          artifact.installedSetSha256,
          artifact.observedAt,
          JSON.stringify({}),
          artifact.createdAt,
        );
      this.database
        .prepare(
          "INSERT INTO artifact_import_attempts (kind, state, created_at) VALUES ('INSTALLED', 'PUBLISHED', ?)",
        )
        .run(createdAt);
    });
    insert.immediate();
    return { artifact, state: "CREATED" };
  }

  public listInstalled(): InstalledArtifact[] {
    return this.database
      .prepare<
        [],
        {
          id: string;
          device_serial: string;
          package_name: string;
          version_name: string;
          version_code: number;
          signer_sha256: string;
          installed_set_sha256: string;
          observed_at: string;
          created_at: string;
        }
      >(
        `SELECT id, device_serial, package_name, version_name, version_code, signer_sha256,
                installed_set_sha256, observed_at, created_at
         FROM artifacts WHERE kind = 'INSTALLED' ORDER BY created_at DESC`,
      )
      .all()
      .map((row) => this.toInstalledArtifact(row));
  }

  private findSource(kind: SourceArtifactInput["kind"], sha256: string): ArtifactRow | undefined {
    return this.database
      .prepare<[string, string], ArtifactRow>(
        `SELECT a.id, a.kind, a.sha256, c.size_bytes, c.stored_path, c.original_name,
                a.package_name, a.version_name, a.version_code, a.signer_sha256, a.created_at
         FROM artifacts a JOIN artifact_contents c ON c.sha256 = a.sha256
         WHERE a.kind = ? AND a.sha256 = ?`,
      )
      .get(kind, sha256);
  }

  private toArtifact(row: ArtifactRow): SourceArtifact {
    return AppArtifactSchema.parse({
      id: row.id,
      kind: row.kind,
      sha256: row.sha256,
      sizeBytes: row.size_bytes,
      storedPath: row.stored_path,
      originalName: row.original_name,
      ...(row.package_name === null ? {} : { packageName: row.package_name }),
      ...(row.version_name === null ? {} : { versionName: row.version_name }),
      ...(row.version_code === null ? {} : { versionCode: row.version_code }),
      ...(row.signer_sha256 === null ? {} : { signerSha256: row.signer_sha256 }),
      createdAt: row.created_at,
    }) as SourceArtifact;
  }

  private toInstalledArtifact(row: {
    id: string;
    device_serial: string;
    package_name: string;
    version_name: string;
    version_code: number;
    signer_sha256: string;
    installed_set_sha256: string;
    observed_at: string;
    created_at: string;
  }): InstalledArtifact {
    return InstalledArtifactSchema.parse({
      id: row.id,
      kind: "INSTALLED",
      deviceSerial: row.device_serial,
      packageName: row.package_name,
      versionName: row.version_name,
      versionCode: row.version_code,
      signerSha256: row.signer_sha256,
      installedSetSha256: row.installed_set_sha256,
      observedAt: row.observed_at,
      createdAt: row.created_at,
    }) as InstalledArtifact;
  }

  private async recordAttempt(
    kind: SourceArtifactInput["kind"],
    originalName: string,
    sha256: string,
    state: "DEDUPLICATED" | "FAILED",
    errorMessage: string | undefined,
    createdAt: string,
  ): Promise<void> {
    try {
      this.database
        .prepare(
          "INSERT INTO artifact_import_attempts (kind, original_name, sha256, state, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(kind, originalName, sha256, state, errorMessage ?? null, createdAt);
    } catch {
      // The original transaction error is the useful failure when the database is unavailable.
    }
  }
}

function createSourceArtifact(
  published: PublishedContent,
  input: SourceArtifactInput,
  createdAt: string,
): SourceArtifact {
  return AppArtifactSchema.parse({
    id: randomUUID(),
    kind: input.kind,
    sha256: published.sha256,
    sizeBytes: published.sizeBytes,
    storedPath: published.storedPath,
    originalName: published.originalName,
    ...(input.metadata?.packageName === undefined
      ? {}
      : { packageName: input.metadata.packageName }),
    ...(input.metadata?.versionName === undefined
      ? {}
      : { versionName: input.metadata.versionName }),
    ...(input.metadata?.versionCode === undefined
      ? {}
      : { versionCode: input.metadata.versionCode }),
    ...(input.metadata?.signerSha256 === undefined
      ? {}
      : { signerSha256: input.metadata.signerSha256 }),
    createdAt,
  }) as SourceArtifact;
}
