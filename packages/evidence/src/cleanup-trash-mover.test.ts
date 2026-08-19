import { describe, expect, it } from "vitest";

import { CleanupTrashMover, type CleanupMoveFileSystem } from "./cleanup-trash-mover.js";

class FakeFileSystem implements CleanupMoveFileSystem {
  public readonly mkdirCalls: string[] = [];
  public readonly renameCalls: Array<{ source: string; destination: string }> = [];
  public failOnRenameCall: number | undefined;

  public async mkdir(path: string): Promise<void> {
    this.mkdirCalls.push(path);
  }

  public async rename(source: string, destination: string): Promise<void> {
    this.renameCalls.push({ source, destination });
    if (this.renameCalls.length === this.failOnRenameCall) throw new Error("rename failed");
  }
}

describe("cleanup trash mover", () => {
  it("moves each selected run under one cleanup-specific trash directory", async () => {
    const fileSystem = new FakeFileSystem();
    const mover = new CleanupTrashMover(fileSystem);

    await expect(
      mover.move({
        runsRoot: "E:\\TestCenter\\data\\runs",
        trashRoot: "E:\\TestCenter\\data\\trash",
        cleanupId: "cleanup-1",
        runIds: ["run-b", "run-a"],
      }),
    ).resolves.toEqual({
      cleanupId: "cleanup-1",
      moved: [
        {
          runId: "run-a",
          sourcePath: "E:\\TestCenter\\data\\runs\\run-a",
          trashPath: "E:\\TestCenter\\data\\trash\\cleanup-1\\run-a",
        },
        {
          runId: "run-b",
          sourcePath: "E:\\TestCenter\\data\\runs\\run-b",
          trashPath: "E:\\TestCenter\\data\\trash\\cleanup-1\\run-b",
        },
      ],
    });
    expect(fileSystem.mkdirCalls).toEqual(["E:\\TestCenter\\data\\trash\\cleanup-1"]);
  });

  it("rejects traversal, duplicate IDs, and cross-volume roots before moving", async () => {
    const mover = new CleanupTrashMover(new FakeFileSystem());
    const request = {
      runsRoot: "E:\\TestCenter\\data\\runs",
      trashRoot: "E:\\TestCenter\\data\\trash",
      cleanupId: "cleanup-1",
      runIds: ["run-a"],
    };

    await expect(mover.move({ ...request, runIds: ["..\\outside"] })).rejects.toThrow(/run ID/i);
    await expect(mover.move({ ...request, cleanupId: "..\\outside" })).rejects.toThrow(
      /cleanup ID/i,
    );
    await expect(mover.move({ ...request, runIds: ["run-a", "run-a"] })).rejects.toThrow(
      /duplicate/i,
    );
    await expect(mover.move({ ...request, trashRoot: "C:\\Other\\trash" })).rejects.toThrow(
      /same volume/i,
    );
  });

  it("restores a validated move result in reverse order", async () => {
    const fileSystem = new FakeFileSystem();
    const mover = new CleanupTrashMover(fileSystem);
    const request = {
      runsRoot: "E:\\TestCenter\\data\\runs",
      trashRoot: "E:\\TestCenter\\data\\trash",
      cleanupId: "cleanup-restore",
      runIds: ["run-a", "run-b"],
    };
    const result = {
      cleanupId: request.cleanupId,
      moved: [
        {
          runId: "run-a",
          sourcePath: "E:\\TestCenter\\data\\runs\\run-a",
          trashPath: "E:\\TestCenter\\data\\trash\\cleanup-restore\\run-a",
        },
        {
          runId: "run-b",
          sourcePath: "E:\\TestCenter\\data\\runs\\run-b",
          trashPath: "E:\\TestCenter\\data\\trash\\cleanup-restore\\run-b",
        },
      ],
    } as const;

    await expect(mover.restore(request, result)).resolves.toEqual(result.moved);
    expect(fileSystem.renameCalls).toEqual([
      {
        source: "E:\\TestCenter\\data\\trash\\cleanup-restore\\run-b",
        destination: "E:\\TestCenter\\data\\runs\\run-b",
      },
      {
        source: "E:\\TestCenter\\data\\trash\\cleanup-restore\\run-a",
        destination: "E:\\TestCenter\\data\\runs\\run-a",
      },
    ]);
    await expect(
      mover.restore(request, {
        ...result,
        moved: [{ ...result.moved[0], trashPath: "E:\\outside\\run-a" }],
      }),
    ).rejects.toThrow(/does not match|unexpected path/i);
  });

  it("rolls back earlier moves when a later rename fails", async () => {
    const fileSystem = new FakeFileSystem();
    fileSystem.failOnRenameCall = 2;
    const mover = new CleanupTrashMover(fileSystem);

    await expect(
      mover.move({
        runsRoot: "E:\\TestCenter\\data\\runs",
        trashRoot: "E:\\TestCenter\\data\\trash",
        cleanupId: "cleanup-2",
        runIds: ["run-a", "run-b"],
      }),
    ).rejects.toThrow(/rename failed/i);
    expect(fileSystem.renameCalls).toEqual([
      {
        source: "E:\\TestCenter\\data\\runs\\run-a",
        destination: "E:\\TestCenter\\data\\trash\\cleanup-2\\run-a",
      },
      {
        source: "E:\\TestCenter\\data\\runs\\run-b",
        destination: "E:\\TestCenter\\data\\trash\\cleanup-2\\run-b",
      },
      {
        source: "E:\\TestCenter\\data\\trash\\cleanup-2\\run-a",
        destination: "E:\\TestCenter\\data\\runs\\run-a",
      },
    ]);
  });
});
