# M7 One-Leader One-Follower Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the accepted one-device evidence mode while adding concurrent leader tap/swipe reproduction on one follower with safe-area mapping, calibrated bridge receipts, fixed membership, leader-loss pause, and fenced follower quarantine/rejoin.

**Architecture:** A run accepts one or two immutable original serials plus append-only `RunDevice` membership history. One-device runs retain the M6 path unchanged. For a two-device run, both workers pass a view/focus/geometry/package barrier; one transaction snapshots the current epoch/generations and creates two results. Dispatch starts concurrently, receipts are converted through per-worker clock calibrations, and every late result is fenced by membership epoch and worker generation.

**Tech Stack:** Existing M6 Appium/view/session stack, Unity QA bridge, SQLite, React, Vitest, Playwright, and two real Android devices.

---

## Task 1: Implement Fixed Membership, Roles, Epochs, and Rejoin

**Files:**
- Modify: `packages/contracts/src/session.ts`
- Create: `packages/sessions/src/run-membership.ts`
- Create: `packages/sessions/src/run-membership.test.ts`
- Modify: `packages/sessions/src/run-repository.ts`
- Create: `packages/database/src/migrations/0007_run_membership.sql`

- [ ] **Step 1: Write failing membership tests**

Cover one or two original serials, exactly one leader and zero or one follower, no duplicate serial, no new hot-add, follower quarantine, same-serial rejoin after full preflight, epoch increment, worker generation increment, leader disconnect always pause, sole/current leader quarantine rejection, and paused promotion of the original follower after full preflight. Re-run the M6 one-device membership/action fixtures and require byte-equivalent target snapshots/results for that mode.

```ts
expect(() => membership.add("never-selected" as DeviceSerial)).toThrow(/original member/i);
expect(membership.quarantine(leaderSerial)).toMatchObject({ ok: false, code: "LEADER_MUST_PAUSE" });
```

- [ ] **Step 2: Run tests and verify the missing two-device transitions fail**

Expected: the existing one-device suite still passes while new two-device membership transitions fail because they are missing.

- [ ] **Step 3: Implement append-only membership transitions**

Migration `0007_run_membership.sql` adds append-only membership transitions without changing the already-applied M6 migration. Persist `ACTIVE`, `QUARANTINED`, `RECOVERING`, `LEFT`, role, epoch, generation, timestamp, reason, and actor. `snapshotForAction()` returns only active members from one epoch and always exactly one leader. Promote/rejoin creates a new epoch; old rows/results remain immutable.

- [ ] **Step 4: Run tests and commit**

```powershell
git add packages/contracts/src/session.ts packages/sessions/src/run-membership* packages/sessions/src/run-repository.ts packages/database/src/migrations/0007_run_membership.sql
git commit -m "feat: add fenced run membership"
git push
```

## Task 2: Add Two-Worker Precondition Barrier and Concurrent Dispatch

**Files:**
- Create: `packages/sessions/src/action-barrier.ts`
- Create: `packages/sessions/src/action-barrier.test.ts`
- Modify: `packages/sessions/src/action-dispatcher.ts`
- Modify: `packages/sessions/src/action-dispatcher.test.ts`
- Create: `packages/sessions/src/skew-metrics.ts`
- Create: `packages/sessions/src/skew-metrics.test.ts`

- [ ] **Step 1: Write failing barrier/dispatch tests**

Assert both workers validate package/installed identity, foreground, bridge instance, UID generation, view, orientation, safe area/metrics epoch, and clock uncertainty before any injection. Assert dispatch promises are created before awaiting, host start times are recorded from one host monotonic clock, one failure still yields two results, and stale-generation replies cannot complete current rows.

- [ ] **Step 2: Verify tests fail**

Expected: current dispatcher has a one-target assumption.

- [ ] **Step 3: Implement all-target barrier**

Collect preconditions concurrently with a bounded deadline. If any required target fails, send no input and apply `PAUSE_ALL` in M7. Persist a categorized barrier result for both devices. Capture target geometry/state snapshots used by mapping and descriptor hashes.

- [ ] **Step 4: Implement concurrent dispatch and metrics**

