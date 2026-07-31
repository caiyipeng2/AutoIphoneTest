# M6 Leader View and Single-Device Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a low-latency leader stream in the console and execute crash-safe, exactly-recorded tap/swipe actions on one device with no duplicate video-provider input and an indexed evidence manifest.

**Architecture:** A project-local Appium service owns one UiAutomator2 session with explicit serial/ports. A `ViewProvider` primary adapter uses the stable Tango 2.x client with scrcpy server 3.1 in control-disabled mode; a bounded WebSocket frame channel feeds browser WebCodecs, while Appium MJPEG/periodic screenshot is the degraded fallback. The session package transactionally creates sequential action/outbox/result rows before one worker injects input and reconciles crashes without replay.

**Tech Stack:** Appium 3.6.0, UiAutomator2 8.2.2, WebdriverIO client protocol or direct W3C HTTP adapter, Tango ADB 2.x, scrcpy server 3.1, WebCodecs, TypeScript, SQLite, React, Vitest, Playwright, and one real QA device.

---

## Task 1: Provision and Supervise Project-Local Appium

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `packages/appium/package.json`
- Create: `packages/appium/tsconfig.json`
- Create: `packages/appium/src/port-allocator.ts`
- Create: `packages/appium/src/port-allocator.test.ts`
- Create: `packages/appium/src/appium-service.ts`
- Create: `packages/appium/src/appium-service.test.ts`
- Create: `scripts/provision-appium.ps1`

- [ ] **Step 1: Write failing port/service tests**

Test deterministic serial-to-port allocation inside configured ranges, OS bind verification, lease persistence, release, collision retry, stale lease cleanup, loopback arguments, no relaxed security, explicit `APPIUM_HOME`, readiness timeout, and child-process-tree shutdown.

```ts
expect(service.args).toContain("127.0.0.1");
expect(service.args).not.toContain("--relaxed-security");
expect(new Set([lease.systemPort, lease.mjpegPort, lease.appiumPort]).size).toBe(3);
```

- [ ] **Step 2: Verify tests fail before dependencies/implementation**

Expected: missing package and service classes.

- [ ] **Step 3: Add exact Appium/Tango dependencies**

Pin Appium `3.6.0`, `appium-uiautomator2-driver` `8.2.2`, `@yume-chan/adb` `2.6.2`, `@yume-chan/adb-server-node-tcp` `2.5.2`, `@yume-chan/adb-scrcpy` `2.3.2`, `@yume-chan/scrcpy` `2.3.0`, and browser decoder `@yume-chan/scrcpy-decoder-webcodecs` `2.5.3`. Update lockfile with portable npm.

- [ ] **Step 4: Implement project-local driver provisioning**

`scripts/provision-appium.ps1` sets `APPIUM_HOME` to `data\appium-home`, invokes the project-local Appium CLI through portable Node, installs exactly UiAutomator2 `8.2.2` when absent, then runs `appium driver list --installed --json`. It never writes `%USERPROFILE%\.appium` or global npm.

- [ ] **Step 5: Implement service and port ownership**

Allocate one Appium server port plus per-worker system/MJPEG ports from configured ranges. Bind Appium to loopback, explicit base path and log file, with `--use-plugins` empty. Health-check `/status`; capture version/capabilities; persist leases with owner PID/start token so unrelated processes are never killed.

- [ ] **Step 6: Run tests/provisioning and commit**

```powershell
git add package.json package-lock.json packages/appium scripts/provision-appium.ps1
git commit -m "feat: provision isolated Appium runtime"
git push
```

## Task 2: Create a Fenced Single-Device UiAutomator2 Worker

**Files:**
- Create: `packages/appium/src/w3c-client.ts`
- Create: `packages/appium/src/w3c-client.test.ts`
- Create: `packages/sessions/package.json`
- Create: `packages/sessions/tsconfig.json`
- Create: `packages/sessions/src/device-worker.ts`
- Create: `packages/sessions/src/device-worker.test.ts`
- Create: `packages/contracts/src/session.ts`
- Create: `packages/contracts/src/logcat.ts`
- Create: `packages/adb/src/logcat-stream.ts`
- Create: `packages/adb/src/logcat-stream.test.ts`

