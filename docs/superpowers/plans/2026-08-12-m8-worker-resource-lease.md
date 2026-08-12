# M8 Worker Resource Lease Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add atomic four-port and serial-owned path leases for one to four session workers.

**Architecture:** `WorkerResourceManager` wraps the existing `PortAllocator`, reserves a fourth bridge port, and persists a JSON lease manifest containing worker identity, owner token, ports and paths. Directory creation and lease publication happen as one guarded operation with rollback on any failure.

**Tech Stack:** TypeScript, Node `fs/promises`, existing Appium port allocator, Vitest.

---

### Task 1: Define the lease contract and failing capacity tests

**Files:**
- Create: `packages/sessions/src/worker-resource-manager.ts`
- Create: `packages/sessions/src/worker-resource-manager.test.ts`
- Modify: `packages/sessions/src/index.ts`

- [ ] Add tests for one and four worker allocations, exact four-port uniqueness, deterministic `logs/preview/evidence` paths, same-identity idempotency, and serial/generation conflict rejection.
- [ ] Run `npx vitest run packages/sessions/src/worker-resource-manager.test.ts`; confirm it fails because the manager does not exist.
- [ ] Define `WorkerResourceIdentity`, `WorkerResourceLease`, `WorkerResourceManagerOptions`, and the `allocate/release/list` API; export them from the sessions package.

### Task 2: Implement atomic port and path allocation

**Files:**
- Modify: `packages/sessions/src/worker-resource-manager.ts`
- Test: `packages/sessions/src/worker-resource-manager.test.ts`

- [ ] Add a failing test where the bridge port range is exhausted after Appium/system/MJPEG ports are selected; assert no persisted lease and no worker directories remain.
- [ ] Implement identity validation, owner-token hashing, bridge port probing, path creation, manifest persistence, and rollback that releases the base port lease and removes only the attempted directories.
- [ ] Add stale owner cleanup and exact owner-token release tests.

### Task 3: Verify integration boundaries and local acceptance

**Files:**
- Create: `docs/milestones/M8-worker-resource-lease-acceptance.md`

- [ ] Run focused worker-resource tests, full Vitest, TypeScript build, Console build, targeted ESLint and Prettier.
- [ ] Run CodeGraph sync and `git diff --check`.
- [ ] Record that Appium/video/evidence consumers and four-device hardware soak remain later M8 slices.
- [ ] Wait for user approval before staging, committing, and pushing.
