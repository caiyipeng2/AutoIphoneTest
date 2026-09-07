# M9 Task 31 - Real dual-device Leader promotion acceptance

Date: 2026-09-07

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android`

## Scope

This slice validates the approved console Leader promotion control against two
physical Android devices using the production Unity package and Appium-only
managed actions. No Unity QA Bridge injection was used.

## Environment

| Item               | Value                                                              |
| ------------------ | ------------------------------------------------------------------ |
| ADB executable     | `D:\ADB\platform-tools\adb.exe`                                    |
| ADB server         | shared `5038`                                                      |
| Appium mode        | `APPIUM_ONLY`                                                      |
| Appium Home        | `E:\Projects\UnityMultiDeviceTestCenter\data\appium-home`          |
| Samsung            | `R5CX211TXNT` / `SM-S9280` / Android 16 / `1080x2340`              |
| Motorola           | `ZT4229J5ZR` / `moto g - 2025` / Android 15 / `720x1604`           |
| Run                | `run-54f8b93f-ddeb-48ba-93a7-1a39881ce7b4`                         |
| Isolated data root | `E:\Temp\UnityMultiDeviceAcceptance\m9-promotion-console-20260907` |

## Executed flow

1. Created a two-device session with Samsung as the initial Leader and
   Motorola as the active Follower.
2. Completed `CREATED -> PREFLIGHT -> RUNNING` with both UiAutomator2 workers.
3. Paused the run from the protected console API.
4. Promoted `ZT4229J5ZR` from Follower to Leader through
   `POST /api/sessions/:id/devices/:serial/promote-leader`.
5. Verified the role swap returned `RUNNING`, incremented `currentEpoch` from
   `1` to `2`, and incremented both worker generations from `1` to `2`.
6. Submitted a new normalized tap after promotion with `sourceMetricsEpoch=2`.

## Results

- Promotion result: **PASS**
- New Leader: `ZT4229J5ZR`
- New Follower: `R5CX211TXNT`
- Both memberships: `ACTIVE`
- Post-promotion tap: **SUCCEEDED** on both device targets
- Both Unity game processes remained present after the tap
- Run was finalized as `FINISHED`
- Worker resources were isolated as Samsung `4723/8200/7810` and Motorola
  `4724/8201/7811` during generation 2
- After service shutdown, port `4780`, Appium, system, MJPEG, and Bridge ports
  had no listeners; the two temporary lease manifests were removed from the
  isolated test root while SQLite/log/evidence files were retained at
  `E:\Temp\UnityMultiDeviceAcceptance\m9-promotion-console-20260907`.

## Acceptance decision

**PASS.** The console Leader promotion control works against two physical
Android devices, rebuilds the worker epoch, and accepts a synchronized action
after the new Leader is active. This closes the physical promotion gate for
M9; three-/four-device capacity and later stability gates remain separate.

The acceptance record is complete locally and awaits user approval before
commit and push to `origin/main`.