- [ ] **Step 1: Write failing W3C/worker tests**

Use a fake Appium HTTP server. Assert new session includes `platformName=Android`, `appium:automationName=UiAutomator2`, explicit `udid`, `systemPort`, `mjpegServerPort`, `noReset=true`, `newCommandTimeout`, and event timings. Assert every response is rejected when session/serial/worker generation differs. Logcat tests require an explicit serial, fixed argument tokens, bounded line/byte parsing, ring-buffer eviction, segment rotation, partial-file recovery, process ownership, and no shell interpolation.

- [ ] **Step 2: Verify tests fail**

Expected: missing W3C client/worker.

- [ ] **Step 3: Implement a narrow W3C client**

Support only session create/delete, W3C pointer actions, screenshot, activate, terminate, press key, type, current package/activity, and settings used by this product. Validate every response with Zod, bound request/response sizes, time out with AbortSignal, and map Appium errors into stable categories. Expose no arbitrary execute-script route.

- [ ] **Step 4: Implement typed serial-bound logcat capture**

Spawn only the closed command `adb -s <serial> logcat -v threadtime` through the existing process runner and attach a host-monotonic receive timestamp. Parse into a versioned `LogcatRecord`, retain a bounded in-memory ring for immediate failure capture, rotate size/time-bounded raw segments under the serial-owned run directory, then close/hash/rename before emitting a typed `LogcatSegmentClosed` event to an injected sink. Task 2 tests use a fake sink; Task 5 owns evidence-manifest registration. Store process PID/start token and stop only that owned process. Raw segments are never report outputs; M10 must redact them before publication.

- [ ] **Step 5: Implement worker lifecycle**

`DeviceWorker.start()` checks current device/package identity, allocates ports, creates Appium session, starts the typed logcat stream plus bridge/view resources, and becomes `READY`. `stop()` rejects new actions, drains the current action only within a timeout, closes/flushes owned resources, and increments generation on rebuild. Late responses carry old generation and are fenced.

- [ ] **Step 6: Run tests and commit**

```powershell
git add packages/appium/src/w3c-client* packages/sessions packages/contracts/src/session.ts packages/contracts/src/logcat.ts packages/adb/src/logcat-stream*
git commit -m "feat: add fenced Appium device worker"
git push
```

## Task 3: Implement the Primary and Fallback ViewProvider

**Files:**
- Create: `packages/video/package.json`
- Create: `packages/video/tsconfig.json`
- Create: `packages/video/src/view-provider.ts`
- Create: `packages/video/src/latest-frame-buffer.ts`
- Create: `packages/video/src/latest-frame-buffer.test.ts`
- Create: `packages/video/src/tango-scrcpy-provider.ts`
- Create: `packages/video/src/tango-scrcpy-provider.test.ts`
- Create: `packages/video/src/mjpeg-provider.ts`
- Create: `packages/video/src/mjpeg-provider.test.ts`
- Create: `packages/video/src/video-recorder.ts`
- Create: `packages/video/src/video-recorder.test.ts`
- Create: `apps/server/src/ws/video-gateway.ts`
- Create: `scripts/provision-scrcpy.ps1`
- Create: `tests/bootstrap/provision-scrcpy.tests.ps1`

- [ ] **Step 1: Write failing provider-contract tests**

Assert frame metadata, monotonically unique frame IDs, max-two-frame queue, superseded-frame drop, control disabled, serial-specific ADB transport, first-frame timeout, clean cancellation, metrics epoch on rotation/size change, fallback/degraded reason, and optional recorder paths/process ownership. Provisioning tests prove wrong archive/server hashes never publish, required executable/server files match the M0 manifest, and reruns are idempotent.

- [ ] **Step 2: Verify tests fail**

Expected: missing scrcpy provisioning script and video package.

- [ ] **Step 3: Provision the pinned scrcpy 3.1 runtime**

`scripts/provision-scrcpy.ps1` reads exact Windows archive/server URLs and SHA-256 values from `tools/tool-manifest.json`, downloads to partial paths, verifies every expected file, and atomically publishes the CLI plus server under `tools\scrcpy\3.1`. It runs the explicit CLI version command and never uses PATH or a globally installed scrcpy. Any Tango adapter/server protocol mismatch fails before a device session starts.

