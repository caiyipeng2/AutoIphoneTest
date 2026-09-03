# M9 Task 22 - Fault injection and session recovery acceptance

Date: 2026-09-03

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

## Scope

This slice resumes the previously skipped active-session fault acceptance. It
covers deterministic test-only policy verification, a real UiAutomator2 session
loss on an active two-device run, PAUSE_ALL recovery, no automatic replay, and
physical force-stop/manual relaunch. The production build has no fault-injection
route.

## Fixes required by acceptance

- `DeviceWorker.executeAction()` now forwards Appium action failures to the
  runtime fault monitor.
- UiAutomator2's `instrumentation process is not running` response is classified
  as `APPIUM_SESSION_LOST`.
- Session-loss cleanup explicitly removes the worker's Appium system and MJPEG
  forwards, even when `DELETE /session` cannot complete.
- `m11-stability.ts` accepts an explicit test-only
  `TEST_CENTER_M11_FAILURE_POLICY` value for policy acceptance.
- `m9-fault-matrix.ts` uses the configured shared ADB endpoint and rejects a
  force-stop command when ADB returns a non-zero exit code.

## Automated policy matrix

Focused fault/recovery suites passed **43/43 tests** across 12 files. They cover
the fake fault source, all incident monitor mappings, PAUSE_ALL, follower
quarantine, leader/sole-member pause override, event deduplication, immutable
recovery records, membership transitions, incident API, and timeline UI.

## Real active-session PAUSE_ALL

An isolated E-drive runtime root was used so the run did not share production
data or leases. Motorola follower `ZT4229J5ZR`'s
`io.appium.uiautomator2.server` process was terminated while the session was
RUNNING.

| Check               | Result                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Runtime root        | `E:\Temp\UnityMultiDeviceAcceptance\m9-fault-runtime-20260903-r5`                                    |
| Session             | `run-4ebc49e8-10f9-4694-bc7c-2cbb3ab1bfcf`                                                           |
| Devices             | `R5CX211TXNT` Leader, `ZT4229J5ZR` Follower                                                          |
| Injected fault      | UiAutomator2 instrumentation process termination                                                     |
| Incident            | `APPIUM_SESSION_LOST` on `ZT4229J5ZR`                                                                |
| Recovery decision   | `PAUSE_ALL`, status `SUCCEEDED`                                                                      |
| Detection to pause  | 780 ms, below the 2,000 ms budget                                                                    |
| Session transition  | `RUNNING -> PAUSED -> FINISHED`                                                                      |
| Faulted action      | Action sequence 11 failed on the follower; leader result was also fenced by the group action         |
| Automatic replay    | `false`; later action submissions received `409 Actions are accepted only while the run is RUNNING.` |
| Report finalization | `COMPLETED`, HTML and ZIP `READY`                                                                    |
| Cleanup             | worker 0, port lease 0, forward 0                                                                    |

Structured evidence: `E:\Temp\UnityMultiDeviceAcceptance\m9-fault-paused-20260903.json`

Raw runner evidence: `E:\Temp\UnityMultiDeviceAcceptance\m9-fault-runtime-20260903-r5\evidence\m11-stability.json`

The raw runner is expected to report `FAIL` for this injected-fault run because
its stability action loop records the intentional failed checkpoint. The policy
acceptance status above is derived from the persisted incident, recovery,
transition, action, and cleanup records.

## Physical force-stop and manual recovery

The repaired fault matrix was run without manually setting `ANDROID_HOME`,
`ANDROID_ADB_SERVER_PORT`, or `ADB_SERVER_SOCKET`; only
`TEST_CENTER_ADB_SERVER_PORT=5038` was supplied. Samsung
`R5CX211TXNT` passed force-stop injection, showed no game PID, then relaunched
with a new PID and the Unity activity in focus.

Evidence: `E:\Temp\UnityMultiDeviceAcceptance\m9-fault-matrix-real-20260903-samsung.json`

## QUARANTINE_FAILED_DEVICE boundary

The deterministic policy and membership tests pass for follower quarantine. A
real follower quarantine run was not completed in this slice because the
Motorola device disconnected from ADB after the PAUSE_ALL fault experiment and
did not return during the bounded reconnect attempts. No hardware quarantine
result is claimed.

The current implementation records policy recovery as `PAUSE_ALL` or
`QUARANTINE_DEVICE`. A follow-up local slice now adds the protected
`POST /api/sessions/:id/resume` command for explicit paused-run worker rebuild;
its contract and generation/epoch evidence are recorded in [M9 Task 23](M9-task23-explicit-resume-acceptance.md).
Action retry/skip, device rejoin, and leader promotion remain separate feature
boundaries rather than being inferred from this acceptance.

## Verification

- Focused fault/recovery tests: 43 passed
- Full Vitest suite: 622 passed, 2 skipped
- TypeScript typecheck: PASS
- ESLint: PASS
- Prettier: PASS
- CodeGraph: index up to date
- Final ADB cleanup: Samsung online; no forward remained

The user approved this acceptance record and the source fixes for commit and
push to `main`.
