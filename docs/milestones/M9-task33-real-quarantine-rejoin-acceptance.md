# M9 Task 33 - Real quarantine and rejoin acceptance

Date: 2026-09-07

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

## Scope

This slice validates the approved rejoin console/API contract against two
physical Android devices using Appium-only managed actions. The failure is
injected by stopping the Motorola Follower's UiAutomator2 server process; no
Unity QA Bridge injection and no game-data clearing are used.

## Environment

| Item           | Value                                                                           |
| -------------- | ------------------------------------------------------------------------------- |
| ADB executable | `D:\Unity\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe` |
| ADB server     | shared `5038`                                                                   |
| Appium mode    | `APPIUM_ONLY`                                                                   |
| Devices        | Samsung `R5CX211TXNT` Leader, Motorola `ZT4229J5ZR` Follower                    |
| Viewports      | Samsung `1080x2340`, Motorola `720x1604`                                        |
| Run            | `run-8a6e32e7-f1e8-4e2a-8b7e-e318fdb17019`                                      |
| Evidence root  | `E:\Temp\UnityMultiDeviceAcceptance\m9-rejoin-physical-20260907`                |

## Executed flow

1. Created and started a `QUARANTINE_FAILED_DEVICE` two-device session.
2. Stopped Motorola's `io.appium.uiautomator2.server` with `am force-stop`.
3. Submitted a normalized tap. Samsung succeeded; Motorola failed with
   `APPIUM_SESSION_LOST`.
4. Runtime recovery completed `QUARANTINE_DEVICE` for the active follower.
5. Paused the session from the operator control path.
6. Rejoined Motorola through
   `POST /api/sessions/:id/devices/:serial/rejoin`.
7. Verified epoch/generation `1 -> 2`, both memberships `ACTIVE`, and a new
   normalized tap succeeded on both devices.
8. Finalized the run as `FINISHED`.

## Results

- Physical quarantine: **PASS**
- Incident: `APPIUM_SESSION_LOST` on `ZT4229J5ZR`
- Recovery: `QUARANTINE_DEVICE`, status `SUCCEEDED`
- Membership: `ACTIVE -> QUARANTINED -> ACTIVE`
- Session: `RUNNING -> PAUSED -> RUNNING -> FINISHED`
- Rejoin epoch/generation: `1 -> 2` for both workers
- Fault action: Samsung `SUCCEEDED`, Motorola `FAILED` as expected
- Post-rejoin action: `SUCCEEDED` on both device targets
- Both Unity game processes remained present after rejoin
- ADB/Appium/system/MJPEG/Bridge ports were released after service shutdown

## Acceptance decision

**PASS.** The physical Follower quarantine, operator pause, console/API
rejoin, worker rebuild, and post-rejoin synchronized action all work on the
real Samsung/Motorola pair without QA Bridge injection.

Evidence was copied with matching file count and byte count to the E-drive
acceptance root. The record is complete locally and awaits user approval
before commit and push to `origin/main`.
