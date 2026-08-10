import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { JsonFilePortLeaseStore, PortAllocator, type PortLeaseStore } from "./port-allocator.js";

type StoredLease = Parameters<PortLeaseStore["save"]>[0];

class MemoryLeaseStore implements PortLeaseStore {
  public readonly leases = new Map<string, StoredLease>();

  public async list(): Promise<StoredLease[]> {
    return [...this.leases.values()];
  }
  public async save(lease: StoredLease): Promise<void> {
    this.leases.set(lease.leaseId, lease);
  }
  public async remove(leaseId: string): Promise<void> {
    this.leases.delete(leaseId);
  }
}

const ranges = {
  appium: { start: 4723, end: 4725 },
  system: { start: 8200, end: 8202 },
  mjpeg: { start: 7810, end: 7812 },
};

describe("PortAllocator", () => {
  it("allocates deterministic distinct ports for a serial and persists the lease", async () => {
    const store = new MemoryLeaseStore();
    const allocator = new PortAllocator({ store, ranges, isPortAvailable: async () => true });
    const first = await allocator.allocate("serial-a", { ownerPid: 100, ownerToken: "run-a" });
    const second = await allocator.allocate("serial-a", { ownerPid: 100, ownerToken: "run-a" });

    expect(second).toEqual(first);
    expect(new Set([first.appiumPort, first.systemPort, first.mjpegPort]).size).toBe(3);
    expect(store.leases.size).toBe(1);
  });

  it("skips occupied ports and removes stale leases without touching live owners", async () => {
    const store = new MemoryLeaseStore();
    await store.save({
      leaseId: "stale",
      serial: "old",
      appiumPort: 4723,
      systemPort: 8200,
      mjpegPort: 7810,
      ownerPid: 1,
      ownerToken: "old-token",
      createdAt: 1,
    });
    await store.save({
      leaseId: "live",
      serial: "live",
      appiumPort: 4724,
      systemPort: 8201,
      mjpegPort: 7811,
      ownerPid: 2,
      ownerToken: "live-token",
      createdAt: 2,
    });
    const allocator = new PortAllocator({
      store,
      ranges,
      isPortAvailable: async (port) => port === 4725 || port === 8202 || port === 7812,
      isOwnerAlive: async (pid) => pid === 2,
    });
    const lease = await allocator.allocate("new", { ownerPid: 3, ownerToken: "new-token" });

    expect(lease.appiumPort).toBe(4725);
    expect(lease.systemPort).toBe(8202);
    expect(lease.mjpegPort).toBe(7812);
    expect(store.leases.has("stale")).toBe(false);
    expect(store.leases.has("live")).toBe(true);
  });

  it("releases only the caller-owned lease", async () => {
    const store = new MemoryLeaseStore();
    const allocator = new PortAllocator({
      store,
      ranges: {
        appium: { start: 4723, end: 4723 },
        system: { start: 8200, end: 8200 },
        mjpeg: { start: 7810, end: 7810 },
      },
      isPortAvailable: async () => true,
    });
    const lease = await allocator.allocate("serial-a", { ownerPid: 100, ownerToken: "run-a" });

    await expect(
      allocator.release(lease.leaseId, { ownerPid: 999, ownerToken: "wrong" }),
    ).rejects.toThrow("lease owner mismatch");
    expect(store.leases.has(lease.leaseId)).toBe(true);
    await allocator.release(lease.leaseId, { ownerPid: 100, ownerToken: "run-a" });
    expect(store.leases.has(lease.leaseId)).toBe(false);
  });

  it("recovers persisted leases across store instances and atomically removes them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "test-center-appium-"));
    try {
      const filePath = join(directory, "leases.json");
      const firstStore = new JsonFilePortLeaseStore(filePath);
      const allocator = new PortAllocator({
        store: firstStore,
        ranges: {
          appium: { start: 4723, end: 4723 },
          system: { start: 8200, end: 8200 },
          mjpeg: { start: 7810, end: 7810 },
        },
        isPortAvailable: async () => true,
        isOwnerAlive: async () => true,
      });
      const lease = await allocator.allocate("serial-a", { ownerPid: 100, ownerToken: "run-a" });
      const secondStore = new JsonFilePortLeaseStore(filePath);

      expect(await secondStore.list()).toEqual([lease]);
      await secondStore.remove(lease.leaseId);
      expect(await firstStore.list()).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
