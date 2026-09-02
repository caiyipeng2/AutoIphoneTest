# M11 Task 14 - Formal single-device stability acceptance

Date: 2026-09-02

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

## Scope

This slice closes the formal 60-minute stability gate for one connected Android
device. The earlier two-device Appium-only smoke remains the evidence for the
dual-device path; this run intentionally used the stable Motorola device because
the Samsung ADB connection was not stable enough for a formal gate.

## Long-run fix

The stability runner now reads each selected device's Android `mStayOn` setting,
temporarily enables `adb shell svc power stayon true` for the unattended run,
and restores the captured value in `finally`. A restore failure is recorded as a
cleanup error and changes a passing run to `FAIL`.

The first formal attempt (run `run-2ea630e1-790a-4f27-8318-4d422e9b7a82`) was
retained as diagnostic evidence. Its analyzer passed, but one checkpoint action
failed because the Motorola foreground package was `com.motorola.launcher3`,
consistent with the device display timing out during the run. It was not
classified as a stability pass.

## Formal run

| Check                         | Result                                                 |
| ----------------------------- | ------------------------------------------------------ |
| Runtime root                  | `E:\Projects\UnityMultiDeviceTestCenter\dist\portable` |
| Device                        | `ZT4229J5ZR` / Motorola moto g 2025                    |
| Session                       | `run-a137e000-83dc-45a3-a349-902162061ba6`             |
| Duration                      | 3,600 seconds                                          |
| Sampling / checkpoint         | 10 / 30 seconds                                        |
| Warm-up                       | 600 seconds                                            |
| Samples                       | 335 total, 279 post-warm-up                            |
| Checkpoint action errors      | 0                                                      |
| Analyzer                      | `PASS`, `m11-stability-analyzer-v2`                    |
| Max queue depth               | 0                                                      |
| Max WAL                       | 4,161,232 bytes                                        |
| Private-byte slope            | -47,148.201439 MiB/minute                              |
| Final private-byte delta      | -2.443359 MiB                                          |
| Handle / thread slope         | 0 / 0 per minute                                       |
| Crash / restart count         | 0 / 0                                                  |
| Final cleanup                 | worker 0, port lease 0, forward 0                      |
| Cleanup errors                | 0                                                      |
| Session / export finalization | `FINISHED` / `COMPLETED`, HTML and ZIP `READY`         |

Evidence: `E:\Temp\UnityMultiDeviceAcceptance\m11-stability-moto-20260902-stayawake-formal\m11-stability.json`

HTML SHA-256: `3fb37eb1229aabdc8c845089167f44bb7e065e49b37215a2927929382100ef10`

ZIP SHA-256: `5ad9807fdf5bbeb91889b2b7a98877e62a7ebdc3d88accda7eb77d4fae9be650`

After finalization, ADB reported the Motorola device as `device`, no forwards
remained, and `mStayOn=false`, confirming restoration of the pre-run setting.

## Verification

- `npm run typecheck`: PASS
- `npm test`: 615 passed, 2 skipped
- M11 ADB endpoint regression: 3 passed
- 120-second Motorola stay-awake smoke: PASS, 12 samples, 0 action errors
- CodeGraph: index up to date (425 files, 6,240 nodes, 14,042 edges)

The source and this acceptance record are ready for the approved commit and
push to the repository's `main` branch.
