import { describe, expect, it } from "vitest";

import { ScrcpyPrimaryProcess } from "./scrcpy-primary-process.js";

interface FakeProcess {
  readonly args: readonly string[];
  readonly executable: string;
  readonly killed: { value: boolean };
  emit(event: "error" | "spawn" | "exit"): void;
}

function createFakeProcess(): {
  process: FakeProcess;
  spawn: ScrcpyPrimaryProcess["spawnProcess"];
} {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const killed = { value: false };
  const process: FakeProcess = {
    args: [],
    executable: "",
    killed,
    emit(event) {
      listeners.get(event)?.();
    },
  };
  const spawn = ((executable, args) => {
    Object.assign(process, { executable, args: [...args] });
    return {
      once(event: string, listener: (...args: unknown[]) => void) {
        listeners.set(event, listener);
        return this;
      },
      kill() {
        killed.value = true;
        listeners.get("exit")?.();
        return true;
      },
    };
  }) as ScrcpyPrimaryProcess["spawnProcess"];
  return { process, spawn };
}

describe("ScrcpyPrimaryProcess", () => {
  it("binds every process to the requested device and starts in read-only mode", async () => {
    const fake = createFakeProcess();
    const supervisor = new ScrcpyPrimaryProcess({
      serial: "R5CX211TXNT",
      executablePath: "E:/tools/scrcpy/3.1/scrcpy.exe",
      recordPath: "data/runs/primary.mkv",
      spawnProcess: fake.spawn,
    });

    const started = supervisor.start();
    fake.process.emit("spawn");
    await started;

    expect(fake.process.executable).toContain("scrcpy.exe");
    expect(fake.process.args).toEqual([
      "--serial=R5CX211TXNT",
      "--no-window",
      "--no-control",
      "--no-audio",
      "--no-clipboard-autosync",
      "--video-codec=h264",
      "--record=data/runs/primary.mkv",
      "--record-format=mkv",
    ]);
    expect(supervisor.state).toBe("READY");

    await supervisor.stop();
    expect(fake.process.killed.value).toBe(true);
    expect(supervisor.state).toBe("STOPPED");
  });

  it("enters ERROR and releases the start promise when spawning fails", async () => {
    const fake = createFakeProcess();
    const supervisor = new ScrcpyPrimaryProcess({
      serial: "R5CX211TXNT",
      executablePath: "scrcpy.exe",
      recordPath: "primary.mkv",
      spawnProcess: fake.spawn,
    });

    const started = supervisor.start();
    fake.process.emit("error");

    await expect(started).rejects.toThrow("scrcpy process failed to start");
    expect(supervisor.state).toBe("ERROR");
  });
});
