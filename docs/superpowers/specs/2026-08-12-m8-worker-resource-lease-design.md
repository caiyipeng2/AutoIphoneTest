# M8 Worker Resource Lease Design

## Goal

Provide an atomic, serial-isolated resource lease for one to four session workers so Appium, system, MJPEG, bridge-forward ports and run-owned paths cannot collide or be released by another worker.

## Scope

- A worker identity is `{ runId, serial, generation }` and produces a deterministic owner token scoped to that identity.
- One allocation reserves Appium, system, MJPEG, and bridge-forward ports as a single bundle. Any failed port probe or path creation releases every resource selected during that attempt.
- The existing persisted `PortAllocator` remains the port source; the new manager adds bridge-forward allocation, path ownership, generation fencing, and bundle release checks.
- Paths are created below a caller-provided runs root: `logs/<run>/<serial>/generation-<n>`, `preview/<run>/<serial>/generation-<n>`, and `evidence/<run>/<serial>/generation-<n>`.
- Allocation is idempotent for the same worker identity. A different generation or run cannot reuse an active serial lease.
- Release requires the exact owner token and only removes the matching lease and resource directory.

## API

```ts
interface WorkerResourceIdentity {
  runId: string;
  serial: string;
  generation: number;
}

interface WorkerResourceLease {
  leaseId: string;
  identity: WorkerResourceIdentity;
  ownerToken: string;
  ports: { appium: number; system: number; mjpeg: number; bridge: number };
  paths: { logs: string; preview: string; evidence: string };
}

allocate(identity): Promise<WorkerResourceLease>
release(lease, ownerToken): Promise<void>
list(): Promise<readonly WorkerResourceLease[]>
```

## Failure and isolation rules

- Empty IDs, invalid serials, or non-positive generations are rejected before touching the store.
- Active serial ownership is unique across run and generation; an old generation must be released before a new generation can allocate.
- Bridge port allocation uses its own configured range and is included in collision checks.
- If path creation or lease persistence fails after port allocation, the allocated port lease is released before the error is returned.
- A wrong owner token is rejected without deleting anything.

## Verification

- Unit tests cover one/four worker allocation, same-identity idempotency, serial/generation conflicts, four-port uniqueness, path isolation, partial allocation rollback, stale owner cleanup, and wrong-owner release.
- Tests use an in-memory port store and temporary E-drive-compatible test roots; no real Appium process or device state is required.
