import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm, rmdir } from "node:fs/promises";
import { win32 } from "node:path";

export interface ContentStoreOptions {
  readonly rootPath: string;
}

export interface StagedContent {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly originalName: string;
  readonly partialPath: string;
}

export interface PublishedContent {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly originalName: string;
  readonly storedPath: string;
  readonly created: boolean;
}

export type ContentInput = AsyncIterable<Buffer | Uint8Array | string>;

export class ContentStore {
  private readonly rootPath: string;
  private readonly stagingPath: string;

  public constructor(options: ContentStoreOptions) {
    if (!win32.isAbsolute(options.rootPath)) {
      throw new TypeError("rootPath must be an absolute Windows path.");
    }
    this.rootPath = win32.normalize(options.rootPath);
    this.stagingPath = win32.join(this.rootPath, ".staging");
  }

  public async stage(input: ContentInput, originalName: string): Promise<StagedContent> {
    const sanitizedName = sanitizeOriginalName(originalName);
    await mkdir(this.stagingPath, { recursive: true });
    const partialPath = win32.join(this.stagingPath, `${randomUUID()}.partial`);
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const handle = await open(partialPath, "wx");
    try {
      for await (const chunk of input) {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
        hash.update(buffer);
        sizeBytes += buffer.byteLength;
        await handle.write(buffer);
      }
      await handle.sync();
    } catch (error) {
      await safeClose(handle);
      await safeRemove(partialPath);
      throw error;
    }
    await safeClose(handle);
    return {
      sha256: hash.digest("hex"),
      sizeBytes,
      originalName: sanitizedName,
      partialPath,
    };
  }

  public async publish(staged: StagedContent): Promise<PublishedContent> {
    const hashDirectory = win32.join(
      this.rootPath,
      "sha256",
      staged.sha256.slice(0, 2),
      staged.sha256,
    );
    await mkdir(hashDirectory, { recursive: true });
    const existing = await findPublishedFile(hashDirectory);
    if (existing !== undefined) {
      await safeRemove(staged.partialPath);
      return {
        sha256: staged.sha256,
        sizeBytes: staged.sizeBytes,
        originalName: staged.originalName,
        storedPath: this.relativePath(win32.join(hashDirectory, existing)),
        created: false,
      };
    }

    const destination = win32.join(hashDirectory, staged.originalName);
    try {
      await rename(staged.partialPath, destination);
      return {
        sha256: staged.sha256,
        sizeBytes: staged.sizeBytes,
        originalName: staged.originalName,
        storedPath: this.relativePath(destination),
        created: true,
      };
    } catch (error) {
      const raced = await findPublishedFile(hashDirectory);
      if (raced !== undefined) {
        await safeRemove(staged.partialPath);
        return {
          sha256: staged.sha256,
          sizeBytes: staged.sizeBytes,
          originalName: staged.originalName,
          storedPath: this.relativePath(win32.join(hashDirectory, raced)),
          created: false,
        };
      }
      await safeRemove(staged.partialPath);
      throw error;
    }
  }

  public async removePublished(published: PublishedContent): Promise<void> {
    if (!published.created) return;
    const absolutePath = win32.join(this.rootPath, published.storedPath.replaceAll("/", "\\"));
    const hashDirectory = win32.dirname(absolutePath);
    const prefixDirectory = win32.dirname(hashDirectory);
    await safeRemove(absolutePath);
    await safeRemoveEmptyDirectory(hashDirectory);
    await safeRemoveEmptyDirectory(prefixDirectory);
  }

  public async listPartialFiles(): Promise<string[]> {
    try {
      return (await readdir(this.stagingPath)).filter((name) => name.endsWith(".partial"));
    } catch {
      return [];
    }
  }

  private relativePath(path: string): string {
    return win32.relative(this.rootPath, path).replaceAll("\\", "/");
  }
}

function sanitizeOriginalName(originalName: string): string {
  const baseName = win32.basename(originalName).trim();
  const sanitized = Array.from(baseName)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127 && !/[<>:"/\\|?*]/.test(character);
    })
    .join("")
    .replace(/\s+/g, "_");
  if (sanitized.length === 0 || sanitized === "." || sanitized === "..") return "artifact.bin";
  return sanitized.slice(0, 128);
}

async function findPublishedFile(directory: string): Promise<string | undefined> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const file = entries.find((entry) => entry.isFile() && !entry.name.endsWith(".partial"));
    return file?.name;
  } catch {
    return undefined;
  }
}

async function safeRemove(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => undefined);
}

async function safeClose(handle: Awaited<ReturnType<typeof open>>): Promise<void> {
  await handle.close().catch(() => undefined);
}

async function safeRemoveEmptyDirectory(path: string): Promise<void> {
  await rmdir(path).catch(() => undefined);
}
