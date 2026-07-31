# Unity Multi-Device Test Center Design

- Date: 2026-07-31
- Status: Written design approved; implementation-safety amendments included for plan review
- Project root: `E:\Projects\UnityMultiDeviceTestCenter`
- Git remote: `https://github.com/caiyipeng2/AutoIphoneTest.git`
- Target platform: Windows host with 1-4 locally connected Android devices

## 1. Summary

Build a local Windows tool for Unity Android package testing. A tester operates one selected leader device through a live computer view. The platform records each action and, when followers are selected, dispatches the action concurrently to up to three follower devices. It then correlates per-device results, Unity QA state, screenshots, logs, videos, and reports.

The product borrows the useful information architecture of Appium Device Farm, including Devices, Apps, Builds/Deployments, Sessions, and Results. It does not fork Appium Device Farm for the first version. The live synchronization controller, Unity bridge, and evidence model are independent so upstream Device Farm changes do not control the core product.

## 2. Confirmed Decisions

| Area | Decision |
|---|---|
| Operating mode | Operate the leader from its live computer view. Physical finger capture on the leader is a later feature. |
| Capacity | A run selects 1-4 connected devices. Exactly one is the leader; the remaining 0-3 are followers. |
| Single-device behavior | A one-device run records actions and evidence without broadcasting. |
| Packages | Accept APK, AAB, and a version already installed on selected devices. |
| Accounts | The game creates an independent account from device ID. The platform does not allocate or log in accounts. |
| UID | A QA-only Unity bridge reports the UID, which is stored against device serial and app version. Manual correction is a fallback. |
| First-version actions | Tap, long press, drag/swipe, Back, text input, activate, terminate, and restart. |
| Later actions | Multi-touch, pinch/zoom, responsive cross-orientation mapping, and physical-leader touch capture. |
| Failure policy | Each run selects either pause-all or quarantine-failed-device. Pause-all is the default. |
| Reports | Always create platform history, offline HTML, and an evidence ZIP. Let the user optionally export Excel, PDF, or JUnit. |
| Unity builds | The first version imports existing outputs. It defines a `BuildProvider` contract so a Unity command-build provider can be added later. |
| Storage | Source, dependencies, application data, artifacts, and evidence remain on `E:`. |
| Access | Localhost only in the first version. No public or multi-tenant control plane. |

## 3. Goals

1. Reduce repeated manual testing by applying one human-driven workflow to 1-4 Android devices.
2. Preserve device isolation: every ADB command, Appium session, port, log stream, and evidence path belongs to one serial.
3. Work with Unity-rendered UI where Android accessibility trees may not expose meaningful elements.
4. Make every action and outcome traceable by `runId`, `actionId`, device serial, UID, and artifact version.
5. Provide Device Farm-style visual management for devices, apps, deployments, sessions, and results.
6. Deliver in atomic M0-M11 milestones, each requiring explicit user acceptance before the next begins.
7. Keep extension contracts for Unity builds and future Device Farm nodes without putting either in the first-version critical path.

## 4. Non-Goals

The first version does not include:

- Capturing physical finger input from a stock leader handset.
- Multi-touch, pinch, or arbitrary raw-event replay.
- Reliable mapping between layouts that reflow differently across portrait and landscape.
- More than four selected devices in one local run.
- Multiple Windows hosts, Device Farm hub/node allocation, remote device queues, or team tenancy.
- Public network access.
- A Unity build implementation. Only its provider interface is included.
- Unity bridge calls into gameplay methods. The bridge observes state and correlates input; it does not bypass real UI interaction.

## 5. Local Environment Baseline

The design was based on a read-only inspection on 2026-07-31:

- Unity `2022.3.62f2` is installed at `D:\Unity\Editor` with Android SDK, NDK, OpenJDK, and Gradle.
- ADB `35.0.0` is available. One Samsung Galaxy S24 Ultra (`SM-S9280`) was connected during discovery.
- The Android SDK environment points to Unity's Android SDK.
- The machine has multiple Java installations. Child processes must receive explicit tool paths and environment values instead of relying on bare `java`.
- Global Node is `26.4.0`, but Appium and project dependencies are not installed.
- Python `D:\python3\python.exe` has an Appium Python client, but the platform will not depend on Python for its core runtime.
- `E:` had about 606 GiB free. The platform still enforces evidence-space thresholds.

This baseline is evidence, not a permanent assumption. M0 reruns all checks and records the current values.

## 6. Final Product Form

The completed product is a portable Windows directory, not a collection of scripts:

1. A thin Windows launcher starts and stops child services, runs environment checks, opens the local console, and displays process health.
2. A local React management console provides all operational pages.
3. A Node.js 22 LTS and TypeScript service owns device discovery, deployment, sessions, actions, evidence, and reports.
4. Appium 3 and UiAutomator2 provide one isolated automation session per selected device.
5. A QA-only Unity bridge reports UID, safe area, orientation, view/state, and action receipts.
6. A SQLite database stores queryable metadata. Large artifacts and evidence stay in the `data` directory on `E:`.
7. Offline HTML and ZIP are automatic. Excel, PDF, and JUnit are selectable export jobs.

The launcher must use pinned project-local tools where practical. It must not depend on the globally installed Node 26, bare Java 21, or implicit PATH ordering.

## 7. System Architecture

