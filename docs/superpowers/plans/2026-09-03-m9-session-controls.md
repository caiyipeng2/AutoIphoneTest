# M9 Session Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing pause and explicit resume operations in the Sessions console.

**Architecture:** The page keeps one session state snapshot and calls the existing authenticated session mutations. Refresh reads the current snapshot, pause transitions `RUNNING -> PAUSED`, and resume invokes the generation/epoch-safe backend rebuild. Controls are disabled while a request is in flight and use Lucide icons with accessible labels.

**Tech Stack:** React, TypeScript, Lucide React, Vitest Testing Library, existing Fastify session API.

---

### Task 1: Add session mutation clients and console controls

**Files:**
- Modify: `apps/console/src/state/api.ts`
- Modify: `apps/console/src/pages/SessionsPage.tsx`
- Modify: `apps/console/src/pages/SessionsPage.test.tsx`

- [x] **Step 1: Write a failing page test**

Create a session fixture, pause it from the page, and resume it again. Assert the visible state changes and that the pause/resume requests carry the operator reasons.

- [x] **Step 2: Verify the page test fails**

Run `npx vitest run apps/console/src/pages/SessionsPage.test.tsx`; it must fail because the controls and API clients are absent.

- [x] **Step 3: Implement the minimal API and controls**

Add `pauseSession`, `resumeSession`, and `refreshSession` clients. Render fixed-size icon+text controls in the session header, with disabled/loading states and a refresh action that reloads the server snapshot.

### Task 2: Verify and record the UI slice

**Files:**
- Create: `docs/milestones/M9-task25-session-controls-acceptance.md`
- Modify: `docs/milestones/M9-acceptance.md`

- [x] **Step 1: Run page tests, full tests, typecheck, lint, and changed-file Prettier**

Record exact results and ensure no generated Unity files are included in formatting claims.

- [x] **Step 2: Record the boundary**

Document that console pause/resume is complete; action retry UI, skip, rejoin, and leader promotion remain separate.

- [x] **Step 3: Stop for user approval**

Keep changes local until the user confirms this UI slice, then commit and push to `origin/main`.
