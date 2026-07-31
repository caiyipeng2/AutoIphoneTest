# M5 Unity QA Bridge and UID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a QA-only Unity package and host adapter that safely report current UID/generation, geometry, view/focus/state, calibrated device timing, and one-time correlated action receipts while remaining absent from release builds.

**Architecture:** A UPM package compiled behind `UNITY_MULTI_DEVICE_QA` listens only on an Android device-loopback TCP port; the host reaches it through a serial-specific ADB forward. Versioned JSON-lines messages use a per-run nonce/HMAC and bridge-instance fencing. The package observes real Unity/EventSystem input and game-supplied state providers; it never calls gameplay actions. A minimal Unity project proves the contract independently of the production game.

**Tech Stack:** Unity 2022.3.62f2, C#, Unity Test Framework, Android `SystemClock`, device-loopback TCP through `adb forward`, TypeScript/Zod host client, SQLite, React, Vitest, and one real QA APK.

---

## Task 1: Define the Versioned Bridge Protocol and Host Parser

**Files:**
- Create: `packages/contracts/src/bridge.ts`
- Create: `packages/bridge/package.json`
- Create: `packages/bridge/tsconfig.json`
- Create: `packages/bridge/src/protocol.ts`
- Create: `packages/bridge/src/protocol.test.ts`
- Create: `tests/fixtures/bridge/valid.jsonl`
- Create: `tests/fixtures/bridge/invalid.jsonl`

- [ ] **Step 1: Write failing protocol tests**

Cover `QA_HELLO`, `QA_STATE`, `QA_ARMED`, `QA_ACK`, `QA_REJECTED`, `QA_PONG`, and `QA_ERROR`. Reject unknown schema versions, missing bridge instance, non-increasing state sequence within one instance, wrong run nonce hash, expired arm, mismatched descriptor/event-shape hash, and text state without `focusedControlId`.

```ts
expect(parseBridgeLine(JSON.stringify({
  type: "QA_ACK",
  schemaVersion: 1,
  bridgeInstanceId: "instance-a",
  actionId: "ACT-1",
  observedAtRealtimeNs: "9812345000000",
  descriptorHash: "sha256:expected",
  eventShapeHash: "sha256:different",
}))).toMatchObject({ ok: false, error: { code: "EVENT_SHAPE_MISMATCH" } });
```

- [ ] **Step 2: Run parser tests and verify failure**

Expected: missing contracts/parser.

- [ ] **Step 3: Implement exact schemas and canonical hashing**

Use a `type` discriminant and decimal strings for 64-bit device nanoseconds. Canonical descriptor input is `{ actionType, normalizedShape, expectedView, expectedFocus, metricsEpoch }` with sorted keys and SHA-256. Preserve invalid raw lines only in a redacted bounded diagnostic ring; never publish unrelated logcat.

- [ ] **Step 4: Run tests and commit**

```powershell
git add packages/contracts/src/bridge.ts packages/bridge tests/fixtures/bridge
git commit -m "feat: define Unity QA bridge protocol"
git push
```

## Task 2: Build the QA-Only UPM Runtime Package

**Files:**
- Create: `packages/unity-qa-bridge/com.caiyipeng.testcenter.qa/package.json`
- Create: `packages/unity-qa-bridge/com.caiyipeng.testcenter.qa/Runtime/TestCenter.QaBridge.asmdef`
- Create: `packages/unity-qa-bridge/com.caiyipeng.testcenter.qa/Runtime/QaBridgeBootstrap.cs`
- Create: `packages/unity-qa-bridge/com.caiyipeng.testcenter.qa/Runtime/QaBridgeServer.cs`
- Create: `packages/unity-qa-bridge/com.caiyipeng.testcenter.qa/Runtime/QaProtocol.cs`
- Create: `packages/unity-qa-bridge/com.caiyipeng.testcenter.qa/Runtime/QaStatePublisher.cs`
- Create: `packages/unity-qa-bridge/com.caiyipeng.testcenter.qa/Runtime/IQaIdentityProvider.cs`
- Create: `packages/unity-qa-bridge/com.caiyipeng.testcenter.qa/Runtime/IQaViewStateProvider.cs`
- Create: `packages/unity-qa-bridge/com.caiyipeng.testcenter.qa/Runtime/QaInputObserver.cs`
- Create: `packages/unity-qa-bridge/com.caiyipeng.testcenter.qa/Tests/Runtime/TestCenter.QaBridge.Tests.asmdef`
- Create: `packages/unity-qa-bridge/com.caiyipeng.testcenter.qa/Tests/Runtime/QaProtocolTests.cs`
- Create: `packages/unity-qa-bridge/verification-project/Packages/manifest.json`
- Create: `packages/unity-qa-bridge/verification-project/ProjectSettings/ProjectVersion.txt`
- Create: `scripts/run-unity-bridge-tests.ps1`

