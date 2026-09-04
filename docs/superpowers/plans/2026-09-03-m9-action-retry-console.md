# M9 Action Retry Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show persisted session actions in the Sessions console and expose Retry for failed or unknown actions.

**Architecture:** The server adds a protected read-only action list endpoint backed by `RunActionRepository.list`. The console loads the list for the active session, renders terminal state and parent linkage, and calls the existing retry endpoint with a fresh client request ID. Retry is disabled unless the session is `RUNNING` and the action is `FAILED` or `UNKNOWN`.

**Tech Stack:** Fastify, SQLite, React, Lucide React, Vitest Testing Library.

---

### Task 1: Add action list read API

**Files:**
- Modify: `packages/sessions/src/run-repository.ts`
- Modify: `packages/sessions/src/run-repository.test.ts`
- Modify: `apps/server/src/routes/sessions.ts`
- Modify: `apps/server/src/routes/sessions.test.ts`
- Modify: `apps/server/src/session-runtime.ts`
- Modify: `apps/server/src/session-runtime.test.ts`

- [x] **Step 1: Write failing repository and route tests**

Assert a run action list is ordered by `actionSeq`, includes terminal states and `parentActionId`, requires session authentication, and returns 404 for an unknown run.

- [x] **Step 2: Verify the tests fail**

Run the repository, runtime, and route tests; they must fail because list and the GET endpoint are absent.

- [x] **Step 3: Implement the protected list path**

Add `RunActionRepository.list(runId)`, `RuntimeSessionRouteService.listActions(id)`, and `GET /api/sessions/:id/actions` with the existing authentication guard.

### Task 2: Add console action table and Retry control

**Files:**
- Modify: `apps/console/src/state/api.ts`
- Modify: `apps/console/src/pages/SessionsPage.tsx`
- Modify: `apps/console/src/pages/SessionsPage.test.tsx`
- Modify: `apps/console/src/styles.css`

- [x] **Step 1: Write a failing page test**

Render a failed action, assert its Retry control is visible, click it, verify a fresh client request ID is sent, then assert the refreshed list displays the child action and parent link.

- [x] **Step 2: Verify the page test fails**

Run `npx vitest run apps/console/src/pages/SessionsPage.test.tsx`; it must fail because the action list and control are absent.

- [x] **Step 3: Implement the UI**

Add a compact action table with accessible status labels, a refresh icon, and a Retry button using Lucide icons. Keep controls disabled while loading or when the session is not `RUNNING`; surface request errors through the existing alert region.

### Task 3: Verify and record the UI slice

**Files:**
- Create: `docs/milestones/M9-task26-action-retry-console-acceptance.md`
- Modify: `docs/milestones/M9-acceptance.md`
- Modify: `docs/milestones/M9-task24-action-retry-acceptance.md`

- [x] **Step 1: Run focused tests, full tests, console build, typecheck, lint, and formatting**

Record exact results and keep generated build output untracked.

- [x] **Step 2: Record the boundary**

Document that Retry is now available in the console; automatic replay, Skip, rejoin, and Leader promotion remain separate.

- [x] **Step 3: Stop for user approval**

Keep changes local until the user confirms this slice, then commit and push to `origin/main`.