- [ ] **Step 4: Implement Tango scrcpy 3.1 adapter**

Connect to the existing local ADB server for exactly one serial, push the pinned official scrcpy 3.1 server, start it with video enabled/audio/control/clipboard disabled, parse H.264 packets and device metadata, and publish `EncodedFrame` records. Encapsulate every Tango/scrcpy type in this package so sessions import only `ViewProvider`.

- [ ] **Step 5: Implement bounded WebSocket transport and fallback**

`/ws/video/:serial` requires session/Origin and a run ownership check, uses binary frames preceded by a bounded JSON metadata header, and drops rather than queues on backpressure. Fallback reads Appium MJPEG if available, otherwise periodic screenshots at no more than 2 FPS; it sets `degraded=true` and never claims the primary latency gate.

- [ ] **Step 6: Implement optional evidence recording**

`VideoRecorder` launches the pinned official scrcpy 3.1 CLI for the explicit serial with no window/audio/control/clipboard and a unique instance ID, writing Matroska to the serial's run evidence `.partial` path. Leader recording is the recommended enabled option but remains user-selectable. Stop waits for container finalization, validates duration/size, hashes/renames/registers evidence, and reports failure without losing action evidence. M8 may enable followers explicitly but never by default.

- [ ] **Step 7: Run provisioning, tests, and commit**

```powershell
git add packages/video apps/server/src/ws/video-gateway.ts scripts/provision-scrcpy.ps1 tests/bootstrap/provision-scrcpy.tests.ps1
git commit -m "feat: stream control-free leader video"
git push
```

## Task 4: Persist Sequential Actions and Reconcile Crashes

**Files:**
- Create: `packages/database/src/migrations/0006_runs_actions.sql`
- Create: `packages/sessions/src/run-repository.ts`
- Create: `packages/sessions/src/action-outbox.ts`
- Create: `packages/sessions/src/action-outbox.test.ts`
- Create: `packages/sessions/src/action-dispatcher.ts`
- Create: `packages/sessions/src/action-dispatcher.test.ts`
- Create: `packages/sessions/src/coordinate-mapper.ts`
- Create: `packages/sessions/src/coordinate-mapper.test.ts`

- [ ] **Step 1: Write failing atomicity/idempotency/geometry tests**

Assert one transaction creates action, membership snapshot, one result, and outbox; same client request/same payload returns same action; same key/different payload rejects; only one in-flight action; crash before lease yields `CANCELLED`; crash after lease yields `UNKNOWN`; neither replays; metrics epoch change cancels; safe-area mapping inverts Unity Y correctly.

- [ ] **Step 2: Verify tests fail**

Expected: missing migration/repositories.

- [ ] **Step 3: Add run/action schema**

Create `test_runs`, `run_devices`, `actions`, `action_targets`, `action_outbox`, `device_action_results`, and append-only transition tables. Enforce unique `(run_id, client_request_id)` and `(run_id, action_seq)`. M6 membership contains one leader at epoch 1/generation 1.

- [ ] **Step 4: Implement transaction and single-flight dispatcher**

Persist before dispatch. Lease the next sequence only when no prior action is nonterminal. Set target `DISPATCHING` before worker call; after Appium/bridge completion persist result and release. Startup reconciliation never calls a worker; it marks leased/dispatching `UNKNOWN`, queued `CANCELLED`, clears bridge arms, and interrupts the run.

- [ ] **Step 5: Implement tap/swipe mapping**

Record source frame/metrics/safe area. Map normalized path into the target safe area captured by the precondition barrier. Reject out-of-range values, incompatible orientation, epoch changes, or a non-foreground package. Generate one W3C pointer sequence for tap or swipe.

- [ ] **Step 6: Run tests and commit**

```powershell
git add packages/database/src/migrations/0006_runs_actions.sql packages/sessions/src/run-repository.ts packages/sessions/src/action-outbox* packages/sessions/src/action-dispatcher* packages/sessions/src/coordinate-mapper*
git commit -m "feat: persist crash-safe single-device actions"
git push
```

