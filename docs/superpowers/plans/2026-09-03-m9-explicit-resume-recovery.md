# M9 Explicit Resume Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an operator-triggered resume that rebuilds active workers after a paused run without replaying uncertain actions.

**Architecture:** A paused session resumes only through a protected API command. The runtime starts fresh workers for the current active membership, using the next persisted device generation, then atomically advances the run epoch and transitions `PAUSED -> RUNNING`. No queued or unknown action is dispatched by resume.

**Tech Stack:** Fastify, TypeScript, SQLite, existing `RuntimeSessionRouteService`, `RuntimeWorkerCoordinator`, `DeviceWorker`, Vitest.

---

### Task 1: Define the protected resume contract

**Files:**
- Modify: `apps/server/src/routes/sessions.ts`
- Modify: `apps/server/src/routes/sessions.test.ts`
- Modify: `apps/server/src/session-runtime.ts`
- Modify: `apps/server/src/session-runtime.test.ts`

- [x] **Step 1: Write a failing route test**

Add a protected `POST /api/sessions/:id/resume` request with `{ reason: "operator" }` and assert that the route calls `sessionService.resume` and returns the resumed session.

- [x] **Step 2: Verify the route test fails**

Run `npx vitest run apps/server/src/routes/sessions.test.ts`; it must fail because `resume` is not part of the route service contract.

- [x] **Step 3: Implement the service contract and route**

Add a bounded reason schema and `resume(id, reason)` to `SessionRouteService`; enforce the existing host, origin, CSRF, and authentication checks.

### Task 2: Rebuild workers with a new generation and epoch

**Files:**
- Modify: `packages/sessions/src/device-worker.ts`
- Modify: `apps/server/src/runtime-worker-coordinator.ts`
- Modify: `apps/server/src/device-runtime.ts`
- Modify: `apps/server/src/session-runtime.ts`
- Modify: `apps/server/src/session-runtime.test.ts`

- [x] **Step 1: Add failing runtime tests**

Cover `PAUSED -> RUNNING`, fresh worker start for every active member, persisted `current_epoch + 1`, member `generation + 1`, online precondition failure, and rollback when a worker cannot start. Assert no action dispatcher or outbox call occurs.

- [x] **Step 2: Verify the runtime tests fail**

Run `npx vitest run apps/server/src/session-runtime.test.ts`; it must fail because `resume` is not implemented.

- [x] **Step 3: Implement the smallest green path**

Pass an optional generation map through `RuntimeWorkerCoordinator.start`, initialize `DeviceWorker` from that generation, start workers before the guarded database transition, and stop them if the transition fails. Insert the next epoch membership rows and `OPERATOR_RESUMED:<reason>` transition in one immediate transaction.

### Task 3: Verify and document the slice

**Files:**
- Modify: `docs/milestones/M9-acceptance.md`
- Modify: `docs/milestones/M9-task22-fault-recovery-acceptance.md`

- [x] **Step 1: Run focused tests, typecheck, lint, and formatting**

Run the route/runtime tests, `npm run typecheck`, `npm run lint -- --quiet`, and Prettier against changed files.

- [x] **Step 2: Record the boundary**

Document that resume is explicit and non-replaying; action retry, skip, device rejoin, and leader promotion remain separate follow-up commands.

- [x] **Step 3: Stop for user approval**

Keep the changes local until the user confirms this slice. Only then commit and push to `origin/main`.
