# M11 Task 17 - Real dual-device release smoke revalidation

Date: 2026-09-03

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

## Scope

This is a fresh real-device revalidation after Samsung returned to ADB. It uses
the current release bundle from M11 Task 16 and confirms the two-device action
path without setting `ANDROID_HOME` manually.

## Result

| Check                      | Result                                                          |
| -------------------------- | --------------------------------------------------------------- |
| Runtime root               | `E:\Projects\UnityMultiDeviceTestCenter\dist\portable-20260903` |
| Session                    | `run-418929b0-17dc-4b36-a054-2787c57035ed`                      |
| Devices                    | `R5CX211TXNT` Leader, `ZT4229J5ZR` Follower                     |
| Duration / samples         | 120 seconds / 11                                                |
| Warm-up / analyzed samples | 30 seconds / 8                                                  |
| Actions / analyzer         | 0 errors / `PASS`                                               |
| Max queue / WAL            | 0 / 4,120,032 bytes                                             |
| Runtime allocation         | 2 workers, 2 leases, 4 forwards                                 |
| Finalization               | `FINISHED` / `COMPLETED`, HTML and ZIP `READY`                  |
| Cleanup                    | worker 0, lease 0, forward 0                                    |

Evidence: `E:\Temp\UnityMultiDeviceAcceptance\m11-release-20260903-dual-smoke-r2\m11-stability.json`

HTML SHA-256: `232fa3f36a4003bdbad626a57e9661241da16158431822bc6408592baeb84515`

ZIP SHA-256: `9e47d7a6ca3ac4e07d47c80361f0b125fa832b07b0ff943929eb2e30555bd0a8`

After completion, both devices remained online and in the Unity game activity;
both `mStayOn=false` settings were restored and no ADB forwards remained.

## Verification

- Latest release package dual-device smoke: PASS
- Current ADB state: Samsung and Motorola both `device`
- Source branch before run: `main` at `699d2cd`

This revalidation record is ready for the next approved documentation commit.
