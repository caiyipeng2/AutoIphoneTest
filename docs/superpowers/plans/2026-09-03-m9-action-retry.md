# M9 Explicit Action Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an operator to retry a failed or unknown action as a new persisted action linked to its parent.

**Architecture:** Retry is an authenticated, CSRF-protected session command. The repository copies the immutable command/payload into a new action with a new client request ID and action sequence, stores `parentActionId`, and permits only terminal `FAILED` or `UNKNOWN` parents. The existing dispatcher may execute the new action immediately; no retry is created automatically by fault recovery.

**Tech Stack:** Fastify, TypeScript, SQLite, existing action repository/dispatcher, Vitest.

---

### Task 1: Add retry persistence and parent linkage

**Files:**
- Modify: `packages/database/src/migrations.ts`
- Modify: `apps/server/src/device-runtime.ts`
- Modify: `packages/sessions/src/run-repository.ts`
- Modify: `packages/sessions/src/run-repository.test.ts`
- Create: `packages/database/src/action-retry-migration.test.ts`

- [x] **Step 1: Write failing repository and migration tests**

Assert migration `0021_action_retries` adds `actions.parent_action_id`; retrying a `FAILED` or `UNKNOWN` parent creates a new action with a new id/sequence/client request, the same command, and `parentActionId`; retrying a `SUCCEEDED` or `QUEUED` action is rejected; the parent remains unchanged.

- [x] **Step 2: Verify the tests fail**

Run the repository and migration tests; they must fail because the migration and `retry()` method do not exist.

- [x] **Step 3: Implement the minimal repository path**

Add the migration to the runtime migration list, expose `parentActionId` on action views, persist it when the column is available, keep legacy test schemas readable, validate same-run terminal parents, and create the new action through the existing transactional action creation path.

### Task 2: Add the protected retry API

**Files:**
- Modify: `apps/server/src/routes/sessions.ts`
- Modify: `apps/server/src/routes/sessions.test.ts`
- Modify: `apps/server/src/session-runtime.ts`
- Modify: `apps/server/src/session-runtime.test.ts`
- Modify: `apps/console/src/state/api.ts`

- [x] **Step 1: Write failing route/runtime tests**

Assert `POST /api/sessions/:id/actions/:actionId/retry` requires authentication and CSRF, requires a fresh client request ID, returns the new action with `parentActionId`, and dispatches only that new action. Assert an action belonging to another run or a non-terminal parent is rejected.

- [x] **Step 2: Verify the tests fail**

Run the route and runtime tests; they must fail because the endpoint and service method are absent.

- [x] **Step 3: Implement the protected command**

Add bounded retry input validation, delegate to `RunActionRepository.retry`, and reuse the configured dispatcher. Keep retry unavailable while the run is `PAUSED`, and do not change the parent state.

### Task 3: Verify and record the acceptance slice

**Files:**
- Create: `docs/milestones/M9-task24-action-retry-acceptance.md`
- Modify: `docs/milestones/M9-acceptance.md`
- Modify: `docs/milestones/M9-task23-explicit-resume-acceptance.md`

- [x] **Step 1: Run focused tests, typecheck, lint, and formatting**

Run repository, migration, route, and runtime tests plus TypeScript, ESLint, and Prettier checks on changed files.

- [x] **Step 2: Document the no-auto-replay boundary**

Record that only an explicit operator request creates the child action; automatic fault recovery continues to stop/pause without retrying.

- [x] **Step 3: Stop for user approval**

Keep the slice local until the user confirms it. Only then commit and push to `origin/main`.
