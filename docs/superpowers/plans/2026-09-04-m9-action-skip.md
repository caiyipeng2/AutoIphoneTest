# M9 Explicit Action Skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator explicitly mark a failed or unknown action as skipped without touching devices or silently replaying it.

**Architecture:** A skip decision is an immutable row linked to the action and run, leaving the original action state (`FAILED` or `UNKNOWN`) intact for forensic history. The protected API accepts a fresh decision request ID and reason; the console exposes Skip only for unresolved terminal actions and refreshes the action list after success.

**Tech Stack:** Fastify, SQLite, TypeScript, React, Lucide React, Vitest.

---

### Task 1: Persist skip decisions

**Files:**
- Modify: `packages/database/src/migrations.ts`
- Modify: `apps/server/src/device-runtime.ts`
- Modify: `packages/sessions/src/run-repository.ts`
- Modify: `packages/sessions/src/run-repository.test.ts`
- Create: `packages/database/src/action-skip-migration.test.ts`

- [x] **Step 1: Write failing migration/repository tests**

Assert migration `0022_action_skip_decisions` creates the linked decision table. Assert a failed or unknown parent gets one immutable skip decision, list/get expose `resolution: SKIPPED`, a second decision is deduplicated only for the same request, successful/queued/already-skipped parents are rejected, and the parent action state is unchanged.

- [x] **Step 2: Verify tests fail**

Run the migration and repository tests; they must fail because the migration, `skip()`, and resolution field are absent.

- [x] **Step 3: Implement the smallest persistence path**

Add the migration to the runtime list, make the repository read/write skip decisions, preserve compatibility with legacy test schemas, and prevent Retry after a parent is skipped.

### Task 2: Add protected skip API

**Files:**
- Modify: `apps/server/src/routes/sessions.ts`
- Modify: `apps/server/src/routes/sessions.test.ts`
- Modify: `apps/server/src/session-runtime.ts`
- Modify: `apps/server/src/session-runtime.test.ts`
- Modify: `apps/console/src/state/api.ts`

- [x] **Step 1: Write failing API/runtime tests**

Assert `POST /api/sessions/:id/actions/:actionId/skip` requires auth and CSRF, accepts a bounded reason and fresh request ID, returns the parent action with a `SKIPPED` resolution, and rejects an action from another run.

- [x] **Step 2: Verify tests fail**

Run route and runtime tests; they must fail because the skip endpoint and service method are absent.

- [x] **Step 3: Implement the protected command**

Delegate to the repository, allow skip while the session is `RUNNING` or `PAUSED`, never invoke the action dispatcher, and return idempotent results for the same decision request.

### Task 3: Add console Skip control

**Files:**
- Modify: `apps/console/src/state/api.ts`
- Modify: `apps/console/src/pages/SessionsPage.tsx`
- Modify: `apps/console/src/pages/SessionsPage.test.tsx`
- Modify: `apps/console/src/styles.css`

- [x] **Step 1: Write a failing page test**

Render an unresolved failed action, click Skip, assert a fresh `skip-` request ID and reason are sent, then assert the row displays `已跳过` and no longer offers Retry/Skip.

- [x] **Step 2: Verify the page test fails**

Run the Sessions page test; it must fail because Skip is absent.

- [x] **Step 3: Implement the UI**

Add an accessible Skip button with a Lucide icon, stable row layout, disabled/loading state, and resolution text. Keep the control available for paused sessions so the operator can acknowledge a fault before explicit resume.

### Task 4: Verify and record the slice

**Files:**
- Create: `docs/milestones/M9-task27-action-skip-acceptance.md`
- Modify: `docs/milestones/M9-acceptance.md`
- Modify: `docs/milestones/M9-task26-action-retry-console-acceptance.md`

- [x] **Step 1: Run focused tests, full tests, console build, typecheck, lint, and formatting**

Record exact results and keep generated build output untracked.

- [x] **Step 2: Document no-device/no-replay behavior**

Record that Skip only writes audit state, does not call a worker or dispatcher, and does not mutate the parent action result.

- [x] **Step 3: Stop for user approval**

Keep changes local until the user confirms this slice, then commit and push to `origin/main`.