- [ ] **Step 1: Create the minimal Unity harness and failing protocol/state tests**

Create the minimal Unity 2022.3.62f2 verification project, local package reference, and batch test script before invoking Unity. Tests prove deterministic JSON/canonical hashes, one bridge instance per process, monotonic state sequence, metrics epoch increments only on geometry/orientation changes, arm expiry, exact-once consume, unrelated event rejection, and state-provider failure isolation.

- [ ] **Step 2: Run Unity batch tests and verify compile failure**

Run `scripts/run-unity-bridge-tests.ps1` against the new harness. Expected: FAIL because the package runtime implementation is missing, not because the project or runner cannot be found.

- [ ] **Step 3: Implement compile-time exclusion and loopback server**

Wrap runtime implementation in `#if UNITY_MULTI_DEVICE_QA`; outside that symbol expose no bootstrap type or listener. In QA builds create a hidden `DontDestroyOnLoad` object, bind `TcpListener` to `IPAddress.Loopback` on the configured device port, accept one authenticated host, cap lines at 16 KiB, and marshal Unity API reads to the main thread. Generate `bridgeInstanceId` at startup.

- [ ] **Step 4: Implement provider-based state**

`IQaIdentityProvider` returns UID, install generation, app-data generation, and build ID. `IQaViewStateProvider` returns view ID, focused-control ID, and additional allowlisted scalar state. Core state always includes `Screen.width`, `Screen.height`, `Screen.safeArea`, and orientation. Provider exceptions emit categorized `QA_ERROR` without crashing gameplay.

- [ ] **Step 5: Implement observation-only input correlation**

`QaInputObserver` accepts observed pointer/key/text event descriptors from attached EventSystem observer components or explicit game instrumentation. It compares type/shape/view/focus/metrics/TTL/HMAC with the single active arm, emits one `QA_ACK`, and clears the arm. It exposes no method that invokes a Button, changes model state, or synthesizes input.

- [ ] **Step 6: Commit the runtime package**

```powershell
git add packages/unity-qa-bridge/com.caiyipeng.testcenter.qa packages/unity-qa-bridge/verification-project/Packages/manifest.json packages/unity-qa-bridge/verification-project/ProjectSettings/ProjectVersion.txt scripts/run-unity-bridge-tests.ps1
git commit -m "feat: add QA-only Unity bridge runtime"
git push
```

## Task 3: Add the Minimal Unity Verification Project and Release-Negative Build

**Files:**
- Modify: `packages/unity-qa-bridge/verification-project/Packages/manifest.json`
- Modify: `packages/unity-qa-bridge/verification-project/ProjectSettings/ProjectVersion.txt`
- Create: `packages/unity-qa-bridge/verification-project/Assets/Editor/QaFixtureBuilder.cs`
- Create: `packages/unity-qa-bridge/verification-project/Assets/Scripts/FixtureStateProvider.cs`
- Create: `packages/unity-qa-bridge/verification-project/Assets/Scripts/FixtureTarget.cs`
- Modify: `scripts/run-unity-bridge-tests.ps1`
- Create: `scripts/build-unity-bridge-fixture.ps1`
- Create: `tests/integration/release-bridge-negative.test.ts`

- [ ] **Step 1: Add a deterministic fixture scene builder**

The Editor script creates a portrait Canvas containing UID/state labels, known 100 px tap targets, a vertical swipe lane, a Unity input field with stable `focusedControlId`, a Back counter, and visible metrics epoch. It attaches observation components but never calls targets from the bridge transport.

- [ ] **Step 2: Add separate QA and release build entrypoints**

QA build defines `UNITY_MULTI_DEVICE_QA` and writes `data/fixtures/qa-bridge-fixture.apk`; release build omits it and writes `release-no-bridge.apk`. Both use a disposable package ID and explicit Unity/SDK/JDK paths. Scripts reject an already-running build for the same project and capture logs.

- [ ] **Step 3: Implement release-negative inspection**

Unpack/inspect the release APK and assert no bridge assembly type strings, QA port configuration, exported receiver/service, `QA_STATE`, `QA_ARMED`, or `QA_ACK` strings. Install the release fixture and assert no listening QA socket/forward response and no `QA_*` logcat during launch.

- [ ] **Step 4: Run EditMode/PlayMode tests and both builds**

Expected: Unity tests pass, QA APK contains the bridge, release APK passes all negative checks.

- [ ] **Step 5: Commit fixture and tests**

```powershell
git add packages/unity-qa-bridge/verification-project scripts/run-unity-bridge-tests.ps1 scripts/build-unity-bridge-fixture.ps1 tests/integration/release-bridge-negative.test.ts
git commit -m "test: add Unity bridge verification fixture"
git push
```

