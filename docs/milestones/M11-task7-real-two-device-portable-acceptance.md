# M11 Task 7: Real Two-Device Portable v61 Acceptance

Date: 2026-08-26  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`  
Clean runtime root: `E:\M11-Portable-Verify-20260821`  
Package: `com.hg.idleweaponshoptycoon.android` (`Idle Weapon Shop Tycoon`)

## Preconditions

| Check                 | Result                                           |
| --------------------- | ------------------------------------------------ |
| Portable manifest     | PASS, 41,254 files and Node `v22.23.1` verified  |
| `R5CX211TXNT` package | Installed v61 split set verified with ADB        |
| `R5CWB17PN0Y` package | Installed v61 split set verified with ADB        |
| Runtime mode          | Appium-only managed path, no QA Bridge injection |

## Real clean-extraction flow

Evidence JSON: `data/hardware-m11-portable-smoke-20260826/m11-portable-smoke.json`  
Run: `run-5e87697c-c886-48d0-bff2-cd658e698a24`

| Phase             | Result                                                       |
| ----------------- | ------------------------------------------------------------ |
| Device discovery  | PASS, both devices ONLINE                                    |
| Session lifecycle | `CREATED -> PREFLIGHT -> RUNNING -> FINISHED`                |
| Tap               | PASS on leader and follower; both target results `SUCCEEDED` |
| Swipe             | PASS on leader and follower; both target results `SUCCEEDED` |
| Finalization      | `COMPLETED`, HTML and ZIP `READY`                            |
| Optional exports  | Excel, PDF and JUnit all `READY` and downloaded              |
| Cleanup           | Portable server stopped; Appium/worker resources released    |

Devices were recorded as `R5CX211TXNT` (`SM-S9280`, leader) and `R5CWB17PN0Y`
(`SM-A5460`, follower). The run uses the installed package and verifies package
presence with the portable ADB before creating the session.

## Published outputs

All outputs were downloaded from the portable server and hashed by the acceptance
script under `data/hardware-m11-portable-smoke-20260826/<run>/exports/`.

| Format    |   Bytes | SHA-256                                                            |
| --------- | ------: | ------------------------------------------------------------------ |
| HTML      |   7,551 | `2f4782f6fc3c7d028f392d4170c67d6b3ddfdc729340602691923c989599c757` |
| ZIP       |   2,711 | `87ed65a8065111c2868a4609864854b9d8fc523b5346196ddd7aea8d9a40b412` |
| Excel     |  10,599 | `f19b026350a215da6171ceba468ff838e27389994b2d460fb005d09f7a290d6e` |
| PDF       | 123,797 | `5e92aaf88d73c6991ff638f2f5cf67342a90921048fb74c70d357a2f7a538551` |
| JUnit XML |   1,851 | `9a2f908216fb36032a298af4eb1b4abeab606c0cae4509e12e765c39dda5cc21` |

## Acceptance boundary

This slice proves the current two-device package flow, default report publication,
and user-selectable Excel/PDF/JUnit exports from the clean E-drive runtime. It does
not claim four-device capacity, QA Bridge handshake, Unity source-project builds, or
the user-deferred fault-injection/recovery acceptance.

The evidence document is local and uncommitted. Commit and push require explicit
user confirmation under the repository workflow.
