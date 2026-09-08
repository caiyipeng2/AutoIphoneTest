# M10 Task 7 - Current dual-device report revalidation

Date: 2026-09-08

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

## Scope

This slice revalidates the M10 default report chain on the current `main`
checkout and the currently connected two-device Samsung/Motorola pair. It uses
Appium-only actions and does not inject Unity QA Bridge state.

## Evidence

| Item           | Result                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Run            | `run-48637f90-2867-4111-9581-34b7db976a5e`                                                         |
| Devices        | `R5CX211TXNT` Leader, `ZT4229J5ZR` Follower                                                        |
| Session        | `CREATED -> PREFLIGHT -> RUNNING -> FINISHED`                                                      |
| Actions        | Tap and swipe, both targets `SUCCEEDED` on both devices                                            |
| HTML           | `READY`, 7,548 bytes, SHA-256 `8c305d4325dcf076d5ee8cfcfb39138e49709cd220ed31bbfe04b240beae71a6`   |
| ZIP            | `READY`, 2,715 bytes, SHA-256 `31c7efaca4263d92bd57829c88c01f040de604eae107351829ecd7ee09b0b17b`   |
| Offline report | CSP `default-src 'none'`, no script/external resource, both serials and successful targets visible |
| Cleanup        | Service/Appium/worker ports released; both devices remained online                                 |

## Evidence root

`E:\Temp\UnityMultiDeviceAcceptance\m10-current-dual-20260908`

The copied evidence contains the SQLite report state, HTML, ZIP, manifest,
worker resource record, and port lease record. Source and destination file
counts and byte totals matched during migration.

## Acceptance boundary

**PASS for current two-device M10 default report revalidation.** Optional
Excel/PDF/JUnit exports and portable delivery remain M11 capabilities. The
source/document changes were approved and pushed to `origin/main` in commit
`f3e22f9`.
