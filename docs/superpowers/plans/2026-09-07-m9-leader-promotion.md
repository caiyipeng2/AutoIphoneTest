# M9 Paused Leader Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote an active follower to leader while a run is paused, rebuilding the active worker group without replaying actions.

**Architecture:** Promotion is an operator-only paused-state mutation. The target must be an active follower and every active member must be online and pass the existing preflight probe. Fresh workers start with incremented generations, then one new epoch is committed with swapped roles and `OPERATOR_LEADER_PROMOTED`; failures leave the paused epoch untouched.

**Tech Stack:** Fastify, SQLite, TypeScript, existing RuntimeWorkerCoordinator and preflight probe, Vitest.

---

### Task 1: Add promotion runtime and API

**Files:**
- Modify: `apps/server/src/routes/sessions.ts`
- Modify: `apps/server/src/session-runtime.ts`
- Modify: `apps/server/src/session-runtime.test.ts`
- Modify: `apps/server/src/routes/sessions.test.ts`

- [x] **Step 1: Write failing tests**

Assert paused promotion swaps leader/follower roles in epoch 2, starts all workers with generation+1, runs online/preflight checks, records the transition, and rejects running sessions, leaders, quarantined followers, and failed preflight without mutating the prior epoch.

- [x] **Step 2: Verify RED**

Run the focused runtime and route tests; they must fail because `promoteLeader` and its route are absent.

- [x] **Step 3: Implement the protected operation**

Add `POST /api/sessions/:id/devices/:serial/promote-leader` with auth, CSRF, bounded reason, and the same transactional rebuild/rollback pattern as rejoin.

### Task 2: Verify and record

**Files:**
- Create: `docs/milestones/M9-task29-leader-promotion-acceptance.md`
- Modify: `docs/milestones/M9-acceptance.md`

- [x] **Step 1: Run focused tests, full tests, typecheck, lint, format, and CodeGraph**

Record exact results; no real-device claim is made without a paused multi-device run.

- [x] **Step 2: Record the boundary**

Document that promotion is backend/API complete; a console promotion control and physical two-device acceptance remain separate follow-up gates.

- [x] **Step 3: Stop for user approval**

Keep changes local until user approval, then commit and push to `origin/main`.
