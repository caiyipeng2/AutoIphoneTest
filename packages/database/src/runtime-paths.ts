import { mkdir } from "node:fs/promises";
import { win32 } from "node:path";

export interface RuntimePaths {
  readonly projectRoot: string;
  readonly dataRoot: string;
  readonly databasePath: string;
  readonly logsRoot: string;
  readonly artifactsRoot: string;
  readonly runsRoot: string;
  readonly tempRoot: string;
}

export function createRuntimePaths(projectRoot: string, configuredDataRoot?: string): RuntimePaths {
  const normalizedProjectRoot = normalizeAbsoluteWindowsPath(projectRoot, "projectRoot");
  const dataRoot = normalizeAbsoluteWindowsPath(
    configuredDataRoot ?? win32.join(normalizedProjectRoot, "data"),
    "dataRoot",
  );

  if (
    win32.parse(normalizedProjectRoot).root.toLowerCase() !==
    win32.parse(dataRoot).root.toLowerCase()
  ) {
    throw new TypeError("dataRoot must use the same drive as projectRoot.");
  }
  if (!isPathWithin(normalizedProjectRoot, dataRoot)) {
    throw new TypeError("dataRoot must be below the project root.");
  }

  const paths: RuntimePaths = {
    projectRoot: normalizedProjectRoot,
    dataRoot,
    databasePath: win32.join(dataRoot, "test-center.sqlite"),
    logsRoot: win32.join(dataRoot, "logs"),
    artifactsRoot: win32.join(dataRoot, "artifacts"),
    runsRoot: win32.join(dataRoot, "runs"),
    tempRoot: win32.join(dataRoot, "temp"),
  };

  for (const [name, path] of Object.entries(paths)) {
    if (name !== "projectRoot" && !isPathWithin(dataRoot, path)) {
      throw new TypeError(`${name} must remain below dataRoot.`);
    }
  }
  return paths;
}

export function isPathWithin(basePath: string, candidatePath: string): boolean {
  const base = normalizeAbsoluteWindowsPath(basePath, "basePath");
  const candidate = normalizeAbsoluteWindowsPath(candidatePath, "candidatePath");
  if (win32.parse(base).root.toLowerCase() !== win32.parse(candidate).root.toLowerCase()) {
    return false;
  }
  const relative = win32.relative(base, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..\\") && relative !== ".." && !win32.isAbsolute(relative))
  );
}

export async function ensureRuntimeDirectories(paths: RuntimePaths): Promise<void> {
  await Promise.all(
    [paths.dataRoot, paths.logsRoot, paths.artifactsRoot, paths.runsRoot, paths.tempRoot].map(
      async (directory) => await mkdir(directory, { recursive: true }),
    ),
  );
}

function normalizeAbsoluteWindowsPath(value: string, name: string): string {
  if (
    !win32.isAbsolute(value) ||
    win32.parse(value).root === "\\" ||
    win32.parse(value).root === "/"
  ) {
    throw new TypeError(`${name} must be a fully qualified Windows path.`);
  }
  return win32.normalize(value);
}
