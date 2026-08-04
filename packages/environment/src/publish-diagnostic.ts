import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { win32 } from "node:path";

import {
  EnvironmentDiagnosticSchema,
  type EnvironmentDiagnostic,
  type ProbeSeverity,
} from "@test-center/contracts/environment";

import { renderDiagnosticHtml } from "./render-html.js";

export interface DiagnosticFileSystem {
  createDirectory(path: string): Promise<void>;
  writeExclusive(path: string, contents: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface PublishDiagnosticOptions {
  readonly outputDirectory: string;
  readonly fileSystem?: DiagnosticFileSystem;
  readonly publicationToken?: string;
}

export interface PublishedDiagnostic {
  readonly jsonPath: string;
  readonly htmlPath: string;
  readonly jsonSha256: string;
}

const nodeFileSystem: DiagnosticFileSystem = {
  createDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  writeExclusive: async (path, contents) => {
    await writeFile(path, contents, { encoding: "utf8", flag: "wx" });
  },
  rename: async (source, destination) => {
    await rename(source, destination);
  },
  remove: async (path) => {
    await rm(path, { force: true });
  },
};

export async function publishDiagnostic(
  diagnosticInput: EnvironmentDiagnostic,
  options: PublishDiagnosticOptions,
): Promise<PublishedDiagnostic> {
  if (!isFullyQualifiedWindowsPath(options.outputDirectory)) {
    throw new TypeError(
      "Diagnostic outputDirectory must be a fully qualified absolute Windows path.",
    );
  }
  const token = options.publicationToken ?? randomUUID();
  if (!/^[a-zA-Z0-9-]+$/.test(token)) {
    throw new TypeError("Diagnostic publicationToken contains unsupported characters.");
  }

  const diagnostic = EnvironmentDiagnosticSchema.parse(diagnosticInput);
  const json = `${JSON.stringify(diagnostic, null, 2)}\n`;
  const jsonSha256 = createHash("sha256").update(json, "utf8").digest("hex");
  const html = renderDiagnosticHtml(diagnostic, jsonSha256);
  const baseName = `environment-diagnostic-${jsonSha256}-${token}`;
  const jsonPath = win32.join(options.outputDirectory, `${baseName}.json`);
  const htmlPath = win32.join(options.outputDirectory, `${baseName}.html`);
  const partialJsonPath = `${jsonPath}.partial`;
  const partialHtmlPath = `${htmlPath}.partial`;
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const published: string[] = [];

  await fileSystem.createDirectory(options.outputDirectory);
  try {
    await fileSystem.writeExclusive(partialJsonPath, json);
    await fileSystem.writeExclusive(partialHtmlPath, html);
    await fileSystem.rename(partialJsonPath, jsonPath);
    published.push(jsonPath);
    await fileSystem.rename(partialHtmlPath, htmlPath);
    published.push(htmlPath);
  } catch (error) {
    const cleanupPaths = [partialJsonPath, partialHtmlPath, ...published];
    const cleanupResults = await Promise.allSettled(
      cleanupPaths.map(async (path) => await fileSystem.remove(path)),
    );
    const cleanupFailures = cleanupResults.flatMap((result, index) =>
      result.status === "fulfilled"
        ? []
        : [
            {
              path: cleanupPaths[index] ?? "<unknown>",
              error:
                result.reason instanceof Error
                  ? result.reason
                  : new Error("Unknown diagnostic cleanup failure."),
            },
          ],
    );
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures.map((failure) => failure.error)],
        `Diagnostic publication failed and cleanup failed for: ${cleanupFailures.map((failure) => failure.path).join(", ")}`,
        { cause: error },
      );
    }
    throw error;
  }

  return { jsonPath, htmlPath, jsonSha256 };
}

function isFullyQualifiedWindowsPath(value: string): boolean {
  if (!win32.isAbsolute(value)) {
    return false;
  }
  const root = win32.parse(value).root;
  return root !== "\\" && root !== "/";
}

export function getDiagnosticExitCode(severity: ProbeSeverity): 0 | 2 | 3 {
  switch (severity) {
    case "HEALTHY":
      return 0;
    case "DEGRADED":
      return 2;
    case "FATAL":
      return 3;
  }
}
