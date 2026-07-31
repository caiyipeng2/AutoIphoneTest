# M9 Complete Actions and Failure Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the first-version action set and prove default pause-all plus optional follower quarantine behavior under disconnect, session loss, crash/foreground drift, bridge mismatch, text-focus mismatch, and recovery without automatic replay.

**Architecture:** `ActionCommand` is a closed discriminated union with action-specific preconditions, Appium execution, bridge applicability, redaction, and postconditions. A fault monitor emits typed incidents into a deterministic policy engine; the policy pauses the run or quarantines eligible followers within two seconds. Recovery never resumes a stale worker/action and every retry/rejoin creates linked new identity records.

**Tech Stack:** Existing Appium/bridge/session stack, typed incident/policy engine, SQLite audit records, React controls, Vitest, Playwright, and representative real devices.

---

## Task 1: Complete the Closed Action Union and Device Execution

**Files:**
- Modify: `packages/contracts/src/session.ts`
- Create: `packages/sessions/src/action-command.ts`
- Create: `packages/sessions/src/action-command.test.ts`
- Modify: `packages/sessions/src/device-worker.ts`
- Modify: `packages/appium/src/w3c-client.ts`
- Modify: `packages/appium/src/w3c-client.test.ts`

- [ ] **Step 1: Write failing action mapping tests**

Cover tap, long press, drag/swipe, Back, masked text, activate, terminate, and restart. Assert exact W3C/key/lifecycle calls, duration/range bounds, no empty text, package fixed from run identity, and the ACK matrix: input actions arm/ACK, activate waits fresh bridge state, terminate uses process absence, restart uses terminate then fresh bridge instance.

```ts
expect(actionPolicy({ type: "terminate" })).toEqual({ armBridge: false, completion: "PROCESS_ABSENT" });
expect(actionPolicy({ type: "restart" })).toEqual({ armBridge: false, completion: "FRESH_BRIDGE_STATE" });
```

- [ ] **Step 2: Run tests and verify unsupported action failures**

Expected: M8 supports only tap/swipe.

- [ ] **Step 3: Implement bounded command schemas**

Long press 300-10,000 ms; swipe/drag path 2-128 points and 50-30,000 ms; text 1-2,000 Unicode scalar values; lifecycle package comes only from run artifact. Reject multi-touch/pinch/rotation mapping. Canonical descriptor hashing includes only masked text length/class hash, never plaintext by default.

- [ ] **Step 4: Implement worker execution/postconditions**

Use W3C pointer sequences for press/path actions, `mobile: pressKey`/typed endpoint for Back, Unicode-capable Appium text input, and W3C app lifecycle endpoints. Each operation records Appium event timings, foreground/process/bridge postcondition, and categorized failure. No generic execute-script API is exposed outside the adapter.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/contracts/src/session.ts packages/sessions/src/action-command* packages/sessions/src/device-worker.ts packages/appium/src/w3c-client*
git commit -m "feat: complete synchronized action commands"
git push
```

## Task 2: Enforce Trusted Text Focus and Evidence Masking

**Files:**
- Create: `packages/sessions/src/text-focus-barrier.ts`
- Create: `packages/sessions/src/text-focus-barrier.test.ts`
- Create: `packages/evidence/src/text-redactor.ts`
- Create: `packages/evidence/src/text-redactor.test.ts`
- Modify: `packages/sessions/src/action-barrier.ts`
- Modify: `packages/bridge/src/arm-controller.ts`

- [ ] **Step 1: Write failing focus/redaction tests**

Assert synchronized text sends to no device unless every active target reports the same stable trusted `focusedControlId` (or future trusted provider identity), same view/metrics epoch, and current bridge instance. Cover missing bridge, one different focus, focus changes between barrier/arm, CJK, emoji, newline rejection policy, and secrets in logs/errors/reports.

- [ ] **Step 2: Verify tests fail**

Expected: text/focus path is absent.

- [ ] **Step 3: Implement focus barrier**

Capture two state samples separated by one rendered frame or configured 50 ms and require unchanged nonempty control IDs across all targets. Include focus in arm descriptor and recheck before Appium text. Any mismatch cancels the whole group action with per-target barrier results.

- [ ] **Step 4: Implement default masking**

Persist text length, Unicode category summary, salted run-scoped SHA-256, and `masked=true`; process/bridge logs replace exact plaintext plus common escaped forms. Clear test text requires an explicit run option and warning, and is still redacted from host service logs.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/sessions/src/text-focus-barrier* packages/sessions/src/action-barrier.ts packages/bridge/src/arm-controller.ts packages/evidence/src/text-redactor*
git commit -m "feat: protect synchronized text input"
git push
```

## Task 3: Add Typed Incidents and Deterministic Failure Policies

**Files:**
- Create: `packages/contracts/src/incident.ts`
- Create: `packages/database/src/migrations/0008_incidents_recovery.sql`
- Create: `packages/sessions/src/fault-monitor.ts`
- Create: `packages/sessions/src/fault-monitor.test.ts`
- Create: `packages/sessions/src/failure-policy.ts`
- Create: `packages/sessions/src/failure-policy.test.ts`
- Create: `packages/sessions/src/recovery-service.ts`
- Create: `packages/sessions/src/recovery-service.test.ts`

- [ ] **Step 1: Write failing policy matrix tests**

