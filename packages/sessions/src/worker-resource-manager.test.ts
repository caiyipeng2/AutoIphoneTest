import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PortAllocator, type PortLeaseStore, type PortLease } from "@test-center/appium";

import { WorkerResourceManager, type WorkerResourceIdentity } from "./worker-resource-manager.js";

class MemoryPortStore implements PortLeaseStore {
  public leases = new Map<string, PortLease>();
  public async list(): Promise<readonly PortLease[]> {
    return [...this.leases.values()];
  }
  public async save(lease: PortLease): Promise<void> {
    this.leases.set(lease.leaseId, lease);
  }
  public async remove(leaseId: string): Promise<void> {
    this.leases.delete(leaseId);
  }
}

const identities: WorkerResourceIdentity[] = [1, 2, 3, 4].map((index) => ({
  runId: "run-1",
  serial: `serial-${index}`,
  generation: 1,
}));
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function createManager(
  options: { bridgeAvailable?: (port: number) => Promise<boolean> } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "test-center-workers-"));
  roots.push(root);
  const store = new MemoryPortStore();
  const allocator = new PortAllocator({
    store,
    ranges: {
      appium: { start: 4723, end: 4730 },
      system: { start: 8200, end: 8207 },
      mjpeg: { start: 7810, end: 7817 },
    },
    isPortAvailable: async () => true,
    isOwnerAlive: async () => true,
  });
  const manager = new WorkerResourceManager({
    allocator,
    bridgeRange: { start: 17501, end: 17508 },
    isPortAvailable: options.bridgeAvailable ?? (async () => true),
    rootPath: root,
    ownerPid: 100,
  });
  return { manager, store, root };
}

describe("WorkerResourceManager", () => {
  it("allocates isolated bundles for one through four workers", async () => {
    const { manager } = await createManager();
    const leases = [];
    for (const identity of identities) leases.push(await manager.allocate(identity));

    expect(new Set(leases.map((lease) => lease.ownerToken)).size).toBe(4);
    expect(new Set(leases.map((lease) => lease.ports.bridge)).size).toBe(4);
    expect(new Set(leases.map((lease) => lease.ports.appium)).size).toBe(4);
    expect(new Set(leases.map((lease) => lease.paths.logs)).size).toBe(4);
    expect(leases[0]!.paths.logs).toContain("run-1");
    expect(leases[0]!.paths.logs).toContain("serial-1");
    expect(leases[0]!.paths.logs).toContain("generation-1");
  });

  it("serializes concurrent allocation so four workers publish one complete manifest", async () => {
    const { manager } = await createManager();
    const leases = await Promise.all(identities.map((identity) => manager.allocate(identity)));
    expect(new Set(leases.map((lease) => lease.ports.bridge)).size).toBe(4);
    expect((await manager.list()).length).toBe(4);
  });

  it("is idempotent for the same identity and rejects another generation on the same serial", async () => {
    const { manager } = await createManager();
    const first = await manager.allocate(identities[0]!);
    expect(await manager.allocate(identities[0]!)).toEqual(first);
    await expect(manager.allocate({ ...identities[0]!, generation: 2 })).rejects.toThrow(
      /active|lease/i,
    );
  });

  it("rolls back the base lease and paths when bridge allocation fails", async () => {
    const { manager, store, root } = await createManager({ bridgeAvailable: async () => false });
    await expect(manager.allocate(identities[0]!)).rejects.toThrow(/bridge|port/i);
    expect(store.leases.size).toBe(0);
    await expect(readdir(join(root, "workers"))).rejects.toThrow();
    expect(await manager.list()).toEqual([]);
  });

  it("requires the exact owner token before releasing a lease", async () => {
    const { manager } = await createManager();
    const lease = await manager.allocate(identities[0]!);
    await expect(manager.release(lease, "wrong-token")).rejects.toThrow(/owner/i);
    expect((await manager.list()).length).toBe(1);
    await manager.release(lease, lease.ownerToken);
    expect(await manager.list()).toEqual([]);
  });
});
