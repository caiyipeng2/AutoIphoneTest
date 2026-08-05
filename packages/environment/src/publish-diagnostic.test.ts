import { describe, expect, it } from "vitest";

import {
  EnvironmentDiagnosticSchema,
  type EnvironmentDiagnostic,
} from "@test-center/contracts/environment";

import {
  getDiagnosticExitCode,
  publishDiagnostic,
  type DiagnosticFileSystem,
} from "./publish-diagnostic.js";
import { renderDiagnosticHtml } from "./render-html.js";

const outputDirectory = "E:\\Projects\\TestCenter\\data\\diagnostics\\test-run";

describe("publishDiagnostic", () => {
  it("rejects a root-relative output path before touching the file system", async () => {
    const fileSystem = new MemoryFileSystem();

    await expect(
      publishDiagnostic(createDiagnostic(), {
        outputDirectory: "\\reports",
        fileSystem,
        publicationToken: "root-relative",
      }),
    ).rejects.toThrow("fully qualified");
    expect(fileSystem.operations).toHaveLength(0);
  });

  it("removes every partial and final file when the second write fails", async () => {
    const fileSystem = new MemoryFileSystem({ failWriteNumber: 2 });

    await expect(
      publishDiagnostic(createDiagnostic(), {
        outputDirectory,
        fileSystem,
        publicationToken: "write-failure",
      }),
    ).rejects.toThrow(/simulated write failure/i);

    expect(fileSystem.files.size).toBe(0);
    expect(fileSystem.operations.filter((operation) => operation.kind === "write")).toHaveLength(2);
    expect(fileSystem.operations.filter((operation) => operation.kind === "rename")).toHaveLength(
      0,
    );
  });

  it("rolls back the first final file when the second atomic rename fails", async () => {
    const fileSystem = new MemoryFileSystem({ failRenameNumber: 2 });

    await expect(
      publishDiagnostic(createDiagnostic(), {
        outputDirectory,
        fileSystem,
        publicationToken: "rename-failure",
      }),
    ).rejects.toThrow(/simulated rename failure/i);

    expect(fileSystem.files.size).toBe(0);
  });

  it("surfaces cleanup failures and identifies paths that may remain", async () => {
    const fileSystem = new MemoryFileSystem({ failRenameNumber: 2, failRemoveNumber: 2 });

    await expect(
      publishDiagnostic(createDiagnostic(), {
        outputDirectory,
        fileSystem,
        publicationToken: "cleanup-failure",
      }),
    ).rejects.toThrow(/cleanup failed.*\.html\.partial/i);

    expect([...fileSystem.files.keys()]).toEqual([expect.stringMatching(/\.html\.partial$/)]);
  });

  it("writes hashed JSON and HTML through sibling partial files", async () => {
    const fileSystem = new MemoryFileSystem();
    const publication = await publishDiagnostic(createDiagnostic(), {
      outputDirectory,
      fileSystem,
      publicationToken: "success",
    });

    expect(publication.jsonSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(publication.jsonPath).toContain(publication.jsonSha256);
    expect(publication.htmlPath).toContain(publication.jsonSha256);
    expect(publication.jsonPath.endsWith(".json")).toBe(true);
    expect(publication.htmlPath.endsWith(".html")).toBe(true);
    expect([...fileSystem.files.keys()].some((path) => path.endsWith(".partial"))).toBe(false);

    const writes = fileSystem.operations.filter((operation) => operation.kind === "write");
    const renames = fileSystem.operations.filter((operation) => operation.kind === "rename");
    expect(writes).toHaveLength(2);
    expect(writes.every((operation) => operation.path.endsWith(".partial"))).toBe(true);
    expect(renames).toHaveLength(2);

    const json = fileSystem.files.get(publication.jsonPath);
    const html = fileSystem.files.get(publication.htmlPath);
    expect(() => EnvironmentDiagnosticSchema.parse(JSON.parse(json ?? ""))).not.toThrow();
    expect(html).toContain(publication.jsonSha256);
  });
});

describe("renderDiagnosticHtml", () => {
  it("escapes probe output and exposes no arbitrary command controls", () => {
    const diagnostic = createDiagnostic({
      errorMessage: '<script>alert("probe")</script>',
      resolvedPath: "E:\\Tools\\<probe>.exe",
    });

    const html = renderDiagnosticHtml(diagnostic, "a".repeat(64));

    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;probe&gt;.exe");
    expect(html).not.toContain('<script>alert("probe")</script>');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("onclick=");
  });
});

describe("getDiagnosticExitCode", () => {
  it.each([
    ["HEALTHY", 0],
    ["DEGRADED", 2],
    ["FATAL", 3],
  ] as const)("maps %s to %i", (severity, expected) => {
    expect(getDiagnosticExitCode(severity)).toBe(expected);
  });
});

class MemoryFileSystem implements DiagnosticFileSystem {
  public readonly files = new Map<string, string>();
  public readonly operations: Array<{ readonly kind: string; readonly path: string }> = [];
  private writeCount = 0;
  private renameCount = 0;
  private removeCount = 0;

  public constructor(
    private readonly failures: {
      readonly failWriteNumber?: number;
      readonly failRenameNumber?: number;
      readonly failRemoveNumber?: number;
    } = {},
  ) {}

  public async createDirectory(path: string): Promise<void> {
    this.operations.push({ kind: "mkdir", path });
  }

  public async writeExclusive(path: string, contents: string): Promise<void> {
    this.writeCount += 1;
    this.operations.push({ kind: "write", path });
    if (this.writeCount === this.failures.failWriteNumber) {
      throw new Error("simulated write failure");
    }
    if (this.files.has(path)) {
      throw new Error(`file already exists: ${path}`);
    }
    this.files.set(path, contents);
  }

  public async rename(source: string, destination: string): Promise<void> {
    this.renameCount += 1;
    this.operations.push({ kind: "rename", path: destination });
    if (this.renameCount === this.failures.failRenameNumber) {
      throw new Error("simulated rename failure");
    }
    const contents = this.files.get(source);
    if (contents === undefined) {
      throw new Error(`missing source: ${source}`);
    }
    this.files.delete(source);
    this.files.set(destination, contents);
  }

  public async remove(path: string): Promise<void> {
    this.removeCount += 1;
    this.operations.push({ kind: "remove", path });
    if (this.removeCount === this.failures.failRemoveNumber) {
      throw new Error("simulated remove failure");
    }
    this.files.delete(path);
  }
}

function createDiagnostic(
  options: { readonly errorMessage?: string; readonly resolvedPath?: string } = {},
): EnvironmentDiagnostic {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-04T00:00:00.000Z",
    overall: "DEGRADED",
    probes: [
      {
        id: "sample",
        severity: "DEGRADED",
        durationMs: 5,
        ...(options.resolvedPath === undefined ? {} : { resolvedPath: options.resolvedPath }),
        version: "1.0.0",
        facts: {
          devices: [{ serial: "SERIAL", state: "device", model: "SM-S9280" }],
        },
        errors: [
          {
            category: "SAMPLE_WARNING",
            message: options.errorMessage ?? "A sample warning.",
          },
        ],
      },
    ],
  };
}