```mermaid
flowchart TB
    Launcher[Windows Launcher] --> Web[React Local Console]
    Launcher --> Core[TypeScript API and Orchestrator]
    Web <-->|HTTP and WebSocket| Core

    Core --> Registry[Device Registry and Health]
    Core --> Artifacts[Apps and Deployment Service]
    Core --> Session[Session and Action Orchestrator]
    Core --> Evidence[Evidence and Report Service]
    Core --> DB[(SQLite)]
    Evidence --> Disk[(E Drive Artifacts and Runs)]

    Session --> W1[Device Worker 1]
    Session --> W2[Device Worker 2]
    Session --> W3[Device Worker 3]
    Session --> W4[Device Worker 4]

    W1 --> D1[Android Leader]
    W2 --> D2[Android Follower]
    W3 --> D3[Android Follower]
    W4 --> D4[Android Follower]

    D1 --> B1[Unity QA Bridge]
    D2 --> B2[Unity QA Bridge]
    D3 --> B3[Unity QA Bridge]
    D4 --> B4[Unity QA Bridge]

    Core -. future adapter .-> Farm[Appium Device Farm Nodes]
    Artifacts -. future provider .-> UnityBuild[Unity Command Build]
```

### 7.1 Windows Launcher

Responsibilities:

- Start only the pinned local runtime and child services.
- Pass explicit `ANDROID_HOME`, `JAVA_HOME`, tool paths, storage paths, and port ranges to child processes.
- Run M0 self-checks without modifying global environment variables.
- Open the local console at `127.0.0.1`.
- Shut down child processes cleanly and surface crash logs.

The implementation plan will choose a thin Windows executable technology. Its behavior is fixed by this contract regardless of packaging technology.

### 7.2 React Local Console

Responsibilities:

- Render the operational pages described in section 8.
- Receive live device, run, action, and export updates over WebSocket.
- Capture leader pointer and keyboard intent through an overlay over the leader view.
- Never own authoritative run state. Browser refresh reconstructs state from the API and database.
- Require explicit confirmation for data clearing, uninstall, and other destructive operations.

### 7.3 TypeScript Core

The core contains bounded modules:

- `device-registry`: ADB discovery, health, metadata, UID association, tags, and occupancy.
- `artifact-service`: APK/AAB/installed-version records and immutable artifact metadata.
- `deployment-service`: AAB conversion, install, clear-data option, launch, and version verification.
- `session-orchestrator`: run state, selected leader/followers, action creation, concurrent dispatch, and failure policy.
- `action-outbox`: transactional action sequencing, target snapshots, initial per-target results, dispatch leases, and crash reconciliation.
- `worker-manager`: isolated Appium, ADB, logcat, bridge, and view resources per serial.
- `evidence-service`: screenshots, videos, logs, state snapshots, hashes, and evidence indexing.
- `report-service`: offline HTML/ZIP and optional Excel/PDF/JUnit export jobs.
- `settings-service`: explicit project-local paths, ports, evidence policy, and retention settings.

### 7.4 Device Worker

Each selected serial gets one worker with:

- One Appium session with explicit `udid`.
- A unique UiAutomator2 `systemPort`.
- Unique MJPEG/Chromedriver ports when those facilities are enabled.
- Every ADB command invoked with `-s <serial>`.
- One logcat stream and one evidence directory.
- One Unity bridge correlation state.
- One view-provider instance or preview subscription.
- A monotonically increasing worker generation that fences responses from replaced sessions.

No device-global singleton may hold serial-specific state.

### 7.5 ViewProvider

The browser must show the leader inside the management console. Streaming is isolated behind:

```ts
interface EncodedFrame {
  frameId: string;
  deviceSerial: string;
  capturedAtDeviceNs?: bigint;
  receivedAtHostNs: bigint;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  codec: "h264" | "h265" | "av1" | "jpeg";
  metricsEpoch: number;
  bytes: Uint8Array;
}

interface ViewProvider {
  start(deviceSerial: string, profile: ViewProfile): AsyncIterable<EncodedFrame>;
  setProfile(profile: ViewProfile): Promise<void>;
  stop(): Promise<void>;
}
```

First-version behavior:

- The primary provider uses a pinned scrcpy-compatible video adapter in view-only mode. Input control is disabled so clicks are never injected twice.
- The adapter boundary owns all scrcpy protocol/version details. Session and action modules depend only on `ViewProvider`.
- An Appium MJPEG or periodic-screenshot provider is the lower-frame-rate fallback.
- The leader uses an interactive high-frame-rate profile.
- Followers use low-frame-rate previews by default. Expanding one follower can temporarily raise its profile.
- Providers expose a latest-frame stream with a bounded queue of at most two frames. Slow consumers drop superseded frames instead of increasing control latency or memory indefinitely.
- Every frame carries its display geometry and `metricsEpoch`. The input overlay can dispatch only against the epoch represented by the rendered frame.

The M6 milestone includes a focused streaming spike and numeric acceptance. If the primary provider fails its latency/stability gate, the fallback remains functional in an explicitly degraded mode and the report states the measured limitation; degraded fallback is not evidence that the primary gate passed.

### 7.6 Appium Device Farm Boundary

Appium Device Farm is not a first-version runtime dependency. Its page concepts and operational metadata inform this design. A future adapter may supply remote inventory, tags, queues, and node allocation. The synchronization orchestrator will still create and own one action result per assigned device.

## 8. Pages and Module Boundaries

### 8.1 Overview

Shows host health, online-device count, selected/current artifact, active run, recent failures, storage pressure, and navigation shortcuts.

It is read-only. It never silently installs, starts, or broadcasts.

### 8.2 Devices

Shows:

- Serial, model, product, Android version, API/ABI, resolution, orientation, safe area, battery, connection state, and tags.
- Bridge availability and last state time.
- UID and the app version under which it was observed.
- Occupying deployment or run.

It owns registration, grouping, health diagnostics, and UID correction. It does not own Appium sessions or package installation.

### 8.3 Apps

Stores immutable records for:

- APK files.
- AAB files.
- A device's currently installed package/version when no file is imported.