Call both worker `dispatch()` methods in the same synchronous turn, then `await Promise.allSettled`. Persist per-device host dispatch start/end, Appium completion, calibrated device-observed ACK plus uncertainty, and host log-arrival. Calculate skew only from eligible samples; return unavailable with reasons when calibration bounds fail.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/sessions/src/action-barrier* packages/sessions/src/action-dispatcher* packages/sessions/src/skew-metrics*
git commit -m "feat: dispatch synchronized two-device actions"
git push
```

## Task 3: Generalize Safe-Area Mapping and Two-Device Accuracy Fixtures

**Files:**
- Modify: `packages/sessions/src/coordinate-mapper.ts`
- Modify: `packages/sessions/src/coordinate-mapper.test.ts`
- Modify: `packages/unity-qa-bridge/verification-project/Assets/Scripts/FixtureTarget.cs`
- Create: `tests/fixtures/sessions/device-geometries.json`
- Create: `tests/hardware/qa-target-sequence.json`

- [ ] **Step 1: Write failing cross-resolution mapping tests**

Use portrait geometries with different resolutions, densities, navigation insets, cutouts, and safe areas. Assert normalized leader coordinates reach the corresponding follower region, Unity bottom-left to Android top-left conversion, endpoint error calculation, out-of-bounds rejection, and orientation mismatch rejection.

- [ ] **Step 2: Verify tests fail for follower geometries**

Expected: current mapper supports only source equals target.

- [ ] **Step 3: Implement snapshot-to-snapshot mapping**

Map normalized paths from the leader safe-area snapshot into each target safe-area snapshot. Round at the final Android coordinate step, retain floating-point mapped coordinates in evidence, and attach source/target metrics epochs. Never use current mutable device state after barrier completion.

- [ ] **Step 4: Add deterministic QA hit counters**

The fixture reports target ID, observed local coordinate, endpoint, and action ID through state/ACK evidence. `qa-target-sequence.json` contains exactly 100 taps across edge/center targets and 20 straight swipes with expected normalized endpoints.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/sessions/src/coordinate-mapper* packages/unity-qa-bridge/verification-project/Assets/Scripts/FixtureTarget.cs tests/fixtures/sessions tests/hardware/qa-target-sequence.json
git commit -m "test: add cross-device coordinate mapping gates"
git push
```

## Task 4: Add Follower Preview, Per-Device Results, and Recovery Controls

**Files:**
- Modify: `apps/server/src/routes/sessions.ts`
- Modify: `apps/console/src/features/sessions/LeaderViewport.tsx`
- Create: `apps/console/src/features/sessions/FollowerPreview.tsx`
- Create: `apps/console/src/features/sessions/RunDeviceStrip.tsx`
- Modify: `apps/console/src/features/sessions/ActionTimeline.tsx`
- Create: `apps/console/src/features/sessions/RecoveryDialog.tsx`
- Create: `apps/console/src/features/sessions/TwoDeviceSession.test.tsx`
- Create: `tests/e2e/two-device-session.spec.ts`

- [ ] **Step 1: Write failing API/UI tests**

Cover selecting exactly two devices/leader, preflight states, low-rate follower preview, per-device action cells, skew eligible/unavailable labels, follower disconnect pause, quarantine, rejoin progress/new epoch, old response ignored, leader loss pause, and leader promotion only while paused.

- [ ] **Step 2: Verify tests fail**

Expected: UI/API assume one device.

- [ ] **Step 3: Extend session commands safely**

Add pause, quarantine follower, begin rejoin, complete rejoin, and promote leader endpoints. All require current run version/epoch and CSRF; stale browser requests return 409 with the latest snapshot. M7 default remains pause-all.

- [ ] **Step 4: Implement compact synchronized UI**

Keep leader viewport size stable. Show one follower tile with preview, UID/view/epoch/generation/latency. Timeline uses one row per action and expandable per-device results; recovery is a modal with explicit consequences. Status text never overlaps video or controls.

- [ ] **Step 5: Run tests/build and commit**

```powershell
git add apps/server/src/routes/sessions.ts apps/console/src/features/sessions tests/e2e/two-device-session.spec.ts
git commit -m "feat: add two-device session operations"
git push
```

## Task 5: Run Two-Device Accuracy, Skew, and Fencing Acceptance

**Files:**
- Create: `tests/hardware/m7-two-device-sync.ts`
- Create: `tests/hardware/m7-follower-rejoin.ts`
- Create: `docs/milestones/M7-acceptance.md`

- [ ] **Step 1: Require two explicit unique serials**

The hardware runner requires `TEST_CENTER_LEADER_SERIAL` and `TEST_CENTER_FOLLOWER_SERIAL`, verifies both online and QA fixture identity, and aborts before actions when equal/missing or clock uncertainty is outside the configured receipt-skew bound.

- [ ] **Step 2: Run accuracy and skew sequence**

Execute the fixed 100 taps and 20 swipes. Require >=99 tap hits on each device, every swipe endpoint within 2% of its safe-viewport dimension, dispatch-start P95 <=50 ms, and calibrated receipt P95 <=250 ms with uncertainty recorded for every sample.

- [ ] **Step 3: Run leader/follower fault sequence**

Disconnect follower: run pauses; quarantine; reconnect; full preflight; rejoin increments epoch/generation; inject a fake late old response and prove it is fenced. Disconnect leader and prove immediate pause with no follower-only continuation.

- [ ] **Step 4: Run complete automated verification and the M6 regression suite**

Run Vitest, TypeScript, ESLint, console build, Unity fixture tests, Playwright, and the complete M6 single-device integration/E2E suite. Expected: zero failures for both one- and two-device modes.

- [ ] **Step 5: Record, commit, push, and stop**

Write action/result CSV/JSON hashes, coordinate report, clock calibration/uncertainty, rejoin timeline, screenshots, limitations, and rollback in `docs/milestones/M7-acceptance.md`. Commit/push, verify clean branch, and stop. If only one device is available, report M7 physical gate unaccepted and do not begin M8.
