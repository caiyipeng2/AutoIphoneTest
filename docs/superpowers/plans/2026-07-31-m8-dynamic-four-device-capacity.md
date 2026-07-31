# M8 Dynamic One-to-Four Device Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support every run/deployment capacity from one through four selected devices with exactly one leader, isolated workers/ports/logs/evidence, and a proven four-device 30-minute/1,000-action soak.

**Architecture:** Capacity is validated centrally as 1-4 unique original members. Deployment and preflight use bounded per-device concurrency and produce one durable result per serial. A resource allocator leases collision-checked port bundles and serial-owned paths; the UI derives layout from member count without changing leader dimensions. Four-device evidence proves isolation, not merely functional success.

**Tech Stack:** Existing Appium/session/deployment stack, SQLite, React CSS grid, Vitest, Playwright, and four real Android devices for final acceptance.

---

## Task 1: Generalize Membership and Actions to 1-4 Devices

**Files:**
- Modify: `packages/contracts/src/session.ts`
- Modify: `packages/sessions/src/run-membership.ts`
- Modify: `packages/sessions/src/run-membership.test.ts`
- Modify: `packages/sessions/src/action-barrier.ts`
- Modify: `packages/sessions/src/action-dispatcher.ts`
- Create: `packages/sessions/src/capacity-matrix.test.ts`

- [ ] **Step 1: Write failing 1/2/3/4 capacity tests**

For each capacity require unique serials, exactly one leader and 0-3 followers, stable original order, one target/result per active member, concurrent dispatch, pause when leader fails, follower quarantine only when at least leader remains, no autojoin, and same-original-serial rejoin fencing.

- [ ] **Step 2: Verify tests fail at capacities 3 and 4**

Expected: the current M7 min-one/max-two validation accepts one and two devices but rejects three and four.

- [ ] **Step 3: Implement bounded capacity validation**

Replace max-two assumptions with `RunCapacitySchema` min 1/max 4 and one leader refinement. All loops operate on membership snapshots; no `follower` singleton remains. `Promise.allSettled` creates before-await dispatch for every active target while the run still permits one group action in flight.

- [ ] **Step 4: Run tests and commit**

```powershell
git add packages/contracts/src/session.ts packages/sessions
git commit -m "feat: generalize sessions to four devices"
git push
```

## Task 2: Generalize Deployment to 1-4 Serial-Specific Results

**Files:**
- Modify: `packages/contracts/src/deployment.ts`
- Modify: `packages/deployments/src/deployment-orchestrator.ts`
- Modify: `packages/deployments/src/deployment-orchestrator.test.ts`
- Create: `packages/deployments/src/multi-device-deployment.test.ts`
- Modify: `apps/server/src/routes/deployments.ts`

- [ ] **Step 1: Write failing multi-device deployment tests**

Cover 1-4 unique targets, one `deployment_device` result per target even before subprocess start, max-two concurrent AAB conversions/max-four installs, different device specs producing different install-set keys, universal mode explicit reuse, one signer mismatch not erasing other results, cancellation, and retry scoped to selected failed serials.

- [ ] **Step 2: Verify capacities above one fail**

Expected: M4 API/orchestrator accepts exactly one serial.

- [ ] **Step 3: Implement per-target preparation and result isolation**

Create all target rows transactionally. Collect/canonicalize every device spec first; group only identical cache keys; generate missing sets with a semaphore of two; install with a semaphore of four. Each log/temp/final path includes deployment ID and sanitized serial directory. Aggregate state is derived from target states, never used to overwrite them.

- [ ] **Step 4: Enforce full installed identity across the group**

After install/re-observation compare package, version, signer, and installed-set digest/build ID. Preflight blocks mixed identity. Clear-data/uninstall confirmation is bound to the exact sorted serial set and invalidates each serial generation independently.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/contracts/src/deployment.ts packages/deployments apps/server/src/routes/deployments.ts
git commit -m "feat: deploy artifacts to selected device groups"
git push
```

## Task 3: Allocate Four Isolated Worker Resource Bundles

**Files:**
- Modify: `packages/appium/src/port-allocator.ts`
- Modify: `packages/appium/src/port-allocator.test.ts`
- Create: `packages/sessions/src/worker-manager.ts`
- Create: `packages/sessions/src/worker-manager.test.ts`
- Modify: `packages/video/src/tango-scrcpy-provider.ts`
- Modify: `packages/evidence/src/evidence-manifest.ts`
- Create: `tests/integration/four-worker-isolation.test.ts`

- [ ] **Step 1: Write failing four-worker isolation tests**

Assert unique Appium/system/MJPEG/bridge-forward/video ports, serial on every ADB/Appium capability, worker generation, logcat process, bridge state, preview provider, and evidence directory. Simulate one port occupied, one worker rebuild, interleaved events, and identical action IDs across devices; prove no cross-routing/overwrite.

- [ ] **Step 2: Verify tests fail**

Expected: allocator/manager assumptions fail above two workers.

- [ ] **Step 3: Implement atomic bundle leasing**

Lease the whole port/path bundle in one transaction after OS bind probes. A partial allocation publishes nothing. Worker manager keys only by `{runId, serial, generation}` and rejects a second active owner. Cleanup removes only leases/forwards/PIDs carrying the same owner start token.

- [ ] **Step 4: Add video resource profiles**

Leader uses interactive profile. Followers default to low-FPS/low-bitrate; at most one expanded follower may temporarily use interactive preview. Backpressure queues remain <=2 per stream. Video degradation cannot block action results/evidence.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/appium packages/sessions/src/worker-manager* packages/video/src/tango-scrcpy-provider.ts packages/evidence/src/evidence-manifest.ts tests/integration/four-worker-isolation.test.ts
git commit -m "feat: isolate four device workers"
git push
```