Metadata includes package name, version name/code, channel/environment tags, file size, SHA-256, signing summary, import time, source, and notes. Original imported files are never modified in place.

### 8.4 Builds / Deployments

In the first version, this page means deployment jobs, not compilation of Unity source. It supports:

- AAB conversion through bundletool.
- Target selection from currently connected devices.
- Install or overwrite-install.
- Optional clear data with explicit confirmation.
- Launch and foreground/package/version verification.
- Step-level status, retry, cancellation, and per-device logs.

A future Unity build provider appears in the same page without changing artifact or deployment models.

### 8.5 Synchronized Sessions

The page has two views:

1. Create run: choose 1-4 devices, leader, artifact/deployed version, pause policy, evidence options, and preflight.
2. Live run: leader stream, follower previews, action timeline, per-device results, latency, pause/resume, retry, skip, quarantine, rejoin, checkpoint, screenshot, and finish.

One selected device creates a single-device evidence run. Two to four selected devices create one leader and one to three followers.

Run membership is fixed to the serials selected at creation. A newly connected device never joins an active run automatically. Quarantine and rejoin apply only to an original member. Rejoin requires a complete preflight, increments the membership epoch and worker generation, and fences late results from the old worker. Loss of the leader always pauses the run; the sole device or current leader cannot be silently quarantined. While paused, the user may finish the run or promote another original, fully preflighted member to leader, which creates a new membership epoch.

### 8.6 Results

Shows immutable historical records by run and action. It links artifact, device, UID, action, per-device timing/result, screenshots, videos, log excerpts, bridge state, failures, recovery decisions, and exports.

Opening history never re-executes a command.

### 8.7 Settings

Configures project-local tool paths, E-drive storage, port ranges, default pause/evidence policies, retention, and diagnostic export.

It never modifies machine-wide environment variables automatically and never exposes an arbitrary shell command field.

## 9. Standard User Flow

1. Double-click the launcher. M0 checks run and the management console opens.
2. Connect between one and four Android devices. Verify authorization, metadata, bridge status, and UID on Devices.
3. Select an existing artifact, import an APK/AAB, or choose an installed version on Apps.
4. Create a deployment when installation is required. Select devices, install/overwrite, optionally clear data, launch, and verify.
5. Create a synchronized session. Select 1-4 devices and exactly one leader. Select pause policy and evidence options.
6. Preflight establishes workers and validates serial isolation, Appium sessions, package/version, foreground app, orientation, view provider, bridge, UID, and safe area.
7. Operate the leader in the computer view. Each captured input becomes an immutable, sequential action against the rendered frame and current membership epoch before dispatch.
8. Observe per-device results. On failure, follow the selected pause/quarantine policy and explicitly retry, skip, remove, or rejoin.
9. Finish the run. The platform closes resources and generates history, offline HTML, and an evidence ZIP.
10. Request Excel, PDF, or JUnit only when needed.

## 10. Package and Deployment Flows

### 10.1 APK

1. Copy the original APK into content-addressed artifact storage.
2. Compute SHA-256 and parse package/version/signing metadata.
3. Create a deployment job for selected serials.
4. Install per serial and retain stdout/stderr.
5. Resolve and launch the installed activity.
6. Verify installed package/version and foreground package.

### 10.2 AAB

1. Preserve the original AAB as an immutable artifact.
2. Parse bundle metadata and validate the selected QA signing profile before conversion.
3. Use explicit project-local Java and bundletool.
4. Build either one explicitly selected universal archive or one signed `.apks` install set per device specification. The default is per-device generation.
5. Key every generated install set by original bundle SHA-256, signing-certificate SHA-256, bundletool version, generation mode, and device-specification SHA-256. Never reuse a device-specific set for a different specification.
6. Install required splits to each selected serial.
7. Preserve conversion and install logs and generated-artifact hashes without copying private keys or passwords into artifact/evidence storage.
8. Verify package/version, signing identity, installed APK-set identity, and foreground activity on every target.

Signing-profile rules:

- The user supplies or selects a QA keystore through a local settings flow. Passwords are held only for the operation or in an OS-backed credential store; they never enter SQLite, action records, reports, or logs.
- The platform stores only a signing-profile identifier and public certificate digest.
- If the installed package has a different signer, overwrite-install is blocked. Uninstall/reinstall remains a separate destructive deployment choice with explicit confirmation and a warning that the device-derived game account/data may change.

### 10.3 Installed Version

1. Query the selected device for package/version/activity, signing-certificate digest, and installed base/split APK-set digest or QA build identifier.
2. Create an installed-version artifact reference without pretending a source APK/AAB exists.
3. If multiple selected devices do not have the same package, version, signer, and installed binary identity, preflight blocks the group until the user resolves or explicitly changes selection. Reused version codes are never treated as proof that binaries match.

## 11. Action Model and Dispatch

An action is persisted before execution:

```json
{
  "schemaVersion": 1,
  "runId": "RUN-20260731-014",
  "actionId": "ACT-000187",
  "clientRequestId": "019fb73c-0b3d-78ca-bff3-1057c76f54e1",
  "actionSeq": 187,
  "parentActionId": null,
  "type": "swipe",
  "sourceSerial": "leader-serial",
  "targetSerials": ["leader-serial", "follower-1"],
  "membershipEpoch": 3,
  "sourceMetricsEpoch": 12,
  "sourceFrameId": "FRAME-008812",
  "hostMonotonicTimeNs": 120045600000,
  "payload": {
    "normalizedPath": [[0.51, 0.78], [0.51, 0.32]],
    "durationMs": 420
  }
}
```

Rules:

1. `actionId` is unique within a run and never reused.
2. `clientRequestId` is an idempotency key. Repeating the same browser request returns the existing action; reusing it with a different payload is rejected.
3. `actionSeq` is strictly increasing. A run allows at most one group action in flight so rapid gestures, bridge arms, and retries cannot interleave.
4. The API persists the action, immutable membership target snapshot, one `PENDING` `DeviceActionResult` per target, and an outbox row in one SQLite transaction before dispatch.
5. Dispatch to the target snapshot is concurrent across workers, not sequential by device. Each worker response must match the recorded membership epoch and worker generation.
6. Dispatch leasing is crash-aware. After restart, a leased or possibly sent result becomes `UNKNOWN`; a definitely undispatched result becomes `CANCELLED`. Neither category is replayed automatically.
7. Every selected serial therefore retains one result row even when dispatch fails before Appium, the service crashes, or a worker response is fenced as stale.
8. A retry creates a new action with a new `clientRequestId` and `actionId`, with `parentActionId` pointing to the original.
9. Original actions, target snapshots, and results are immutable audit records. State transitions append timestamps and reasons rather than replacing identity fields.
10. Text payloads are masked by default in logs/reports. A run may explicitly allow clear test text.
11. Clear-data, uninstall, and arbitrary shell operations are not valid synchronized action types.

## 12. Coordinate Mapping

1. The React overlay captures pointer coordinates within the displayed game-content rectangle, excluding browser chrome, letterboxing, and controls, and records the rendered `sourceFrameId` and `sourceMetricsEpoch` at pointer-down.
2. The host converts the path to `0..1` coordinates relative to the leader's Unity safe area for that exact metrics epoch.
3. Pointer-up, action commit, and dispatch must still refer to the same source metrics epoch. A rotation, resize, safe-area change, or stream restart cancels the gesture before any device receives it.
4. Each worker combines normalized coordinates with the display, orientation, and Unity safe area snapshot captured during the action precondition barrier. A target metrics change before injection rejects that target rather than using newer geometry silently.
5. Unity safe-area Y coordinates are converted carefully because Unity and Android/window coordinate origins differ.
6. Preflight rejects incompatible orientation.
7. If a layout reflows rather than scales, geometric mapping is not considered reliable. The device is paused/quarantined unless a future semantic-anchor provider supports that view.

First-version validation uses a dedicated Unity QA target scene with known hit regions and swipe endpoints across representative resolutions.

## 13. Unity QA Bridge

The bridge is compiled only into QA builds and has a versioned schema.

It emits compact logcat records such as:

```text
QA_HELLO {"schemaVersion":1,"bridgeInstanceId":"boot-3e19","bootId":"android-boot-id","buildId":"qa-20260731.4"}
QA_STATE {"schemaVersion":1,"bridgeInstanceId":"boot-3e19","uid":"12345","appDataGeneration":7,"orientation":"Portrait","safeArea":[0,80,1080,2260],"metricsEpoch":12,"view":"MainHUD","focusedControlId":"chat_input","stateSeq":42}
QA_ARMED {"schemaVersion":1,"bridgeInstanceId":"boot-3e19","actionId":"ACT-000187","descriptorHash":"sha256:...","expiresAtRealtimeMs":9812845}
QA_ACK {"schemaVersion":1,"bridgeInstanceId":"boot-3e19","actionId":"ACT-000187","observedAtRealtimeMs":9812345,"eventShapeHash":"sha256:...","view":"MainHUD","stateSeq":43}
```

To correlate a real OS-injected input with `actionId`, preflight establishes a per-run random nonce through an ADB-only channel and records the current `bridgeInstanceId`, boot ID, metrics epoch, and clock-calibration sample. The worker sends a narrowly typed arm request containing the run nonce hash, `actionId`, action type, descriptor hash, expected view/focus, metrics epoch, and a short expiry. It waits for a matching `QA_ARMED` before Appium injection. The bridge acknowledges only an observed event whose type/shape, instance, epoch, focus precondition, and TTL match the arm, then consumes that arm exactly once.

An unrelated touch, expired arm, bridge restart, metrics change, focus change, or descriptor mismatch produces an explicit rejection/timeout and cannot be mistaken for the synchronized action. Because a run permits only one group action in flight, two arms cannot compete for the same observed input.

The announcement channel cannot invoke gameplay methods or pass arbitrary commands. It exists only to correlate the next observed input. The receiver is absent or disabled in release builds.

Bridge responsibilities:

- Report UID.
- Report app-data/install generation and QA build ID with UID.
- Report screen dimensions, safe area, orientation, and a monotonically increasing metrics epoch.
- Report a stable current view/state identifier, focused Unity control identity when text input is possible, and monotonic `stateSeq` scoped to the bridge instance.
- Complete the arm handshake and acknowledge only a matching observed input.
- Report bridge/schema/instance/boot versions.

ACK applicability is action-specific:

| Action | Bridge contract | Authoritative completion |
|---|---|---|
| Tap, long press, drag/swipe, Back | `QA_ARMED` then matching `QA_ACK` | Appium completion plus bridge ACK when bridge-ready |
| Text | Stable matching `focusedControlId`, `QA_ARMED`, then matching `QA_ACK` | Appium completion plus bridge ACK; synchronized text is blocked without a trusted focus provider |
| Activate | No input arm | Appium activation plus fresh `QA_HELLO`/`QA_STATE` when bridge-ready |
| Terminate | No input arm because the bridge is intentionally absent | Appium/process-not-running postcondition |
| Restart | Terminate postcondition followed by activate contract | Fresh bridge instance and state after launch |

