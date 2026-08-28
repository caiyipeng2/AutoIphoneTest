# M11 Task 10 - Release ZIP and clean extraction acceptance

Date: 2026-08-26<br>
Repository: `E:\Projects\UnityMultiDeviceTestCenter`<br>
Release ZIP: `dist/releases/m11-20260826-current/TestCenterLauncher.zip`<br>
Clean extraction: `E:\M11-Release-Verify-20260826`

## Release artifact

The current `main` portable build now uses a Windows PowerShell-compatible ZIP
publisher. Junction metadata is read defensively, the temporary archive keeps a
`.zip` suffix for PowerShell 5.1, and .NET `ZipFile.CreateFromDirectory` includes
hidden files that are covered by the manifest.

| Check            | Result                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Build command    | `build-portable.ps1 -SkipBuild -SkipProvisioning`                                        |
| ZIP size         | 644,479,165 bytes                                                                        |
| ZIP SHA-256      | `47992EAD2ADBC87789527F3EA691FAAC9AAADC126265CDBA7862B7BE18C4AE8F`                       |
| ZIP entries      | 41,310 entries, including 41,303 manifest files and directory entries                    |
| Required entries | `manifest.sha256.json` and `data\\.gitkeep` present                                      |
| Source manifest  | 41,303 files; SHA-256 `C75164E904544A5761E7432FA32FEC1BE6C85AC98D1C7AFD8ECE0166E991DBAD` |

## Clean extraction verification

`scripts/verify-portable.ps1 -PortableRoot E:\M11-Release-Verify-20260826`
passed with 41,303 manifest files and bundled Node `v22.23.1`. The extracted
directory contains the launcher, server/console bundles, portable tools,
production dependencies, manifest, and hidden `data\\.gitkeep`.

## Real release runtime

Evidence JSON: `data/hardware-m11-release-smoke-20260826-one/m11-portable-smoke.json`<br>
Run: `run-5104d1ee-2773-4363-aa5d-bb3a33bd43ca`<br>
Device: `R5CX211TXNT` (`SM-S9280`)

The initial two-device attempt was rejected before server startup because
`R5CWB17PN0Y` had disappeared from the ADB server. The release ZIP was then
validated using the one currently online device, which is valid under the
project's dynamic 1-4 device model.

| Phase            | Result                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| Package          | Installed `com.hg.idleweaponshoptycoon.android` verified by release ADB |
| Session          | `CREATED -> PREFLIGHT -> RUNNING -> FINISHED`                           |
| Actions          | Tap and swipe both `SUCCEEDED` on the real device                       |
| Default reports  | HTML and ZIP `READY`; finalization `COMPLETED`                          |
| Optional reports | Excel, PDF and JUnit `READY` and downloaded                             |
| Cleanup          | Release server and worker/Appium resources released                     |

| Format    |   Bytes | SHA-256                                                            |
| --------- | ------: | ------------------------------------------------------------------ |
| HTML      |   7,150 | `F9727B4F79EB84B84CD874FB383BA4202A29A9DF6DE1D80051DD627F1D75C3BB` |
| ZIP       |   2,678 | `258369BE30124D592E92A44A6ACE8DEE69416ACC2A5B06CBF095F10DE78B0A6B` |
| Excel     |  10,548 | `C3234D03BEAF3C7FBAD6E6DE08A033D763959E575649657CA48F3DE241655949` |
| PDF       | 120,866 | `ADF1DEE116A411E7D2C4429F2B7F29DDA076460B94DE1C3D35D102CEAA7BB7DC` |
| JUnit XML |   1,123 | `E014DE5DC43C43D29FA849830A30D116D572A1071DD3C17FE9133F7CF91EDF70` |

The HTML report has inline CSS and `default-src 'none'`; the report ZIP manifest
matches the HTML size and SHA-256. Excel starts with the ZIP signature `50 4B 03 04`,
and the JUnit suite contains two action/device test cases with zero failures or
errors.

## Acceptance boundary

This slice proves the current release ZIP can be extracted and run from a clean
E-drive directory on a real Android device. The latest source-built directory
already has a separate two-device acceptance in [M11 Task 9](M11-task9-current-main-portable-revalidation.md).
This slice does not claim four-device capacity, QA Bridge UID handshake, Unity
source-project builds, or the user-deferred fault-injection/recovery acceptance.

The release artifact, clean extraction, and local evidence are retained locally.
The source changes are committed as `6d8bbb5` and pushed to `origin/main`; the
generated ZIP remains an ignored build artifact rather than a Git-tracked file.
