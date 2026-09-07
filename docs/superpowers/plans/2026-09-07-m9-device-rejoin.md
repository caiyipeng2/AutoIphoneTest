# M9 Quarantined Device Rejoin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rejoin a quarantined follower after an operator verifies it is online, rebuilding the full active worker group without replaying actions.

**Architecture:** Rejoin is allowed only from a `PAUSED` run and only for a current-epoch `QUARANTINED` follower. The service verifies registry online state and the existing preflight probe, starts fresh workers for active members plus the target with incremented generations, then atomically advances the run epoch and writes `OPERATOR_REJOINED`. Failures stop newly started workers and leave the database paused.

**Tech Stack:** Fastify, SQLite, TypeScript, existing worker coordinator and preflight probe, Vitest.

---

### Task 1: Add rejoin runtime contract

**Files:**
- Modify: `apps/server/src/routes/sessions.ts`
- Modify: `apps/server/src/session-runtime.ts`
- Modify: `apps/server/src/session-runtime.test.ts`
- Modify: `apps/server/src/routes/sessions.test.ts`

- [x] **Step 1: Write failing runtime/API tests**

Assert a paused run with a quarantined follower verifies online state and preflight, starts the active leader plus rejoined follower with generation+1, advances epoch, records `OPERATOR_REJOINED`, and returns `RUNNING`. Assert leader or active target failures, non-quarantined targets, and non-paused runs are rejected without changing membership.

- [x] **Step 2: Verify tests fail**

Run the focused runtime and route tests; they must fail because `rejoinDevice` and the protected route are absent.

- [x] **Step 3: Implement the protected command**

Add `POST /api/sessions/:id/devices/:serial/rejoin` with bounded reason, authentication, host/origin, and CSRF checks. Rebuild workers using the existing generation map and never invoke action dispatch or replay.

### Task 2: Verify and record the slice

**Files:**
- Create: `docs/milestones/M9-task28-device-rejoin-acceptance.md`
- Modify: `docs/milestones/M9-acceptance.md`

- [x] **Step 1: Run focused tests, full tests, typecheck, lint, formatting, and CodeGraph**

Record exact results; no physical hardware claim is made unless a quarantined device is actually available.

- [x] **Step 2: Record the boundary**

Document that rejoin is paused-state only and that Leader promotion and physical dual-device rejoin remain separate gates.

- [x] **Step 3: Stop for user approval**

Keep changes local until the user confirms this slice, then commit and push to `origin/main`.
