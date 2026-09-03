# M11 Task 15 - Dual-device stability and ADB SDK consistency

Date: 2026-09-02

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

## Runtime fix

The portable runtime now passes an explicit environment to each owned Appium
child. `ANDROID_HOME` and `ANDROID_SDK_ROOT` are derived from the same `adb.exe`
path used by the runtime, so Appium cannot silently select a different host SDK
ADB client. The service-level environment override and SDK-root derivation are
covered by unit tests.

## Dual-device smoke

The automatic SDK-root path passed a 120-second smoke without manually setting
`ANDROID_HOME`:

| Check              | Result                                                    |
| ------------------ | --------------------------------------------------------- |
| Runtime root       | `E:\Projects\UnityMultiDeviceTestCenter\dist\portable-v2` |
| Devices            | `R5CX211TXNT` Leader, `ZT4229J5ZR` Follower               |
| Session            | `run-691a6c7d-787d-4c90-949a-6ba2762ae95c`                |
| Duration / samples | 120 seconds / 11                                          |
| Actions / analyzer | 0 errors / `PASS`                                         |
| Runtime allocation | 2 workers, 2 leases, 4 forwards                           |
| Cleanup            | worker 0, lease 0, forward 0                              |

Evidence: `E:\Temp\UnityMultiDeviceAcceptance\m11-stability-dual-autosdk-smoke\m11-stability.json`

## Formal dual-device run

The formal run completed 3,600 seconds with both devices online and no action
errors. The original runner JSON was marked `FAIL` only because the analyzer
reported the byte-per-minute slope as if it were already MiB-per-minute. The
threshold itself was not changed. After correcting that unit conversion, the
same 333 raw samples were reanalyzed and passed all fixed thresholds.

| Check                      | Corrected result                                          |
| -------------------------- | --------------------------------------------------------- |
| Runtime root               | `E:\Projects\UnityMultiDeviceTestCenter\dist\portable-v2` |
| Devices                    | `R5CX211TXNT` Leader, `ZT4229J5ZR` Follower               |
| Session                    | `run-6f4e32fa-32b2-481b-89ae-f790a91a9e18`                |
| Duration / sampling        | 3,600 / 10 seconds                                        |
| Warm-up / analyzed samples | 600 seconds / 277                                         |
| Action errors              | 0                                                         |
| Analyzer                   | `PASS`, `m11-stability-analyzer-v2`                       |
| Private-byte slope         | `0.233931 MiB/minute`, Kendall tau `0.602182`             |
| Final private-byte delta   | `11.578125 MiB`                                           |
| Max queue / WAL            | 0 / 4,152,992 bytes                                       |
| Crash / restart count      | 0 / 0                                                     |
| Final cleanup              | worker 0, lease 0, forward 0                              |

Raw evidence: `E:\Temp\UnityMultiDeviceAcceptance\m11-stability-dual-autosdk-formal\m11-stability.json`

The raw sample set was rechecked with `analyzeStability(samples, { warmupSeconds:
600, expectedWorkers: 2, cleanup })` after the local unit conversion fix.
The original raw file remains unchanged for auditability.

HTML SHA-256: `9ce73948d78d041d92469a77b5616e178440d4173d89ae0e93aa61b84751c93d`

ZIP SHA-256: `decaa8ab39096ef5c35b5856b82677b6baf6847c88a56550ed9fb57ebe9d2e59`

After finalization, both devices were still reported as `device`, both
`mStayOn` values were restored to `false`, and no ADB forwards remained.

## Verification

- `npm run typecheck`: PASS
- `npm test`: 618 passed, 2 skipped
- `npm run lint -- --quiet`: PASS
- Prettier checks: PASS
- Appium service and runtime SDK-root tests: 8 passed
- Stability analyzer tests: 6 passed
- CodeGraph: index up to date

This acceptance record and the source changes are approved for commit and push
to the repository's `main` branch.
