import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import { ProcessRunner } from "./process-runner.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ProcessRunner", () => {
  it("passes arguments literally and captures stdout and stderr separately", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "test-center-process-"));
    temporaryDirectories.push(sandbox);
    const injectedFile = join(sandbox, "shell-injection.txt");
    const literalArgument = `literal & echo injected > "${injectedFile}"`;
    const runner = new ProcessRunner();

    const result = await runner.run({
      executableId: "node",
      executablePath: process.execPath,
      args: [
        "-e",
        "process.stdout.write(process.argv[1]); process.stderr.write('separate-stderr');",
        literalArgument,
      ],
      cwd: sandbox,
      env: {},
      timeoutMs: 2_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(literalArgument);
    expect(result.stderr).toBe("separate-stderr");
    expect(existsSync(injectedFile)).toBe(false);
  });

  it("redacts configured argument indexes from command metadata", async () => {
    const runner = new ProcessRunner();
    const result = await runner.run({
      executableId: "node",
      executablePath: process.execPath,
      args: ["-e", "process.stdout.write('ok');", "super-secret"],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 2_000,
      redactedArgumentIndexes: [2],
    });

    expect(result.stdout).toBe("ok");
    expect(result.command.args).toEqual(["-e", "process.stdout.write('ok');", "[REDACTED]"]);
  });

  it("caps stdout and stderr independently", async () => {
    const runner = new ProcessRunner({ maxOutputBytes: 8 });
    const result = await runner.run({
      executableId: "node",
      executablePath: process.execPath,
      args: ["-e", "process.stdout.write('1234567890'); process.stderr.write('abcdefghij');"],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 2_000,
    });

    expect(result.stdout).toBe("12345678");
    expect(result.stderr).toBe("abcdefgh");
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
  });

  it("terminates the process tree after a timeout", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "test-center-timeout-"));
    temporaryDirectories.push(sandbox);
    const childMarker = join(sandbox, "child-survived.txt");
    const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(childMarker)}, 'survived'), 700); setInterval(() => {}, 1000);`;
    const parentScript = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;
    const runner = new ProcessRunner();

    const result = await runner.run({
      executableId: "node",
      executablePath: process.execPath,
      args: ["-e", parentScript],
      cwd: sandbox,
      env: {},
      timeoutMs: 150,
    });

    expect(result.timedOut).toBe(true);
    await delay(900);
    expect(existsSync(childMarker)).toBe(false);
  });

  it("refuses a serial-required adb command without a serial", async () => {
    const runner = new ProcessRunner();

    await expect(
      runner.run({
        executableId: "adb",
        args: ["shell", "getprop"],
        cwd: process.cwd(),
        env: {},
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "SERIAL_REQUIRED" });
  });
});
