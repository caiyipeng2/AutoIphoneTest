import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { win32 } from "node:path";

import type { MultipartFile } from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppArtifact, InstalledArtifact } from "@test-center/contracts/artifact";
import { parseAndroidPackageName } from "@test-center/contracts/artifact";
import { parseDeviceSerial, type DeviceSerial } from "@test-center/contracts/device";
import type { BuildEvent, BuildProvider, BuildRequest } from "@test-center/build-provider";
import {
  assertAllowedHost,
  assertSameOrigin,
  assertValidCsrf,
} from "@test-center/security/request-policy";

import { requireSession } from "./bootstrap.js";
import type { ServerContext } from "./context.js";

const ArtifactQuerySchema = z.object({
  kind: z.enum(["APK", "AAB", "INSTALLED"]).optional(),
  q: z.string().trim().max(200).optional(),
});
const InstalledRegistrationSchema = z
  .object({
    deviceSerial: z.string().min(1),
    packageName: z.string().min(1),
  })
  .strict();

export interface InstalledRegistrationResult {
  readonly artifact: InstalledArtifact;
  readonly state: "CREATED" | "DEDUPLICATED";
}

export interface ArtifactRouteService {
  readonly provider: BuildProvider;
  list(): readonly AppArtifact[];
  get(id: string): AppArtifact | undefined;
  registerInstalled(input: {
    readonly deviceSerial: DeviceSerial;
    readonly packageName: string;
  }): Promise<InstalledRegistrationResult>;
}

export const MAX_ARTIFACT_UPLOAD_BYTES = 1024 * 1024 * 1024;

