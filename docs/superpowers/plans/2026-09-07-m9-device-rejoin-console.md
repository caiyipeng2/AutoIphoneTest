# M9 Device Rejoin Console Implementation Plan

**Goal:** Expose the existing paused-run quarantined-follower rejoin command in the Sessions console.

### Task 1: Add the console rejoin control

**Files:**
- Modify: `apps/console/src/state/api.ts`
- Modify: `apps/console/src/pages/SessionsPage.tsx`
- Modify: `apps/console/src/pages/SessionsPage.test.tsx`
- Modify: `apps/console/src/styles.css`

- [x] Write a failing page test for a paused quarantined follower.
- [x] Verify RED.
- [x] Add the protected rejoin client, handler, loading state, and eligible-member button.

### Task 2: Verify and record

**Files:**
- Create: `docs/milestones/M9-task32-device-rejoin-console-acceptance.md`
- Modify: `docs/milestones/M9-acceptance.md`
- Modify: `docs/milestones/M9-task28-device-rejoin-acceptance.md`

- [x] Run focused tests, full tests, typecheck, lint, console build, formatting, and CodeGraph.
- [x] Record that physical quarantine/rejoin remains a separate hardware gate.
- [x] Stop for user approval before commit and push.
