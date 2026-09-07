# M9 Leader Promotion Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose paused-session Leader promotion in the Sessions console.

**Architecture:** The page calls the existing protected promotion endpoint and updates the session snapshot after a successful role swap. The control is rendered only for active followers while the session is `PAUSED`, has a stable loading state, and uses text plus a Lucide Crown icon so role state is not conveyed by color alone.

**Tech Stack:** React, TypeScript, Lucide React, Vitest Testing Library, existing Fastify session API.

---

### Task 1: Add console promotion client and control

**Files:**
- Modify: `apps/console/src/state/api.ts`
- Modify: `apps/console/src/pages/SessionsPage.tsx`
- Modify: `apps/console/src/pages/SessionsPage.test.tsx`
- Modify: `apps/console/src/styles.css`

- [x] **Step 1: Write failing page test**

Render a paused session with an active follower, assert the promotion button is visible, click it, verify a fresh POST reason, and assert the returned session leader changes.

- [x] **Step 2: Verify RED**

Run `npx vitest run apps/console/src/pages/SessionsPage.test.tsx`; it must fail because the API client and control are absent.

- [x] **Step 3: Implement the button and handler**

Add `promoteLeaderSession`, track the promoting serial, render one button per eligible follower, disable it while busy, and refresh action/session state after success.

### Task 2: Verify and record

**Files:**
- Create: `docs/milestones/M9-task30-leader-promotion-console-acceptance.md`
- Modify: `docs/milestones/M9-acceptance.md`
- Modify: `docs/milestones/M9-task29-leader-promotion-acceptance.md`

- [x] **Step 1: Run focused tests, full tests, console build, typecheck, lint, formatting, and CodeGraph**

Record exact results. No physical-device acceptance is included.

- [x] **Step 2: Record the boundary**

Document that promotion is now available in the console while real two-device promotion remains a separate hardware gate.

- [ ] **Step 3: Stop for user approval**

Keep changes local until user approval, then commit and push to `origin/main`.
