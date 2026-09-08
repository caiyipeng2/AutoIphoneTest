# M11 Task 18 - Current portable dual-device smoke revalidation

Date: 2026-09-08

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

## Scope

This slice rebuilds the Windows portable runtime from the current `main`,
verifies its manifest, and runs the two-device optional-export smoke using the
current Samsung/Motorola pair. The portable package now includes the Android
SDK subset required by UiAutomator2 (`platform-tools` and `build-tools`), and
the Launcher injects those paths when present.

## Portable artifact

| Item                 | Result                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Portable directory   | `E:\Temp\UnityMultiDeviceAcceptance\m11-current-portable-20260908-r2`                       |
| Release ZIP          | `E:\Temp\UnityMultiDeviceAcceptance\m11-current-release-20260908-r2\TestCenterLauncher.zip` |
| ZIP size             | `709,791,992` bytes                                                                         |
| ZIP SHA-256          | `9D89700B4A08CAED8EC9105E165AE5D83CABDC74F51A4F936BDDD49A6EB47D09`                          |
| Manifest entries     | `41,504`                                                                                    |
| Manifest SHA-256     | `1C59DFD3FF1BD82F2B44D0808E4939F16B0742FED42262D4613CCA6857C376E1`                          |
| Layout/manifest test | **2/2 passed**                                                                              |

## Real two-device smoke

| Item                | Result                                                            |
| ------------------- | ----------------------------------------------------------------- |
| Devices             | Samsung `R5CX211TXNT` Leader, Motorola `ZT4229J5ZR` Follower      |
| ADB                 | Shared server `5038`; package v63 verified on both devices        |
| Runtime             | Bundled Node `22.23.1`, portable server dist, bundled Appium Home |
| Session             | `run-d42fdbad-d832-40df-b860-a2bc1adf09af`                        |
| Lifecycle           | `CREATED -> PREFLIGHT -> RUNNING -> FINISHED`                     |
| Tap / Swipe         | Both target devices `SUCCEEDED`                                   |
| HTML / ZIP          | `READY`                                                           |
| Excel / PDF / JUnit | `READY`, downloaded successfully                                  |
| Cleanup             | Appium/worker ports released; both devices remained online        |

## Export hashes

| Format    |    Size | SHA-256                                                            |
| --------- | ------: | ------------------------------------------------------------------ |
| HTML      |   7,548 | `D52FA3BD4251D1DA7B21FF76AC2EEA952601978F3E41334FCE8F6E37DC3AB6EF` |
| ZIP       |   2,713 | `697EF06C967E881AC2E2D4C4E360C5C3E80C42F5FF03CDDD785F5D405CD860E5` |
| Excel     |  10,604 | `9198D216C20487353C5AB079EEBCC40FF14B0C667A5B99AB1CAE4AA5AC9330E6` |
| PDF       | 123,300 | `7F55ABE05B020DAAA154972839FC7BD6EEE5F97B8CD1D21CD58599CD15BA2E62` |
| JUnit XML |   1,847 | `43C5D56FD4399B0CA06D415372EF8612EA0C5DCF0C872EF125A84DB8C6628351` |

The downloaded files were independently checked: HTML contains the restrictive
CSP and no script tag, PDF has `%PDF-` magic, JUnit parses as XML, and Excel is
a readable ZIP package containing `[Content_Types].xml`.

## Acceptance boundary

**PASS for current two-device portable smoke and optional exports.** The 60-minute
stability gate remains represented by the prior M11 formal records; this slice
does not rerun that long-duration test. The source fixes and evidence are
complete locally and await user approval before commit and push.