For timing, each worker calibrates the device monotonic clock against the host monotonic clock with repeated bounded round trips at preflight and periodically during a run. `QA_ACK.observedAtRealtimeMs` is converted to a host-time estimate with a recorded uncertainty bound. Cross-device Unity receipt skew is valid only when every included calibration uncertainty is within the configured bound; otherwise the UI/report labels the metric unavailable and separately reports host-observed log-arrival skew, which includes ADB/logcat latency.

Without a bridge, the worker can still use Appium completion, foreground-package checks, screenshots, and logcat. The UI marks the run as degraded and does not claim Unity receipt latency or UID automation. Synchronized text remains disabled unless another trusted focus provider proves the same focused control on every target.

## 14. Core Data Model

| Entity | Important fields |
|---|---|
| `Device` | serial, model, product, Android/API/ABI, display, orientation, safe area, tags, health, lastSeen |
| `DeviceAppInstallation` | serial, package, installGeneration, appDataGeneration, version, signer SHA-256, installed-set SHA-256/buildId, observedAt |
| `DeviceUid` | installation generation, app-data generation, uid, source, observedAt, invalidatedAt/reason |
| `AppArtifact` | kind, package, versionName/code, channel, sourcePath, storedPath, SHA-256, signing summary |
| `GeneratedInstallSet` | artifact, bundletool version, signer SHA-256, mode, device-spec SHA-256, path, SHA-256 |
| `Deployment` | artifact, target serials, clearData, state, created/started/finished |
| `DeploymentDeviceResult` | deployment, serial, step, state, exit/error category, log paths |
| `TestRun` | leader, artifact/version identity, failure policy, evidence policy, membership epoch, state, timestamps |
| `RunDevice` | run, serial, role, state, membership epoch, worker generation, joined/left/rejoined times and reason |
| `Action` | run, actionId, clientRequestId, actionSeq, parentActionId, membership/metrics/frame snapshot, type, normalized payload, host time |
| `ActionOutbox` | action, lease owner/generation, state, queued/leased/reconciled times |
| `DeviceActionResult` | action, serial, membership/worker generation, mapped payload, dispatch/complete/ack times, uncertainty, state, error category |
| `Evidence` | run, action/result association, serial, type, state, temporary/final path, SHA-256, timestamp, capture error |
| `ReportExport` | run, format, attempt, state, temporary/final path, hash, error |
| `Setting` | validated project-local path, port range, retention, thresholds, defaults |

SQLite stores metadata and paths. Imported packages, generated split archives, videos, screenshots, logs, reports, and ZIPs stay as files on `E:`.

Clear-data, uninstall, reinstall, or a detected data-directory reset increments the appropriate installation/data generation and invalidates prior UID observations immediately. A run may begin only with a UID observed or manually confirmed for the current generation. Rejoin performs the same check; a UID from an earlier generation is never reused silently.

## 15. Run State Machine

Allowed states:

- `DRAFT`: device/artifact/policy selection.
- `PREFLIGHT`: workers and checks are being established.
- `RUNNING`: new synchronized actions are accepted.
- `PAUSED`: manual or policy-triggered pause; no new actions accepted.
- `RECOVERING`: selected worker resources are reconnecting/revalidating.
- `FINALIZING`: workers are closed and mandatory HTML/ZIP outputs are being published.
- `COMPLETED`: normal finish and all mandatory default outputs are ready.
- `FINALIZATION_FAILED`: actions/evidence are preserved but one or more mandatory default outputs failed; report generation may be retried without device actions.
- `ABORTED`: the user ended a draft/preflight run before actions were accepted.
- `INTERRUPTED`: host or service ended unexpectedly; partial evidence is reconciled and default partial-report generation is attempted.

The browser cannot assign state directly. API commands perform validated transitions and persist them transactionally.

On next launch, stale `PREFLIGHT`, `RUNNING`, `PAUSED`, `RECOVERING`, or `FINALIZING` runs become `INTERRUPTED`. Stale dispatch leases are reconciled to `UNKNOWN`/`CANCELLED`, pending evidence files are reconciled, and a partial report attempt is recorded. It never resumes an old worker, bridge arm, or action queue automatically. `DRAFT` remains editable because it owns no live device resources.

SQLite is authoritative for finalization. Evidence/report rows begin as `PENDING`; bytes are written to a sibling temporary file, closed, hashed, atomically renamed, then marked `READY` in a transaction. Startup marks orphaned pending rows `FAILED` or `MISSING` with an explicit reason. A run becomes `COMPLETED` only after mandatory HTML and evidence ZIP rows are `READY`.

## 16. Failure and Recovery Rules

| Failure | Detection | Default response | Recovery |
|---|---|---|---|
| USB/ADB disconnect | serial disappears, offline transport, failed heartbeat | Leader/sole member always pauses; follower applies run policy | Reconnect and fully preflight before fenced rejoin |
| Appium session loss | command/session/systemPort failure | Stop dispatch to that worker | Rebuild only that worker; do not replay automatically |
| Crash/ANR/wrong foreground | process/foreground change and crash/ANR logs | Capture evidence and apply policy | User may restart, then bridge/UID/state revalidation |
| Bridge timeout/state mismatch | missing arm/ACK or incompatible instance/UID/generation/orientation/view/focus/state | Stop blind broadcast | Query again, skip, quarantine, or require manual confirmation |
| Text focus mismatch | pre-input state barrier fails | Send text to no devices | Align focus and create a new action |
| Low disk | free-space and write-rate monitor | Warn, then block video/new runs at danger threshold | Free space or reduce evidence policy |

Critical rule: a disconnected device may already have applied the last action. The platform never automatically replays an unconfirmed action. User-initiated retry creates a linked new action.

## 17. Evidence Strategy

Always record:

- Artifact, device, UID, and run configuration snapshots.
- Action intent and normalized parameters.
- Per-device mapped parameters, results, and timings.
- Bridge state changes and acknowledgements when available.
- Per-device logcat ring buffers and relevant excerpts.
- User recovery decisions.

Automatically capture screenshots:

- At run start and finish.
- On failure and before/after recovery.
- At explicit user checkpoints.

Video:

- Optional per run/device.
- Leader video is the recommended default when video is enabled.
- Followers remain off unless selected, reducing USB and encoding pressure.

Every failure evidence bundle contains the current screenshot, recent logs, foreground package, action/result records, bridge state, and recovery decision under the same action/run relationship.

Mandatory-capture matrix:

| Failure context | Required evidence |
|---|---|
| All failures | Persisted action, target snapshot, and one final/unknown result per target |
| Device still connected | Current screenshot, foreground package/activity, redacted recent logcat, mapped input, worker/Appium timing |
| Bridge-ready device | Latest bridge state plus arm/ACK/rejection records and timing uncertainty |
| Disconnected device | Last buffered redacted logs and an explicit unavailable record for captures that require a live transport |
| Recovery decision | User/system decision, actor, time, reason, new action/rejoin relationship |

The evidence gate passes only when every required item is `READY` or has an allowed, explicit unavailability reason for that failure class. “Capture failed” without a categorized reason is itself a failed acceptance result.

## 18. Reports and Exports

Automatic outputs:

1. Searchable platform history.
2. Offline static HTML report.
3. Evidence ZIP with a manifest and file hashes.

Optional outputs:

- Excel summary and detailed action/device sheets.
- PDF presentation of the HTML report.
- JUnit XML for CI consumption.

Optional exports are user-triggered jobs. Their failure cannot invalidate the completed run or the default HTML/ZIP.

Before publication, logcat and text evidence pass through configured secret/PII redaction. HTML escapes all device, package, log, and user-controlled fields; Excel neutralizes formula-leading values; ZIP output uses streaming ZIP64 into a temporary file followed by hash verification and atomic rename.

## 19. Security and Safety

1. Bind the management console, API, Appium, and helper transports to explicit loopback addresses by default; do not treat loopback binding alone as authentication.
2. Generate a random credential on each launcher start. The launcher opens a one-time bootstrap URL that exchanges its code for an HttpOnly, SameSite=Strict session cookie; the code is immediately invalidated and is never written to logs.
3. Enforce strict `Host`, `Origin`, CORS, WebSocket-origin, CSRF-token, and content-security-policy checks. Reject DNS-rebinding and cross-site HTTP/WebSocket attempts in automated security tests.
4. Destructive operations require a server-issued, single-use confirmation nonce bound to the authenticated session, operation, serials, and expiry; a client-side dialog alone is insufficient.
5. Do not start Appium with relaxed security.
6. Validate every ADB operation through a typed command allowlist and explicit serial.
7. Expose no arbitrary shell endpoint or UI field.
8. Compile bridge receiver/state code only in QA builds. Protect arm traffic with the per-run nonce over an ADB-only/non-public transport.
9. Keep bridge announcements metadata-only; never expose arbitrary gameplay invocation.
10. Add a release-build negative test proving the receiver, exported component, listening socket, and `QA_*` log output are absent.
11. Mask synchronized text in evidence by default.
12. Store no external account passwords because game accounts are device-derived.
13. Keep keystore passwords out of SQLite, process arguments where avoidable, logs, diagnostics, and reports; persist secrets only through an OS-backed credential store when the user opts in.
14. Record tool versions and hashes in diagnostics and reports.

## 20. Storage and Retention

Proposed layout:

```text
E:\Projects\UnityMultiDeviceTestCenter\
  apps\                 source applications: server, console, launcher
  packages\             contracts, adapters, reports, Unity QA bridge
  data\
    app.db               SQLite metadata
    artifacts\           imported packages and generated install sets
    logs\                host and service logs
    runs\<runId>\
      run.json
      actions.jsonl
      devices\<serial>\
        screenshots\
        video\
        logcat\
        state\
      reports\
  tools\                 pinned runtime and external tools
```

Defaults:

- Retain completed runs for 30 days.
- A user can mark a run for long-term retention.
- Warn when `E:` falls below 20 GiB free.
- Block new videos and new runs when `E:` falls below 5 GiB free.
- Show estimated reclaimed space before cleanup.
- Cleanup never deletes original imported application artifacts silently.
- Keep a cleanup audit record.

## 21. BuildProvider Extension

The first provider imports existing files:

```ts
interface BuildProvider {
  id: string;
  validate(request: BuildRequest): Promise<BuildValidation>;
  build(request: BuildRequest, events: BuildEventSink): Promise<AppArtifactRef>;
  cancel(buildId: string): Promise<void>;
}
```

First version:

- `ArtifactImportProvider` validates and registers APK/AAB files.

Later:

- `UnityCommandBuildProvider` invokes a configured Unity batch/quick-build command and returns the same `AppArtifactRef`.
- Adding it must not change Apps, Deployments, Sessions, Actions, or Reports.

## 22. Atomic Milestones and User Gates

Every milestone follows the same gate:

1. Implement only that milestone's capability.
2. Run automated verification.
3. Produce live UI/device evidence when applicable.
4. Report changed files, commands, results, limitations, and rollback.
5. Stop and wait for explicit user acceptance.

### M0: Launcher and Environment Self-Check

Scope:

- Establish project layout and pinned-runtime rules.
- Establish version manifests and download/hash rules for project-local dependencies without changing global PATH or machine environment variables.
- Detect E-drive storage, ADB, Java, bundletool, Appium, UiAutomator2, scrcpy, and port readiness.
- Display actionable diagnostics without changing system environment variables.

Acceptance:

