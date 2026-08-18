import { describe, expect, it } from "vitest";

import { GIBIBYTE } from "./storage-policy.js";
import { createFileSystemFreeSpaceSource } from "./storage-free-space-source.js";

describe("filesystem free-space source", () => {
  it("reads numeric statfs values from the configured Windows root", async () => {
    const read = async (root: string) => {
      expect(root).toBe("E:\\Projects\\UnityMultiDeviceTestCenter\\data");
      return { bavail: 7, bsize: GIBIBYTE };
    };
    const source = createFileSystemFreeSpaceSource(
      "E:\\Projects\\UnityMultiDeviceTestCenter\\data",
      read,
    );

    await expect(source.readFreeBytes()).resolves.toBe(7 * GIBIBYTE);
  });

  it("supports bigint statfs values without mixing numeric arithmetic", async () => {
    const source = createFileSystemFreeSpaceSource("E:\\", async () => ({
      bavail: 5n,
      bsize: BigInt(GIBIBYTE),
    }));

    await expect(source.readFreeBytes()).resolves.toBe(5 * GIBIBYTE);
  });

  it("fails closed for invalid or overflowing statfs values", async () => {
    const invalid = createFileSystemFreeSpaceSource("E:\\", async () => ({
      bavail: -1,
      bsize: 4096,
    }));
    const overflowing = createFileSystemFreeSpaceSource("E:\\", async () => ({
      bavail: Number.MAX_SAFE_INTEGER,
      bsize: Number.MAX_SAFE_INTEGER,
    }));

    await expect(invalid.readFreeBytes()).resolves.toBeUndefined();
    await expect(overflowing.readFreeBytes()).resolves.toBeUndefined();
  });

  it.each(["relative\\data", "\\\\server\\share", "/tmp/data"])(
    "rejects non-drive-qualified root %s",
    (root) => {
      expect(() =>
        createFileSystemFreeSpaceSource(root, async () => ({ bavail: 1, bsize: 1 })),
      ).toThrow(/absolute Windows path/i);
    },
  );
});