Incidents: `ADB_DISCONNECTED`, `APPIUM_SESSION_LOST`, `APP_CRASH_OR_ANR`, `WRONG_FOREGROUND`, `BRIDGE_TIMEOUT`, `BRIDGE_STATE_MISMATCH`, `TEXT_FOCUS_MISMATCH`, `METRICS_CHANGED`, and `LOW_DISK`. For each test pause-all and quarantine-failed-device, leader/sole-member override to pause, max response 2 s, no new action after incident, and immutable recovery decisions.

- [ ] **Step 2: Verify tests fail**

Expected: no common incident/policy engine.

- [ ] **Step 3: Implement monitors and persisted incidents**

Combine ADB discovery events, Appium command/session health, process/foreground polling, crash/ANR log patterns, bridge state, text barrier, metrics epoch, and disk monitor. Deduplicate by `{run,serial,category,generation}` within a bounded window but append status changes. Persist detection host monotonic/wall time and source evidence.

- [ ] **Step 4: Implement policies**

Default `PAUSE_ALL`: transition run and reject subsequent action creation. `QUARANTINE_FAILED_DEVICE`: only an active follower is removed from next epoch; leader/sole-member pauses. A policy action first fences the worker and snapshots evidence, then changes membership. Response metric ends at persisted pause/quarantine.

- [ ] **Step 5: Implement explicit recovery**

Commands are retry-as-new-action, skip, restart app, rebuild worker, rejoin original serial, promote leader while paused, or finish. Rebuild/rejoin increments generation/epoch and requires full identity/UID/bridge/geometry/focus preflight. No command automatically replays an uncertain action.

- [ ] **Step 6: Run tests and commit**

```powershell
git add packages/contracts/src/incident.ts packages/database/src/migrations/0008_incidents_recovery.sql packages/sessions/src/fault-monitor* packages/sessions/src/failure-policy* packages/sessions/src/recovery-service*
git commit -m "feat: add synchronized failure policies"
git push
```

## Task 4: Add Full Run Controls, Incident Timeline, and Fault Harness

**Files:**
- Modify: `apps/server/src/routes/sessions.ts`
- Create: `apps/server/src/routes/incidents.ts`
- Create: `apps/console/src/features/sessions/ActionToolbar.tsx`
- Create: `apps/console/src/features/sessions/TextInputDialog.tsx`
- Create: `apps/console/src/features/sessions/IncidentTimeline.tsx`
- Modify: `apps/console/src/features/sessions/RecoveryDialog.tsx`
- Create: `apps/console/src/features/sessions/FailurePolicyControl.tsx`
- Create: `apps/console/src/features/sessions/ActionsAndFailures.test.tsx`
- Create: `tests/faults/fake-fault-controller.ts`
- Create: `tests/e2e/actions-and-failures.spec.ts`

- [ ] **Step 1: Write failing API/UI/E2E tests**

Cover icon controls/tooltips, long-press/drag settings, Back, masked text preview, lifecycle confirmation, policy choice default, incident within two seconds, disabled actions while paused, quarantine eligibility, recovery decisions, retry parent link, missing focus, and browser refresh during recovery.

- [ ] **Step 2: Verify tests fail**

Expected: missing full action/fault surfaces.

- [ ] **Step 3: Implement safe controls and endpoints**

Toolbar uses familiar lucide icons and fixed-size buttons; text/lifecycle open purpose-specific dialogs. API accepts only closed action/recovery schemas, current run version/epoch, CSRF, and idempotency key. Failure policy is selected before start and cannot change while running.

- [ ] **Step 4: Implement deterministic fake fault injection**

Test-only adapter can disconnect a fake transport, expire Appium session, emit crash/wrong foreground/bridge mismatch/focus mismatch/metrics change/low disk. It is enabled only under test configuration and no fault endpoint exists in production build.

- [ ] **Step 5: Run tests/build and commit**

```powershell
git add apps/server/src/routes apps/console/src/features/sessions tests/faults tests/e2e/actions-and-failures.spec.ts
git commit -m "feat: add action and recovery operations"
git push
```

## Task 5: Execute Action and Physical Fault-Injection Acceptance

**Files:**
- Create: `tests/hardware/m9-action-matrix.ts`
- Create: `tests/hardware/m9-fault-matrix.ts`
- Create: `tests/hardware/m9-secret-scan.ts`
- Create: `docs/milestones/M9-acceptance.md`

- [ ] **Step 1: Run the full action matrix**

On representative selected real devices execute tap, long press, multiple swipe/drag paths, Back, ASCII/CJK text, activate, terminate, and restart. Verify device result/postcondition and action-specific bridge applicability. Confirm clear text never appears in DB/logs/reports when masked.

- [ ] **Step 2: Run physical faults under both policies**

Disconnect USB, kill one Appium session, force-stop/crash the QA app, switch foreground, inject bridge state mismatch, break text focus, rotate during gesture, and simulate low disk. Require persisted pause/quarantine within 2 s, leader override, evidence capture, and no subsequent blind action.

- [ ] **Step 3: Prove no automatic replay**

Disconnect after dispatch but before ACK, reconnect/rebuild, and inspect device/app state plus DB. Require original result `UNKNOWN`, zero automatic worker calls, and only a user-requested retry with a new action/client key and `parentActionId`.

- [ ] **Step 4: Run complete automated verification**

Run all unit/integration/UI/E2E/security tests and secret scan. Expected: zero failures and zero plaintext matches.

- [ ] **Step 5: Record, commit, push, and stop**

Write action/fault matrices, response timings, retry links, redaction scan, screenshots/log hashes, limitations, and rollback in `docs/milestones/M9-acceptance.md`. Commit/push and stop for user acceptance. Do not implement final reports before approval.
