# M11 Task 11 - Latest v63 real-package acceptance

Date: 2026-08-28<br>
Repository: `E:\Projects\UnityMultiDeviceTestCenter`<br>
Package: `com.hg.idleweaponshoptycoon.android` (`Idle Weapon Shop Tycoon`)<br>
APKS: `D:\飞书存储\AAB_Install\AAB_Install\idle_weaponshop_haiwai_v63_2026_08_28_15_50-release.apks`<br>
APKS SHA-256: `0CA0C8A1A71F159BAC338005D5C075F253D75D419E06B55F2D4E7BE3B1CDFA22`

## Installation

The latest APKS was installed with the bundled bundletool `1.18.3` on the
currently online Android device `R5CWB17PN0Y`. Package inspection reported
`versionCode=63`, `versionName=2.0.9`, and the expected base, Unity data, and
`arm64-v8a` split APKs.

The first attempt targeted `R5CX211TXNT`, but that serial went offline before
the smoke started. No result from that attempt is counted as a package-flow
pass; the online-device fallback is valid under the dynamic 1-4 device model.

## Release-runtime smoke

The test ran from the clean E-drive extraction `E:\M11-Release-Verify-20260826`
using the bundled Node `v22.23.1` and portable server.

| Check            | Result                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| Evidence         | `data/hardware-m11-v63-release-smoke-20260828/m11-portable-smoke.json` |
| Run              | `run-00bdb002-9e5f-4078-8b55-438305fd128a`                             |
| Device           | `R5CWB17PN0Y` (`SM-A5460`)                                             |
| Artifact source  | Installed package, verified with ADB                                   |
| Session          | `CREATED -> PREFLIGHT -> RUNNING -> FINISHED`                          |
| Actions          | Tap and swipe both `SUCCEEDED`                                         |
| Default reports  | HTML and ZIP `READY`; finalization `COMPLETED`                         |
| Optional reports | Excel, PDF, and JUnit `READY` and downloaded                           |
| Cleanup          | Portable server and worker/Appium resources released                   |

## Downloaded output hashes

| Format    |   Bytes | SHA-256                                                            |
| --------- | ------: | ------------------------------------------------------------------ |
| HTML      |   7,150 | `6dcd0251f5cd4cde8767fad7eed100c2e679eec9011f5cf136c298673d119568` |
| ZIP       |   2,679 | `3e4377ac880b28546a4628da932d327a9835735d85e6878de6c6254607cbf70d` |
| Excel     |  10,551 | `6813a2dd84250885838e968b385f6941c3c276b27058ee13a607c33d4efeddc3` |
| PDF       | 122,984 | `87b89d8e44c66a0ce5938cd6a4ec6c824574f1ad8244f64cfb9e39abc97dc690` |
| JUnit XML |   1,123 | `5578cdaa0ad3d85c9a99a6761b9d8ec1545c9039430c1795b312d82fd24b46b8` |

The HTML report contains `default-src 'none'` and no script tag. The Excel
download starts with the ZIP signature `50 4B 03 04`; the PDF starts with
`%PDF-`; JUnit reports two test cases with zero failures and zero errors.

## Acceptance boundary

This slice proves the latest user-provided v63 APKS can be installed and run
through the clean portable runtime on one real Android device. It does not
claim two- or four-device v63 acceptance, production QA Bridge handshake, a
Unity source-project build, or the user-deferred fault-injection/recovery flow.

Evidence JSON SHA-256:
`615B1584D65A697BFF1CDA42D76FFB2981539E6E3468DFAF06C4C5DF750B3C05`.
The new acceptance record remains local and uncommitted pending explicit user
confirmation.