export async function registerArtifactsRoutes(
  app: FastifyInstance,
  context: ServerContext,
  importRoot: string,
): Promise<void> {
  const normalizedImportRoot = win32.normalize(importRoot);
  await mkdir(normalizedImportRoot, { recursive: true });

  app.get<{ Querystring: { kind?: string; q?: string } }>(
    "/api/artifacts",
    async (request, reply) => {
      if (requireSession(request, context) === undefined) {
        return await reply.code(401).send({ error: "Authentication required." });
      }
      if (context.artifacts === undefined) {
        return await reply.code(503).send({ error: "Artifact service unavailable." });
      }
      try {
        const query = ArtifactQuerySchema.parse(request.query);
        const artifacts = filterArtifacts(context.artifacts.list(), query.kind, query.q);
        return { schemaVersion: 1, artifacts };
      } catch (error) {
        return await reply.code(400).send({
          error: error instanceof Error ? error.message : "Artifact query rejected.",
        });
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/artifacts/:id", async (request, reply) => {
    if (requireSession(request, context) === undefined) {
      return await reply.code(401).send({ error: "Authentication required." });
    }
    const artifact = context.artifacts?.get(decodeURIComponent(request.params.id));
    if (artifact === undefined) return await reply.code(404).send({ error: "Artifact not found." });
    return { schemaVersion: 1, artifact };
  });

  app.post("/api/artifacts/import", async (request, reply) => {
    let uploadedPath: string | undefined;
    let importDirectory: string | undefined;
    try {
      assertMutationAllowed(request, context);
      if (context.artifacts === undefined) {
        return await reply.code(503).send({ error: "Artifact service unavailable." });
      }
      const upload = await receiveUpload(request, normalizedImportRoot);
      uploadedPath = upload.path;
      const selectedSource = resolveImportSource(normalizedImportRoot, upload.fields.importSource);
      await mkdir(selectedSource, { recursive: true });
      importDirectory = selectedSource;
      const finalPath = win32.join(selectedSource, `${randomUUID()}-${upload.originalName}`);
      await rename(upload.path, finalPath);
      uploadedPath = finalPath;
      const kind = parseArtifactKind(upload.fields.kind, upload.originalName);
      const events: BuildEvent[] = [];
      const buildRequest: BuildRequest = {
        providerId: context.artifacts.provider.id,
        kind,
        importSource: selectedSource,
        artifactPath: finalPath,
        originalName: upload.originalName,
      };
      const result = await context.artifacts.provider.build(buildRequest, (event) => {
        events.push(event);
      });
      return {
        schemaVersion: 1,
        state: result.artifact.publishState,
        buildId: result.buildId,
        artifact: result.artifact,
        events,
      };
    } catch (error) {
      return await reply.code(errorCode(error)).send({
        error: error instanceof Error ? error.message : "Artifact import rejected.",
      });
    } finally {
      if (uploadedPath !== undefined)
        await rm(uploadedPath, { force: true }).catch(() => undefined);
      if (importDirectory !== undefined) {
        await removeEmptyDirectory(importDirectory);
      }
    }
  });

  app.post("/api/artifacts/installed", async (request, reply) => {
    try {
      assertMutationAllowed(request, context);
      if (context.artifacts === undefined) {
        return await reply.code(503).send({ error: "Artifact service unavailable." });
      }
      const payload = InstalledRegistrationSchema.parse(request.body);
      const deviceSerial = parseDeviceSerial(payload.deviceSerial);
      const device = context.devices?.get(deviceSerial);
      if (device === undefined) return await reply.code(404).send({ error: "Device not found." });
      if (device.state !== "ONLINE") {
        return await reply.code(409).send({ error: "Device must be online." });
      }
      const result = await context.artifacts.registerInstalled({
        deviceSerial,
        packageName: parseAndroidPackageName(payload.packageName),
      });
      return { schemaVersion: 1, state: result.state, artifact: result.artifact };
    } catch (error) {
      return await reply.code(errorCode(error)).send({
        error: error instanceof Error ? error.message : "Installed artifact rejected.",
      });
    }
  });
}

function assertMutationAllowed(request: FastifyRequest, context: ServerContext): void {
  assertAllowedHost(request.headers.host, context.port);
  assertSameOrigin(request.headers.origin, context.port);
  if (requireSession(request, context) === undefined) {
    throw new Error("Authentication required.");
  }
  const csrfHeader = request.headers["x-test-center-csrf"];
  assertValidCsrf(request.cookies.tc_csrf, Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader);
}

async function receiveUpload(
  request: FastifyRequest,
  root: string,
): Promise<{ path: string; originalName: string; fields: Record<string, string> }> {
  const directory = win32.join(root, `.upload-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  let path: string | undefined;
  try {
    const fields: Record<string, string> = {};
    let file: MultipartFile | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (file !== undefined) throw new TypeError("Only one artifact file is allowed.");
        file = part;
        const originalName = sanitizeFilename(part.filename);
        path = win32.join(directory, originalName);
        await pipeline(part.file, createWriteStream(path, { flags: "wx" }));
        if (part.file.truncated) throw new UploadTooLargeError();
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (file === undefined || path === undefined) throw new TypeError("Artifact file is required.");
    return { path, originalName: sanitizeFilename(file.filename), fields };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function parseArtifactKind(value: string | undefined, filename: string): "APK" | "AAB" {
  if (value !== undefined) return z.enum(["APK", "AAB"]).parse(value);
  const extension = win32.extname(filename).toLowerCase();
  if (extension === ".apk") return "APK";
  if (extension === ".aab") return "AAB";
  throw new TypeError("Artifact filename must end with .apk or .aab.");
}

function resolveImportSource(root: string, value: string | undefined): string {
  const candidate =
    value === undefined || value.trim() === ""
      ? root
      : win32.isAbsolute(value)
        ? win32.normalize(value)
        : win32.normalize(win32.join(root, value));
  if (!isWithin(root, candidate))
    throw new TypeError("importSource must remain below the configured import root.");
  return candidate;
}

function filterArtifacts(
  artifacts: readonly AppArtifact[],
  kind: "APK" | "AAB" | "INSTALLED" | undefined,
  query: string | undefined,
): AppArtifact[] {
  const normalizedQuery = query?.toLowerCase();
  return artifacts.filter((artifact) => {
    if (kind !== undefined && artifact.kind !== kind) return false;
    if (normalizedQuery === undefined || normalizedQuery === "") return true;
    const values =
      artifact.kind === "INSTALLED"
        ? [
            artifact.id,
            artifact.kind,
            artifact.packageName,
            artifact.versionName,
            artifact.deviceSerial,
          ]
        : [
            artifact.id,
            artifact.kind,
            artifact.packageName,
            artifact.versionName,
            artifact.originalName,
          ];
    return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
  });
}

function sanitizeFilename(filename: string): string {
  const base = win32.basename(filename).trim();
  const sanitized = Array.from(base)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127 && !/[<>:"/\\|?*]/.test(character);
    })
    .join("");
  if (sanitized === "" || sanitized === "." || sanitized === "..") {
    throw new TypeError("Artifact filename is invalid.");
  }
  return sanitized.slice(0, 128);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = win32.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${win32.sep}`) && relative !== ".." && !win32.isAbsolute(relative))
  );
}

async function removeEmptyDirectory(path: string): Promise<void> {
  const entries = await stat(path)
    .then(async () => await readdir(path))
    .catch(() => [] as string[]);
  if (entries.length === 0) await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

class UploadTooLargeError extends Error {
  public constructor() {
    super("Artifact upload exceeds the configured size limit.");
    this.name = "UploadTooLargeError";
  }
}

function errorCode(error: unknown): 400 | 401 | 403 | 409 | 413 | 500 | 503 {
  if (error instanceof UploadTooLargeError) return 413;
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "FST_REQ_FILE_TOO_LARGE"
  ) {
    return 413;
  }
  if (error instanceof Error && error.message === "Authentication required.") return 401;
  if (error instanceof Error && error.message.includes("CSRF")) return 403;
  if (error instanceof Error && error.message.includes("must be online")) return 409;
  if (error instanceof Error && error.message.includes("unavailable")) return 503;
  return 400;
}