## Task 4: Build Dynamic Selection, Deployment, and Session Layouts

**Files:**
- Modify: `apps/console/src/features/deployments/DeploymentForm.tsx`
- Modify: `apps/console/src/features/sessions/RunDeviceStrip.tsx`
- Create: `apps/console/src/features/sessions/DeviceSelectionDialog.tsx`
- Create: `apps/console/src/features/sessions/FollowerGrid.tsx`
- Create: `apps/console/src/features/sessions/CapacityLayouts.test.tsx`
- Create: `tests/e2e/capacity-matrix.spec.ts`

- [ ] **Step 1: Write failing UI capacity tests**

Cover selecting 0/1/2/3/4/5, duplicate rejection, leader radio selection, 1-device single-mode label, 2-4 sync-mode labels, offline/occupied/identity mismatch reasons, leader-video default and individually selected follower video, follower grid at 0-3, expansion, narrow desktop, and action timeline results for every selected serial.

- [ ] **Step 2: Verify tests fail**

Expected: exact one/two device controls fail matrix.

- [ ] **Step 3: Implement device selection controls**

Use checkboxes for membership and one radio/segmented leader choice among selected online devices. Show `1/4` through `4/4` count; disable the fifth selection with an explicit reason. Evidence options recommend leader video and leave followers off until explicitly checked. Preflight summary lists version/signer/build ID/UID/bridge/orientation per serial plus estimated video/storage load.

- [ ] **Step 4: Implement stable responsive grids**

Leader remains the primary fixed-aspect viewport. Followers use one column beside leader where space permits and a two-column preview grid below at narrower widths. Tiles have stable aspect ratio/min height; live labels and errors cannot resize the overall run controls.

- [ ] **Step 5: Run tests/build and commit**

```powershell
git add apps/console/src/features/deployments/DeploymentForm.tsx apps/console/src/features/sessions tests/e2e/capacity-matrix.spec.ts
git commit -m "feat: add dynamic device capacity UI"
git push
```

## Task 5: Execute the Capacity Matrix and Four-Device Soak

**Files:**
- Create: `tests/hardware/m8-capacity-matrix.ts`
- Create: `tests/hardware/m8-four-device-soak.ts`
- Create: `tests/hardware/soak-analyzer.ts`
- Create: `docs/milestones/M8-acceptance.md`

- [ ] **Step 1: Require and inventory four explicit unique serials**

Read `TEST_CENTER_DEVICE_SERIALS` as exactly four comma-separated serials, verify all online, collect identity/ports/USB paths, and abort before deployment/action if duplicates or fewer than four. Do not substitute fake adapters for this gate.

- [ ] **Step 2: Run 1/2/3/4 deployment and session combinations**

For each capacity, deploy/verify the QA APK or AAB, select each possible leader as applicable, start/finish a run, and verify exact result/evidence directories. For AAB ensure incompatible device specs use different generated-set hashes; installed identity must match semantically across targets.

- [ ] **Step 3: Run the 30-minute/1,000-action four-device soak**

Use a deterministic tap/swipe sequence with periodic checkpoints and follower preview expansion. Record CPU/RSS/handles, USB/ADB reconnects, per-port ownership, per-serial actions/ACKs/log paths, dispatch/receipt skew, and evidence hashes. Require zero serial cross-talk, port collision, evidence overwrite, and unaccounted action result.

- [ ] **Step 4: Analyze isolation automatically**

`soak-analyzer.ts` loads DB and manifests, asserts 1,000 actions x 4 target results, unique `{run,action,serial}` rows/paths, serial in every worker log, no file hash/path collision, and elapsed >=30 minutes. Output signed/hash-recorded JSON/HTML analysis.

- [ ] **Step 5: Run complete automated verification**

Run unit/integration/UI/E2E suites. Expected: zero failures.

- [ ] **Step 6: Record, commit, push, and stop**

Document capacity table, install-set identities, soak analyzer hash/results, resource graphs, known hardware constraints, and rollback in `docs/milestones/M8-acceptance.md`. Commit/push and stop. If four physical devices are unavailable or any soak invariant fails, keep M8 unaccepted and do not begin M9.
