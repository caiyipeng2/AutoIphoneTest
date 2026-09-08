# M11 Task 19 - Current dual-device stability acceptance

Date: 2026-09-08

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

## Scope

This slice runs the current portable runtime for 3,600 seconds with the two
approved physical devices. It uses the fixed M11 analyzer, a 600-second warm-up,
10-second samples, and 30-second synchronized checkpoint taps.

## Run

| Item                   | Value                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Portable root          | `E:\Temp\UnityMultiDeviceAcceptance\m11-current-portable-20260908-r2`                          |
| Evidence               | `E:\Temp\UnityMultiDeviceAcceptance\m11-current-dual-stability-20260908-r2\m11-stability.json` |
| Session                | `run-189d5735-b9b2-4289-aad5-09facc1a7c4a`                                                     |
| Devices                | Samsung `R5CX211TXNT` Leader, Motorola `ZT4229J5ZR` Follower                                   |
| Runtime                | Bundled Node 22.23.1, bundled SDK ADB, Appium-only                                             |
| Duration / samples     | 3,600 seconds / 324 samples                                                                    |
| Warm-up / analyzed     | 600 seconds / 270 post-warm-up samples                                                         |
| Checkpoint errors      | 0                                                                                              |
| Crashes / restarts     | 0 / 0                                                                                          |
| Session / finalization | `FINISHED` / `COMPLETED`                                                                       |
| HTML / ZIP             | `READY` / `READY`                                                                              |

## Analyzer results

| Metric                     | Result                                          |
| -------------------------- | ----------------------------------------------- |
| Analyzer                   | `m11-stability-analyzer-v2`, **PASS**           |
| Max queue depth            | 0; violation duration 0 seconds                 |
| Max WAL                    | 4,165,352 bytes                                 |
| Private-byte slope         | `-0.002016 MiB/minute`, Kendall tau `-0.005645` |
| First/final rolling median | `446.011719 MiB` / `448.658203 MiB`             |
| Final rolling delta        | `+2.646484 MiB`                                 |
| Handle slope / final delta | `0` / `0`                                       |
| Thread slope / final delta | `0` / `-5`                                      |
| Cleanup snapshot           | worker `0`, lease `0`, forward `0`              |

## Acceptance decision

**PASS.** The current two-device portable runtime completed the full 60-minute
stability gate with no event/resource failures, no action errors, no crashes or
restarts, bounded WAL/queue metrics, and clean worker/lease/forward cleanup.

The previous 5038-port attempt is retained as diagnostic evidence only; this
passing run used the stable default 5037 ADB service and did not change fixed
analyzer thresholds. The record was approved and pushed to `origin/main` in
commit `aaccc20`.
