import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BuildProvider, BuildRequest, BuildResult } from "@test-center/build-provider";
import type { AppArtifact, InstalledArtifact } from "@test-center/contracts/artifact";
import { parseDeviceSerial } from "@test-center/contracts/device";
import { DeviceRepository, DeviceRegistry } from "@test-center/devices";
import Database from "better-sqlite3";
import {
  configureDatabase,
  DEVICES_MIGRATION,
  FOUNDATION_MIGRATION,
  migrate,
} from "@test-center/database/migrations";

import { createApp } from "../app.js";
import type { ArtifactRouteService } from "./artifacts.js";

const roots: string[] = [];
const databases: Database.Database[] = [];
const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function sourceArtifact(): AppArtifact {
  return {
    id: "artifact-1",
    kind: "APK",
    sha256: digest,
    sizeBytes: 7,
    storedPath: "sha256/01/game.apk",
    originalName: "game.apk",
    packageName: "com.example.game",
    versionName: "1.4.2",
    versionCode: 42,
    signerSha256: digest,
    createdAt: "2026-08-05T12:00:00.000Z",
  };
}

function installedArtifact(): InstalledArtifact {
  return {
    id: "installed-1",
    kind: "INSTALLED",
    deviceSerial: parseDeviceSerial("R5CX211TXNT"),
    packageName: "com.example.game",
    versionName: "1.4.2",
    versionCode: 42,
    signerSha256: digest,
    installedSetSha256: digest,
    observedAt: "2026-08-05T12:00:00.000Z",
    createdAt: "2026-08-05T12:00:00.000Z",
  };
}

function createService(
  additionalProviders: readonly BuildProvider[] = [],
): ArtifactRouteService & { lastBuild: BuildRequest | undefined } {
  const artifacts = [sourceArtifact(), installedArtifact()];
  let lastBuild: BuildRequest | undefined;
  const provider: BuildProvider = {
    id: "artifact-import",
    validate: () => ({ valid: true, errors: [] }),
    build: async (request): Promise<BuildResult> => {
      lastBuild = request;
      await stat(request.artifactPath);
      return {
        buildId: "build-1",
        artifact: {
          artifactId: "artifact-1",
          kind: "APK",
          sha256: digest,
          packageName: "com.example.game",
          versionName: "1.4.2",
          versionCode: 42,
          publishState: "DEDUPLICATED",
        },
      };
    },
    cancel: async () => undefined,
  };
  return {
    provider,
    providers: [provider, ...additionalProviders],
    list: () => artifacts,
    get: (id) => artifacts.find((artifact) => artifact.id === id),
    registerInstalled: async () => ({
      artifact: installedArtifact(),
      state: "DEDUPLICATED",
    }),
    get lastBuild() {
      return lastBuild;
    },
  };
}