- Repeated checks are stable.
- Missing Appium/driver is reported accurately.
- Diagnostics include resolved executable paths and versions.

Evidence: self-check page, automated checks, and diagnostic JSON.

### M1: Management Console Foundation

Scope:

- Launcher/service lifecycle.
- Reproducible project-local Node/dependency provisioning from lockfiles and the M0 version manifest.
- React shell and navigation.
- API/WebSocket health.
- SQLite migrations and E-drive data initialization.

Acceptance:

- Clean start/stop and restart.
- Browser refresh reconstructs health state.
- Repeated migrations are idempotent.

Evidence: page screenshots and API/database tests.

### M2: Device Discovery

Scope:

- One-device ADB discovery and metadata.
- Connect/disconnect/reconnect state.
- Typed serial-bound ADB adapter.

Acceptance:

- Current Samsung appears with correct serial/model/system/display.
- Unplug/replug produces correct states without duplicate device rows.
- No command can run with an ambiguous target.

Evidence: real-device state timeline and adapter tests.

### M3: Artifact Library

Scope:

- Import APK/AAB.
- Parse metadata and SHA-256 deduplication.
- Register installed-version references.

Acceptance:

- Duplicate files reuse one immutable content record.
- Invalid files fail without partial records.
- Original files remain unchanged.

Evidence: synthetic fixtures and Apps page.

### M4: Single-Device Deployment

Scope:

- APK install.
- AAB conversion/signing/install.
- Installation/data generation tracking and UID invalidation on destructive mutations.
- Optional clear-data confirmation.
- Launch and package/version/foreground verification.

Acceptance:

- APK and AAB paths work on one real device.
- Each step has an explicit state/log and can retry safely.
- Signing-profile and installed-signer mismatches fail with actionable diagnostics and never leak credentials.
- Clear-data/uninstall invalidates the prior UID and requires a current-generation observation or manual confirmation.
- Installed-version mismatch is visible and blocks an incompatible run.

Evidence: deployment log, installed version, and device screenshot.

### M5: Unity QA Bridge and UID

Scope:

- Versioned bridge package plus a minimal QA target scene/build fixture used only for contract and coordinate verification.
- UID/generation, safe area, orientation/metrics epoch, view/focus/state, clock calibration, and arm/ACK correlation contract.
- Serial-to-UID storage and degraded non-bridge behavior.

Acceptance:

- QA package binds correct UID to current serial and version.
- Arm handshake rejects stale instance, nonce, descriptor, focus, metrics epoch, and TTL values.
- State updates are parsed without leaking unrelated logcat text.
- Non-QA package is marked degraded, never falsely bridge-ready.
- A release build contains no active receiver/socket or `QA_*` log path.

Evidence: bridge fixtures, real `QA_STATE`, and Devices page.

### M6: Leader View and Single-Device Run

Scope:

- `ViewProvider` primary/fallback spike.
- Leader stream embedded in console.
- Overlay pointer capture.
- One-device run, sequential transactional action/outbox persistence, crash reconciliation, and minimal evidence manifest.

Acceptance:

- One visible gesture creates exactly one action.
- Input is injected by the worker, not duplicated by the video provider.
- Client retries are idempotent, one group action is in flight, and a forced service crash produces explicit `UNKNOWN`/`CANCELLED` results without replay.
- Primary stream reaches first frame within 5 seconds, sustains at least 20 FPS with host-receive-to-browser-render P95 at most 250 ms for 10 minutes, and keeps a bounded two-frame queue.
- Rotation/metrics change cancels pending input, pauses dispatch, and restores a correctly mapped stream within 3 seconds after geometry stabilizes.
- A one-device run completes with an indexed action/evidence manifest. Mandatory HTML/ZIP reporting remains owned by M10.

Evidence: session recording, action timeline, and indexed evidence manifest.

### M7: One Leader and One Follower

Scope:

- Concurrent two-worker dispatch.
- Safe-area coordinate mapping.
- Per-device results, calibrated bridge receipts, membership epochs, and worker-generation fencing.

Acceptance:

- At least 99 of 100 taps hit the QA target.
- Twenty straight swipes finish within 2% of safe-viewport dimensions.
- Dispatch-start skew P95 is at most 50 ms and calibrated Unity receipt skew P95 is at most 250 ms when clock uncertainty is within bounds.
- Leader loss pauses the run; follower quarantine/rejoin increments epochs and never accepts a late old-worker result.

Evidence: two-device action/coordinate/receipt report.

### M8: Dynamic One-to-Four Devices

Scope:

- Run selection for 1, 2, 3, or 4 devices.
- One leader plus 0-3 followers.
- Four isolated sessions, ports, previews, logs, and evidence paths.
- Deployment to 1-4 selected devices, including per-device AAB install-set generation and full installed-identity comparison.

Acceptance:

- All four capacity combinations create and finish correctly.
- APK, AAB, and installed-version identity checks work for every selected device without reusing an incompatible device-specific install set.
- Four devices sustain 30 minutes and 1,000 actions.
- Zero serial cross-talk, port collision, or evidence overwrite.

Evidence: capacity matrix and four-device soak report.

### M9: Complete First-Version Actions and Failure Policies

Scope:

- Long press, drag/swipe, Back, masked text, activate/terminate/restart.
- Pause-all and quarantine policies.
- Disconnect, session loss, crash/foreground mismatch, bridge mismatch, and text-focus fault injection.

Acceptance:

- Each action type passes on representative devices.
- Back and representative ASCII/CJK text reproduce correctly; synchronized text is rejected unless every target proves a matching trusted focus.
- Faults pause or quarantine within two seconds.
- No reconnect automatically replays an uncertain action.
- Retry creates a linked new action.

