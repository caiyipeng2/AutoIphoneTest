# M8 Device Worker Managed Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect `DeviceWorker` to `WorkerResourceManager` and `AppiumService` so one managed worker owns and cleans up its four-port resource bundle and Appium process.

**Architecture:** Preserve the existing `PortAllocator` path for legacy callers. Add an optional managed configuration keyed by `runId`; managed startup allocates a `WorkerResourceLease`, starts Appium on the lease port, creates the W3C session, and starts logcat. Every failure unwinds already-started layers, and stop continues cleanup even when one layer fails.

**Tech Stack:** TypeScript, Vitest, existing `@test-center/appium`, `@test-center/sessions`.

---

### Task 1: Add managed lifecycle contract and red tests

**Files:**
- Modify: `packages/sessions/src/device-worker.ts`
- Modify: `packages/sessions/src/device-worker.test.ts`

- [ ] Add a managed options contract with `runId`, `resourceManager`, and `appiumServiceFactory` while keeping `allocator` required for legacy mode.
- [ ] Add focused tests for managed startup order, lease-backed Appium port/log path, and managed stop cleanup.
- [ ] Add a focused test proving Appium startup failure releases the worker resource lease without creating a session.
- [ ] Run `npx vitest run packages/sessions/src/device-worker.test.ts`; confirm the new tests fail because managed mode is not implemented.

### Task 2: Implement managed startup and rollback

**Files:**
- Modify: `packages/sessions/src/device-worker.ts`
- Test: `packages/sessions/src/device-worker.test.ts`

- [ ] Add `AppiumServiceLike` and `WorkerResourceManagerLike` structural contracts so tests can inject deterministic fakes.
- [ ] Select the managed lease path when configured and keep the current allocator path unchanged otherwise.
- [ ] Start Appium after lease allocation and before W3C session creation; pass the managed lease ports and paths to factories.
- [ ] On any startup error, stop logcat if started, delete the session if created, stop Appium if started, release the managed lease, set `ERROR`, and preserve the original error code/message.
- [ ] Run the focused tests and confirm all managed and legacy tests pass.

### Task 3: Implement managed stop and generation fencing

**Files:**
- Modify: `packages/sessions/src/device-worker.ts`
- Test: `packages/sessions/src/device-worker.test.ts`

- [ ] Stop logcat, delete the W3C session, stop Appium, and release the managed lease in cleanup order while attempting every step.
- [ ] Advance generation after a successful or failed stop and ensure the next managed start requests the next generation identity.
- [ ] Add tests for cleanup continuation after Appium stop failure and for generation increment.
- [ ] Run `npx vitest run packages/sessions/src/device-worker.test.ts` and `npm run typecheck`.

### Task 4: Local acceptance

**Files:**
- Create: `docs/milestones/M8-device-worker-managed-lifecycle-acceptance.md`

- [ ] Run focused worker tests, full Vitest, TypeScript build, `git diff --check`, and CodeGraph sync.
- [ ] Record that tests use fakes and do not start a real Appium process or require a connected device.
- [ ] Keep the worktree uncommitted until user approval, then submit the commit/push as a separate action.