function multipartBody(boundary: string): string {
  return [
    `--${boundary}`,
    'Content-Disposition: form-data; name="kind"',
    "",
    "APK",
    `--${boundary}`,
    'Content-Disposition: form-data; name="importSource"',
    "",
    "",
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="game.apk"',
    "Content-Type: application/vnd.android.package-archive",
    "",
    "apk-bytes",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function authenticatedHeaders(
  app: Awaited<ReturnType<typeof createApp>>,
  port: number,
  code = "artifacts-bootstrap",
) {
  const base = { host: `127.0.0.1:${String(port)}`, origin: `http://127.0.0.1:${String(port)}` };
  const exchange = await app.inject({
    method: "POST",
    url: "/api/bootstrap/exchange",
    headers: base,
    payload: { code },
  });
  const cookies = exchange.headers["set-cookie"];
  const cookieHeader = Array.isArray(cookies)
    ? cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ")
    : cookies;
  const csrf = Array.isArray(cookies)
    ? cookies
        .find((cookie) => cookie.startsWith("tc_csrf="))
        ?.split("=", 2)[1]
        ?.split(";", 1)[0]
    : undefined;
  return { ...base, cookie: cookieHeader, "x-test-center-csrf": csrf };
}

describe("artifact routes", () => {
  it("lists artifacts, streams an import, and registers an online installed identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-artifact-route-"));
    roots.push(root);
    const database = new Database(":memory:");
    databases.push(database);
    configureDatabase(database);
    migrate(database, [FOUNDATION_MIGRATION, DEVICES_MIGRATION]);
    const repository = new DeviceRepository(database);
    repository.upsert({ serial: parseDeviceSerial("R5CX211TXNT"), state: "ONLINE", metadata: {} });
    const registry = new DeviceRegistry(repository, { discover: async () => [] });
    const service = createService();
    const port = 4782;
    const app = await createApp({
      port,
      bootstrapCode: "artifacts-bootstrap",
      launchSecret: "artifacts-secret",
      deviceRegistry: registry,
      artifactService: service,
      artifactImportRoot: root,
    });
    const headers = await authenticatedHeaders(app, port);

    const list = await app.inject({ method: "GET", url: "/api/artifacts", headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().artifacts).toHaveLength(2);
    expect(list.json().artifacts[1]).not.toHaveProperty("storedPath");
    const installedOnly = await app.inject({
      method: "GET",
      url: "/api/artifacts?kind=INSTALLED",
      headers,
    });
    expect(installedOnly.statusCode).toBe(200);
    expect(installedOnly.json().artifacts).toHaveLength(1);
    const detail = await app.inject({
      method: "GET",
      url: "/api/artifacts/installed-1",
      headers,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().artifact).not.toHaveProperty("storedPath");

    const boundary = "task5-boundary";
    const imported = await app.inject({
      method: "POST",
      url: "/api/artifacts/import",
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary),
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({
      state: "DEDUPLICATED",
      artifact: { artifactId: "artifact-1" },
    });
    expect(service.lastBuild?.kind).toBe("APK");
    await expect(readFile(service.lastBuild?.artifactPath ?? "")).rejects.toBeDefined();

    const installed = await app.inject({
      method: "POST",
      url: "/api/artifacts/installed",
      headers: { ...headers, "content-type": "application/json" },
      payload: { deviceSerial: "R5CX211TXNT", packageName: "com.example.game" },
    });
    expect(installed.statusCode).toBe(200);
    expect(installed.json()).toMatchObject({
      state: "DEDUPLICATED",
      artifact: { kind: "INSTALLED" },
    });
    await app.close();
  });

  it("lists the default and optional build providers without leaking configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-provider-route-"));
    roots.push(root);
    const port = 4784;
    const app = await createApp({
      port,
      bootstrapCode: "providers-bootstrap",
      launchSecret: "providers-secret",
      artifactService: createService(),
      artifactImportRoot: root,
    });
    const headers = await authenticatedHeaders(app, port, "providers-bootstrap");

    const providers = await app.inject({ method: "GET", url: "/api/artifacts/providers", headers });

    expect(providers.statusCode).toBe(200);
    expect(providers.json()).toEqual({
      schemaVersion: 1,
      providers: [{ id: "artifact-import", default: true }],
    });
    expect(JSON.stringify(providers.json())).not.toContain("storedPath");
    expect(JSON.stringify(providers.json())).not.toContain("artifactPath");
    await app.close();
  });

  it("protects provider discovery with the existing session boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-provider-auth-"));
    roots.push(root);
    const port = 4785;
    const app = await createApp({
      port,
      bootstrapCode: "providers-auth-bootstrap",
      launchSecret: "providers-auth-secret",
      artifactService: createService(),
      artifactImportRoot: root,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/artifacts/providers",
      headers: { host: `127.0.0.1:${String(port)}` },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("preflights a selected provider without starting its build", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-provider-preflight-"));
    roots.push(root);
    let received: BuildRequest | undefined;
    const commandProvider: BuildProvider = {
      id: "unity-command",
      validate: async (request) => {
        received = request;
        return {
          valid: false,
          errors: [
            {
              code: "UNITY_PROJECT_NOT_FOUND",
              message: "Unity projectPath does not exist.",
            },
          ],
        };
      },
      build: async () => {
        throw new Error("preflight must not start the build");
      },
      cancel: async () => undefined,
    };
    const port = 4787;
    const app = await createApp({
      port,
      bootstrapCode: "provider-preflight-bootstrap",
      launchSecret: "provider-preflight-secret",
      artifactService: createService([commandProvider]),
      artifactImportRoot: root,
    });
    const headers = await authenticatedHeaders(app, port, "provider-preflight-bootstrap");

    const response = await app.inject({
      method: "POST",
      url: "/api/artifacts/build/validate",
      headers: { ...headers, "content-type": "application/json" },
      payload: {
        providerId: "unity-command",
        kind: "AAB",
        importSource: "Builds",
        artifactPath: "Builds/game.aab",
        originalName: "game.aab",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      providerId: "unity-command",
      valid: false,
      errors: [
        {
          code: "UNITY_PROJECT_NOT_FOUND",
          message: "Unity projectPath does not exist.",
        },
      ],
    });
    expect(received).toMatchObject({
      providerId: "unity-command",
      kind: "AAB",
      importSource: win32.join(root, "Builds"),
      artifactPath: win32.join(root, "Builds", "game.aab"),
      originalName: "game.aab",
    });
    await app.close();
  });

  it("selects a provider, resolves relative paths below the import root, and returns events", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-provider-build-"));
    roots.push(root);
    let received: BuildRequest | undefined;
    const commandProvider: BuildProvider = {
      id: "unity-command",
      validate: () => ({ valid: true, errors: [] }),
      build: async (request, sink): Promise<BuildResult> => {
        received = request;
        await sink({
          buildId: "command-build-1",
          phase: "validate",
          status: "completed",
          at: "2026-08-25T03:00:00.000Z",
        });
        await sink({
          buildId: "command-build-1",
          phase: "build",
          status: "completed",
          at: "2026-08-25T03:00:01.000Z",
        });
        return {
          buildId: "command-build-1",
          artifact: {
            artifactId: "artifact-command-1",
            kind: "APK",
            sha256: digest,
            publishState: "CREATED",
          },
        };
      },
      cancel: async () => undefined,
    };
    const port = 4786;
    const app = await createApp({
      port,
      bootstrapCode: "provider-build-bootstrap",
      launchSecret: "provider-build-secret",
      artifactService: createService([commandProvider]),
      artifactImportRoot: root,
    });
    const headers = await authenticatedHeaders(app, port, "provider-build-bootstrap");

    const response = await app.inject({
      method: "POST",
      url: "/api/artifacts/build",
      headers: { ...headers, "content-type": "application/json" },
      payload: {
        providerId: "unity-command",
        kind: "APK",
        importSource: "Builds",
        artifactPath: "Builds/game.apk",
        originalName: "game.apk",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 1,
      buildId: "command-build-1",
      artifact: { artifactId: "artifact-command-1" },
      events: [
        { phase: "validate", status: "completed" },
        { phase: "build", status: "completed" },
      ],
    });
    expect(received).toMatchObject({
      providerId: "unity-command",
      importSource: win32.join(root, "Builds"),
      artifactPath: win32.join(root, "Builds", "game.apk"),
    });
    await app.close();
  });

  it("uses the configured import root when importSource is omitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-provider-build-default-"));
    roots.push(root);
    let received: BuildRequest | undefined;
    const provider: BuildProvider = {
      id: "default-source-provider",
      validate: () => ({ valid: true, errors: [] }),
      build: async (request): Promise<BuildResult> => {
        received = request;
        return {
          buildId: "default-source-build-1",
          artifact: {
            artifactId: "artifact-default-source-1",
            kind: "APK",
            sha256: digest,
            publishState: "DEDUPLICATED",
          },
        };
      },
      cancel: async () => undefined,
    };
    const port = 4788;
    const app = await createApp({
      port,
      bootstrapCode: "provider-build-default-bootstrap",
      launchSecret: "provider-build-default-secret",
      artifactService: createService([provider]),
      artifactImportRoot: root,
    });
    const headers = await authenticatedHeaders(app, port, "provider-build-default-bootstrap");

    const response = await app.inject({
      method: "POST",
      url: "/api/artifacts/build",
      headers: { ...headers, "content-type": "application/json" },
      payload: {
        providerId: "default-source-provider",
        kind: "APK",
        artifactPath: "game.apk",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(received?.importSource).toBe(win32.normalize(root));
    await app.close();
  });

  it("rejects unknown providers and paths outside the import root", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-provider-build-safe-"));
    roots.push(root);
    const service = createService();
    const port = 4787;
    const app = await createApp({
      port,
      bootstrapCode: "provider-build-safe-bootstrap",
      launchSecret: "provider-build-safe-secret",
      artifactService: service,
      artifactImportRoot: root,
    });
    const headers = await authenticatedHeaders(app, port, "provider-build-safe-bootstrap");
    const unknown = await app.inject({
      method: "POST",
      url: "/api/artifacts/build",
      headers: { ...headers, "content-type": "application/json" },
      payload: {
        providerId: "missing",
        kind: "APK",
        artifactPath: "game.apk",
      },
    });
    expect(unknown.statusCode).toBe(404);

    const escaped = await app.inject({
      method: "POST",
      url: "/api/artifacts/build",
      headers: { ...headers, "content-type": "application/json" },
      payload: {
        providerId: "artifact-import",
        kind: "APK",
        importSource: "..",
        artifactPath: "..\\outside.apk",
      },
    });
    expect(escaped.statusCode).toBe(400);
    expect(service.lastBuild).toBeUndefined();
    await app.close();
  });

  it("rejects missing CSRF and maps a truncated upload to 413", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-center-artifact-limit-"));
    roots.push(root);
    const port = 4783;
    const app = await createApp({
      port,
      bootstrapCode: "artifacts-limit-bootstrap",
      launchSecret: "artifacts-limit-secret",
      artifactService: createService(),
      artifactImportRoot: root,
      artifactUploadLimitBytes: 4,
    });
    const headers = await authenticatedHeaders(app, port, "artifacts-limit-bootstrap");
    const boundary = "limit-boundary";
    const denied = await app.inject({
      method: "POST",
      url: "/api/artifacts/import",
      headers: {
        host: headers.host,
        origin: headers.origin,
        cookie: headers.cookie,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary),
    });
    expect(denied.statusCode).toBe(403);
    const oversized = await app.inject({
      method: "POST",
      url: "/api/artifacts/import",
      headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(boundary),
    });
    expect(oversized.statusCode).toBe(413);
    await app.close();
  });
});
