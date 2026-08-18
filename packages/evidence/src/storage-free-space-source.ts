import { statfs as nodeStatfs } from "node:fs/promises";
import { win32 } from "node:path";

import type { StorageFreeSpaceSource } from "./storage-pressure-monitor.js";

export interface FileSystemStatFs {
  readonly bavail: number | bigint;
  readonly bsize: number | bigint;
}

export type FileSystemStatFsReader = (rootPath: string) => Promise<FileSystemStatFs>;

/** Adapts Windows statfs output to the monitor's free-byte source contract. */
export function createFileSystemFreeSpaceSource(
  rootPath: string,
  read: FileSystemStatFsReader = defaultStatFsReader,
): StorageFreeSpaceSource {
  const normalizedRoot = win32.normalize(rootPath);
  if (!isDriveQualifiedPath(normalizedRoot)) {
    throw new TypeError("Storage root must be an absolute Windows path.");
  }

  return {
    readFreeBytes: async () => {
      const stats = await read(normalizedRoot);
      return calculateFreeBytes(stats);
    },
  };
}

async function defaultStatFsReader(rootPath: string): Promise<FileSystemStatFs> {
  return (await nodeStatfs(rootPath)) as unknown as FileSystemStatFs;
}

function calculateFreeBytes(stats: FileSystemStatFs): number | undefined {
  try {
    const available = BigInt(stats.bavail);
    const blockSize = BigInt(stats.bsize);
    if (available < 0n || blockSize < 0n) return undefined;
    const bytes = available * blockSize;
    if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return Number(bytes);
  } catch {
    return undefined;
  }
}

function isDriveQualifiedPath(value: string): boolean {
  return /^[A-Za-z]:\\/.test(value) && win32.isAbsolute(value);
}
