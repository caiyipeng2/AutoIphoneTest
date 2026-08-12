# M8 Runtime Worker Coordinator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect managed `DeviceWorker` instances to the server session start path for one to four Android devices.

**Architecture:** `RuntimeWorkerCoordinator` owns a run-scoped map of workers and starts all members concurrently. `RuntimeSessionRouteService` invokes it before committing `PREFLIGHT -> RUNNING`; a worker failure stops every created worker and leaves the database in `PREFLIGHT`. Production assembly creates the existing resource manager, Appium service, logcat stream, and W3C client factories in `device-runtime.ts`.

**Tech Stack:** TypeScript, Fastify runtime services, existing Appium/ADB/session packages, Vitest.

---

### Task 1: Define coordinator behavior and tests

**Files:**
- Create: `apps/server/src/runtime-worker-coordinator.ts`
- Test: `apps/server/src/runtime-worker-coordinator.test.ts`

- [x] Define a run-scoped worker factory contract.
- [x] Start one to four workers concurrently and expose active serials.
- [x] Stop every created worker when one concurrent start fails.

### Task 2: Gate session start on worker startup

**Files:**
- Modify: `apps/server/src/session-runtime.ts`
- Test: `apps/server/src/session-runtime.test.ts`

- [ ] Inject an optional coordinator without changing callers that only exercise database state transitions.
- [ ] Start all session members before committing `RUNNING`.
- [ ] Stop the coordinator if the state transition fails; preserve `PREFLIGHT` when worker startup fails.
- [ ] Verify successful and failed coordinator paths with focused tests.

### Task 3: Assemble production worker dependencies

**Files:**
- Modify: `apps/server/src/device-runtime.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/dev.ts`

- [ ] Create a persisted port allocator and worker resource manager below runtime `runsRoot`.
- [ ] Build real Appium, logcat, identity probe, and W3C client factories using explicit project paths and environment overrides.
- [ ] Pass the coordinator into `RuntimeSessionRouteService` and stop all workers during runtime close.
- [ ] Keep Appium/home/port defaults local to runtime and avoid global PATH mutation.

### Task 4: Local acceptance

**Files:**
- Create: `docs/milestones/M8-runtime-worker-coordinator-acceptance.md`

- [ ] Run focused coordinator/session tests, TypeScript build, full Vitest, formatting, `git diff --check`, and CodeGraph sync.
- [ ] Document that real Appium/ADB execution remains a hardware acceptance step after runtime assembly.
- [ ] Keep changes uncommitted until user approval.
