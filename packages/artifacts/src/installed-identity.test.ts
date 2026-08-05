import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseDeviceSerial } from "@test-center/contracts/device";
import {
  parsePackagePaths,
  collectInstalledIdentity,
  type InstalledIdentityExecutor,
} from "./installed-identity.js";

const serial = parseDeviceSerial("R5CX211TXNT");
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../tests/fixtures/adb/${name}`, import.meta.url));

function result(stdout: string, exitCode = 0) {
  return { stdout, stderr: "", exitCode, timedOut: false };
}

describe("installed identity", () => {
  it("parses pm paths, details, resolves activity, and hashes sorted base/split bytes", async () => {
    const paths = await readFile(fixture("pm-path.txt"), "utf8");
    const details = await readFile(fixture("dumpsys-package.txt"), "utf8");
    const files = new Map([
      ["/data/app/~~abc/com.example.game-abc/base.apk", Buffer.from("base")],
      ["/data/app/~~abc/com.example.game-abc/split_config.arm64_v8a.apk", Buffer.from("split")],
    ]);
    const executor: InstalledIdentityExecutor = {
      execute: async (command) => {
        switch (command.kind) {
          case "packagePaths":
            return result(paths);
          case "packageDetails":
            return result(details);
          case "resolveActivity":
            return result(
              "priority=0 preferredOrder=0 match=0x108000\ncom.example.game/.MainActivity\n",
            );
          default:
            throw new Error(`unexpected ${command.kind}`);
        }
      },
      stream: async (command, onChunk) => {
        if (command.kind !== "streamPackageFile") return result("", 1);
        const bytes = files.get(command.filePath);
        if (bytes === undefined) return result("", 1);
        onChunk(bytes);
        return result("", 0);
      },
    };
    const identity = await collectInstalledIdentity(
      serial,
      "com.example.game",
      executor,
      "2026-08-05T10:00:00.000Z",
    );
    const records = [
      { pathRole: "BASE", sha256: createHash("sha256").update("base").digest("hex") },
      { pathRole: "SPLIT", sha256: createHash("sha256").update("split").digest("hex") },
    ];
    expect(identity).toMatchObject({
      deviceSerial: serial,
      packageName: "com.example.game",
      versionName: "1.4.2",
      versionCode: 42,
      launchActivity: "com.example.game/.MainActivity",
      signerSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      installedSetSha256: createHash("sha256").update(JSON.stringify(records)).digest("hex"),
    });
  });

  it("rejects mixed or disappeared package paths", () => {
    expect(() =>
      parsePackagePaths("package:/data/app/one/base.apk\npackage:/data/app/../escape.apk"),
    ).toThrow();
  });
});