Evidence: fault-injection matrix and recovery reports.

### M10: Default Reports

Scope:

- Results history.
- Offline HTML.
- Evidence ZIP manifest and hashes.
- Interrupted-run partial report.
- Transactional `FINALIZING`/`FINALIZATION_FAILED` recovery and mandatory-capture matrix.
- Redaction, HTML escaping, spreadsheet-safe shared values, and streaming ZIP64 publication.

Acceptance:

- Normal, failed, and interrupted samples open without the service running.
- Every failed action links to all available per-device evidence.
- Every mandatory item is ready or has an allowed categorized unavailability reason; uncategorized capture loss fails acceptance.
- Forced crashes during evidence/report writes leave no published partial files and can retry finalization without replaying actions.

Evidence: three report fixtures and integrity checks.

### M11: Optional Exports and Portable Delivery

Scope:

- Excel, PDF, and JUnit export jobs.
- Portable Windows directory.
- User and maintenance documentation.

Acceptance:

- Default remains HTML/ZIP.
- Every optional format is selectable and validated.
- A clean extracted directory starts successfully and runs self-check.
- From that clean extracted directory, one real device completes artifact selection/deployment, run, default report, and optional export smoke tests.
- A 60-minute run completes without crash or sustained linear post-warmup memory growth.
- Documentation covers device onboarding, package testing, recovery, cleanup, and future BuildProvider integration.

Evidence: export samples and clean-directory smoke test.

## 23. Verification Strategy

### 23.1 Unit Tests

- Coordinate transforms and orientation rejection.
- Run/action state machines.
- Client idempotency, action sequencing, membership epochs, and worker-generation fencing.
- Port allocation and serial isolation.
- Command allowlist and dangerous-operation confirmation.
- Retry/parent action behavior.
- Retention and storage thresholds.
- Report models and integrity manifests.

### 23.2 Contract Tests

- Fake and recorded ADB responses.
- Fake Appium clients and session errors.
- Bridge state/ack parsers and schema compatibility.
- Bridge arm nonce/instance/TTL/descriptor/focus/metrics rejection and clock-calibration uncertainty.
- ViewProvider primary/fallback contract.
- BuildProvider import/future-provider contract.

### 23.3 Integration Tests

- SQLite migrations and transaction recovery.
- Content-addressed artifact storage.
- Deployment state persistence and retry.
- Per-device AAB install-set identity and UID invalidation after data/install generation changes.
- Interrupted-run recovery.
- Action-outbox crash reconciliation and atomic evidence/report publication.
- Report and export pipelines.

### 23.4 Browser End-to-End Tests

- Device-to-report primary flow.
- Empty, loading, error, disconnected, and paused states.
- Browser refresh during an active run.
- Destructive confirmation and masked text behavior.
- Host/Origin/CORS/CSRF/WebSocket-origin/DNS-rebinding rejection and one-time destructive confirmation nonces.
- Responsive layout at supported desktop and diagnostic mobile widths.

### 23.5 Physical Device Tests

- Begin with the currently connected Samsung for M2/M4/M5/M6.
- Require two real devices for M7.
- Require all 1/2/3/4 combinations and four-device soak for M8.
- Use a matrix spanning high-end, lower-performance/resolution, old compatibility boundary, and special aspect/safe area when hardware is available.

If the necessary number of devices is unavailable, automated fake-adapter tests may continue, but the physical milestone remains unaccepted.

## 24. System Acceptance Metrics

| Metric | First-version target |
|---|---|
| Dispatch-start skew | Four-device P95 at most 50 ms |
| Unity bridge receipt skew | Four-device calibrated P95 at most 250 ms; every sample reports clock uncertainty and is excluded/labeled unavailable when uncertainty exceeds the configured bound |
| Leader stream | First frame at most 5 seconds; at least 20 FPS and host-receive-to-browser-render P95 at most 250 ms during the M6 primary-provider gate |
| Fault response | Pause or quarantine within 2 seconds |
| QA target taps | At least 99/100 hits |
| Straight-swipe endpoint | Error at most 2% of safe-viewport dimension |
| Four-device soak | 30 minutes and 1,000 actions with no cross-talk, port collision, or evidence overwrite |
| Extended stability | 60-minute run with no crash and no sustained linear post-warmup memory growth |
| Failed-action evidence | 100% of mandatory items ready or carrying an allowed categorized unavailability reason; uncategorized capture loss is a failure |

These are low-latency synchronization targets, not frame-lock guarantees. USB scheduling, Appium execution, device frame rate, thermal state, and game/network state can create visible skew.

## 25. Definition of Done

The project is complete only when:

1. M0-M11 have each passed their individual user confirmation gate.
2. The maximum four-device physical acceptance has run on real devices.
3. The portable Windows directory starts from a clean extracted location on `E:`.
4. The management console exposes every confirmed page and state.
5. APK, AAB, and installed-version flows are verified.
6. Single-device and 1-3 follower modes are verified, including fixed membership, leader-loss pause, fenced rejoin, and multi-device deployment.
7. Both failure policies and no-auto-replay behavior are proven through fault injection.
8. Default and optional reports pass atomic publication, security, integrity, and layout checks.
9. QA Bridge and non-Bridge degraded behavior are documented and verified.
10. User and maintenance documentation is complete.
11. Known later scope remains behind explicit provider/adapter interfaces and is not represented as implemented.

## 26. Written-Spec Review Gate

This document is the implementation contract. The original written design was approved before implementation planning. The implementation-safety amendments added during plan review do not change the selected product form or feature scope; they close action-ordering, identity, timing, security, persistence, evidence, and milestone-ownership gaps. The amended document and detailed plans are reviewed together before M0 begins.