## Task 4: Implement Serial-Specific Forwarding, Handshake, and Clock Calibration

**Files:**
- Modify: `packages/adb/src/commands.ts`
- Modify: `packages/adb/src/commands.test.ts`
- Create: `packages/bridge/src/bridge-client.ts`
- Create: `packages/bridge/src/bridge-client.test.ts`
- Create: `packages/bridge/src/clock-calibrator.ts`
- Create: `packages/bridge/src/clock-calibrator.test.ts`
- Create: `packages/bridge/src/arm-controller.ts`
- Create: `packages/bridge/src/arm-controller.test.ts`

- [ ] **Step 1: Write failing forwarding/calibration/arm tests**

Assert unique host forward per serial, cleanup only of owned forward, HELLO/state before ready, 9 ping samples selecting the minimum-RTT offset, uncertainty `(hostReceive-hostSend)/2`, recalibration on bridge instance/boot change, and arm rejection for nonce/instance/TTL/descriptor/focus/metrics mismatch.

- [ ] **Step 2: Verify tests fail**

Expected: missing bridge client/controllers.

- [ ] **Step 3: Add typed ADB forward commands**

Add `forwardAdd`, `forwardList`, and `forwardRemove` variants. Host ports come from the worker port allocator; device endpoint is fixed QA loopback port. Every ownership record includes serial, host port, device port, and worker generation.

- [ ] **Step 4: Implement authenticated client and calibration**

After forward creation, connect to host loopback, exchange a random run nonce over the ADB-only channel, require HMAC on subsequent messages, and read bounded JSON lines. For each ping record host monotonic send/receive and device elapsed realtime; choose lowest RTT, persist offset/uncertainty, and label receipt skew unavailable above the configured uncertainty bound.

- [ ] **Step 5: Implement explicit arm handshake**

Send the complete precondition descriptor, wait for matching `QA_ARMED`, then return an arm lease consumed only by the session worker. Cancellation/timeout sends disarm and closes the lease; restart/instance change invalidates all leases.

- [ ] **Step 6: Run tests and commit**

```powershell
git add packages/adb packages/bridge/src
git commit -m "feat: add authenticated Unity bridge client"
git push
```

## Task 5: Persist Current-Generation UID and Show Bridge Health

**Files:**
- Modify: `packages/devices/src/installation-repository.ts`
- Create: `packages/devices/src/uid-service.ts`
- Create: `packages/devices/src/uid-service.test.ts`
- Create: `apps/server/src/routes/device-bridge.ts`
- Modify: `apps/server/src/routes/devices.ts`
- Create: `apps/console/src/features/devices/BridgeStatus.tsx`
- Create: `apps/console/src/features/devices/UidEditorDialog.tsx`
- Modify: `apps/console/src/features/devices/DeviceDetails.tsx`
- Create: `tests/e2e/device-bridge.spec.ts`
- Create: `tests/hardware/m5-unity-bridge.ts`
- Create: `docs/milestones/M5-acceptance.md`

- [ ] **Step 1: Write failing UID generation tests**

Prove automatic UID binds to serial/package/install generation/app-data generation/build identity; older observations remain history but are not current; clear-data invalidation removes readiness; manual UID requires current generation and records source/actor/time; rejoin/start checks reject stale UID.

- [ ] **Step 2: Implement UID service and bridge APIs**

Consume `QA_STATE` only from the current fenced bridge client. Add read-only bridge health to device APIs and a CSRF-protected manual correction route requiring a server confirmation nonce. Publish UID/bridge changes over state events.

- [ ] **Step 3: Implement device-detail UI**

Show Ready/Degraded/Unavailable, schema/instance/build, last state, calibrated uncertainty, UID with source/generation, safe area/orientation/metrics epoch/view/focus. Manual fallback is explicit and warns when a destructive deployment will invalidate it.

- [ ] **Step 4: Run automated and real QA acceptance**

Run all tests plus the QA fixture on the explicit real serial. Capture real `QA_HELLO`, `QA_STATE`, nine calibration samples, correct UID/generation, valid arm/ACK, each rejection case, disconnect/reconnect, and the release-negative APK. Do not use stale Unity Editor logs as evidence.

- [ ] **Step 5: Add production-game integration guidance**

Document a UPM local/Git dependency and provider adapter example. Reference the existing `AndroidAutoTestBridge` pattern only as prior art for compact `QA_STATE` logging; require live CodeGraph/source inspection at M5 execution before touching the game repository, and keep any game-repo integration as a separately reviewed change.

- [ ] **Step 6: Record, commit, push, and stop**

Commit/push tests and `docs/milestones/M5-acceptance.md`, verify a clean branch, and stop. Do not start Appium input or leader video until user acceptance.