## Task 5: Add Single-Device Session APIs, Evidence Manifest, and Leader UI

**Files:**
- Create: `packages/evidence/package.json`
- Create: `packages/evidence/tsconfig.json`
- Create: `packages/evidence/src/evidence-manifest.ts`
- Create: `packages/evidence/src/evidence-manifest.test.ts`
- Create: `apps/server/src/routes/sessions.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/ws/state-gateway.ts`
- Modify: `apps/console/src/pages/SessionsPage.tsx`
- Create: `apps/console/src/features/sessions/LeaderViewport.tsx`
- Create: `apps/console/src/features/sessions/InputOverlay.tsx`
- Create: `apps/console/src/features/sessions/ActionTimeline.tsx`
- Create: `apps/console/src/features/sessions/SingleDeviceSession.test.tsx`

- [ ] **Step 1: Write failing session/API/UI tests**

Cover create/preflight/start/pause/finish, one leader only, wrong artifact identity, pointer-down/up same epoch, click versus drag threshold, browser request retry, double-click single-flight behavior, screenshot at start/finish/failure, optional leader video on/off, refresh, fallback banner, and no layout shift as frame/action status changes.

- [ ] **Step 2: Verify tests fail**

Expected: missing routes/components/evidence service.

- [ ] **Step 3: Implement session APIs and minimal evidence**

Add create/detail/preflight/start/action/pause/finish endpoints with CSRF and idempotency. Persist run/action JSONL derived from SQLite, start/finish/failure screenshots, bridge/Appium timing, serial-owned logcat segment hashes/time ranges, and a hashed indexed manifest using temp-write/atomic rename. Do not expose raw logcat as a report output or generate mandatory HTML/ZIP before M10.

- [ ] **Step 4: Implement viewport and overlay**

Decode H.264 through WebCodecs into a fixed-aspect canvas. Overlay captures mouse/pointer only inside current content bounds, stores frame/epoch at pointer-down, cancels on frame geometry change, and submits normalized tap/swipe. Video provider has no control channel. Right-click/text/lifecycle controls remain disabled until M9.

- [ ] **Step 5: Run tests and commit**

```powershell
git add packages/evidence apps/server/src/routes/sessions.ts apps/server/src/app.ts apps/server/src/ws/state-gateway.ts apps/console/src/pages/SessionsPage.tsx apps/console/src/features/sessions
git commit -m "feat: add leader single-device session"
git push
```

## Task 6: Prove Stream, Idempotency, Crash Reconciliation, and Real Input

**Files:**
- Create: `tests/integration/action-crash-recovery.test.ts`
- Create: `tests/e2e/single-device-session.spec.ts`
- Create: `tests/hardware/m6-single-device-run.ts`
- Create: `tests/hardware/m6-stream-metrics.ts`
- Create: `docs/milestones/M6-acceptance.md`

- [ ] **Step 1: Add forced-crash integration tests**

Use a child server and fake worker barriers to crash before lease, after lease/before response, and after device response/before persistence. Restart and assert explicit `CANCELLED`/`UNKNOWN`, no worker invocation, one result row, interrupted run, and a linked user retry as a new action.

- [ ] **Step 2: Add visual/session E2E coverage**

Test video loading/degraded/error/rotation, overlay geometry, action timeline, refresh, pause, finish, and stable desktop/mobile diagnostic widths. Capture screenshots and verify canvas pixels are nonblank.

- [ ] **Step 3: Run full automated verification**

Run Vitest, TypeScript, ESLint, console build, .NET tests, and Playwright. Expected: zero failures.

- [ ] **Step 4: Run real primary-provider and input gates**

On the explicit QA device require first frame <=5 s; >=20 FPS and host-receive-to-browser-render P95 <=250 ms for 10 minutes; queue depth <=2; one UI gesture -> one action -> one real target response; rotation cancels input and recovers mapped stream <=3 s. Run a complete single-device session with valid evidence manifest.

- [ ] **Step 5: Record, commit, push, and stop**

Document raw metric files/hashes, video provider version, action IDs, crash cases, evidence manifest, limitations, and rollback in `docs/milestones/M6-acceptance.md`. Commit/push and stop for explicit user acceptance. Do not connect a follower.
