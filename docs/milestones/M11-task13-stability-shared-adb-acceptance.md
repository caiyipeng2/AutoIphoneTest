# M11 Task 13: Stability Runner Shared ADB Acceptance

Date: 2026-09-02

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

## Fix

`tests/hardware/m11-stability.ts` now propagates the configured
`TEST_CENTER_APPIUM_ADB_PORT` or `TEST_CENTER_ADB_SERVER_PORT` into
`ADB_SERVER_SOCKET` and `ANDROID_ADB_SERVER_PORT`. Direct ADB sampling, battery
temperature reads, forward counting, and the portable server child therefore use
the same ADB server as Appium.

## Fresh smoke

The runner was invoked with `TEST_CENTER_APPIUM_ADB_PORT=5038` and
`TEST_CENTER_ADB_SERVER_PORT=5038` only. No manual ADB socket variables were set.

| Check              | Result                              |
| ------------------ | ----------------------------------- |
| Device             | `R5CX211TXNT` / Samsung S24 Ultra   |
| Duration           | 40 seconds                          |
| Samples            | 4, including 3 post-warmup samples  |
| Checkpoints        | 2, all successful                   |
| Session            | `PREFLIGHT -> RUNNING -> FINISHED`  |
| Stability analyzer | `PASS`, `m11-stability-analyzer-v2` |
| Cleanup            | worker 0, port lease 0, forward 0   |

Evidence: `E:\Temp\UnityMultiDeviceAcceptance\m11-stability-shared-adb-20260902-r2\m11-stability.json`

This is a short endpoint/采样 smoke, not the formal 60-minute M11 stability gate.
