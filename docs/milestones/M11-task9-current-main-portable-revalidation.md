# M11 Task 9 - Current-main portable revalidation

Date: 2026-08-26  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`  
Clean runtime root: `E:\M11-Portable-Verify-20260826-v61`  
Package: `com.hg.idleweaponshoptycoon.android` (`Idle Weapon Shop Tycoon`)

## Scope

This slice revalidates the M11 portable flow from the current `main` commit after
the shared ADB-port change. It also fixes two Windows-only acceptance blockers:

- `scripts/build-portable.ps1` now reads junction metadata defensively under
  Windows PowerShell 5.1 and falls back from `ResolvedTarget` to `LinkTarget` or
  `Target`.
- `tests/hardware/m11-portable-smoke.ts` asks the operating system for a free
  loopback port instead of selecting a potentially reserved random port.

## Build and portable verification

| Check             | Result                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Build command     | `build-portable.ps1 -SkipProvisioning -SkipZip`                                          |
| Runtime root      | `E:\M11-Portable-Verify-20260826-v61`                                                    |
| Manifest          | 41,303 files; SHA-256 `C75164E904544A5761E7432FA32FEC1BE6C85AC98D1C7AFD8ECE0166E991DBAD` |
| Portable verifier | PASS; all manifest hashes and Node `v22.23.1` verified                                   |
| Console/launcher  | Console Vite build and .NET launcher publish passed                                      |

The first rebuild exposed the PowerShell 5.1 junction-property failure. After
the compatibility fix, the same build completed successfully. The first smoke
attempt then selected reserved port `5040` and failed with `EACCES`; the
OS-assigned-port fix produced the passing run below. No new release ZIP was
created in this slice (`-SkipZip`); the existing release archive was left intact.

## Real two-device flow

Evidence JSON: `data/hardware-m11-portable-smoke-20260826-v61-current2/m11-portable-smoke.json`  
Evidence SHA-256: `F00A0AB9EB95C78E7C963D97340B398639A3E25B2134864B052E1AC081A6AAE9`  
Run: `run-6b5d7205-d520-4ec3-867f-32fbc93375ff`

| Phase            | Result                                                                             |
| ---------------- | ---------------------------------------------------------------------------------- |
| Device discovery | `R5CX211TXNT` (`SM-S9280`) and `R5CWB17PN0Y` (`SM-A5460`) both `ONLINE`            |
| Package          | Installed package verified by portable ADB                                         |
| Session          | `CREATED -> PREFLIGHT -> RUNNING -> FINISHED`                                      |
| Tap              | Both target devices `SUCCEEDED`                                                    |
| Swipe            | Both target devices `SUCCEEDED`                                                    |
| Finalization     | `COMPLETED`; HTML and ZIP `READY`                                                  |
| Optional exports | Excel, PDF, and JUnit all `READY` and downloaded                                   |
| Cleanup          | Portable server and worker/Appium resources released; both devices remained online |

## Downloaded output hashes

| Format    |   Bytes | SHA-256                                                            |
| --------- | ------: | ------------------------------------------------------------------ |
| HTML      |   7,551 | `5754edcf9644070165a8f5abd3b93c30ffeb19ac9e32013458b037d19128661f` |
| ZIP       |   2,713 | `e0e08d9d50b6cb74dd2f99d6c331420e094d1d1a8cbf47f5d57683e30924b81a` |
| Excel     |  10,604 | `b03220a1cfd1e9409b5202bd29117691d78f2f8a69426de9355201ab0242068a` |
| PDF       | 124,095 | `7183f55cea1e22758b85fe2486d30c4d036721dd950b1e9389a251b2b62e5c76` |
| JUnit XML |   1,851 | `788b1c9541819738c5af652310a39706c2fbbcf513759a15843685c533c2afa2` |

HTML contains an inline stylesheet and restrictive `default-src 'none'` CSP;
the ZIP manifest binds the HTML entry size and SHA-256. The Excel file starts
with the ZIP signature `50 4B 03 04`, and JUnit reports four action/device test
cases with zero failures or errors.

## Verification

| Check                                | Result                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `scripts/verify-portable.ps1`        | PASS, 41,303 manifest files                                                       |
| HTML/ZIP/JUnit/Excel inspection      | PASS                                                                              |
| M11 smoke script Prettier and ESLint | PASS                                                                              |
| Full Vitest suite                    | PASS, 146 files / 589 tests; 1 file and 2 tests skipped by existing configuration |
| `npm run typecheck`                  | PASS                                                                              |

## Acceptance boundary

This slice proves the latest source-built portable directory and two-device
real-package flow. It does not claim four-device capacity, Unity source-project
builds, QA Bridge UID handshake, or the user-deferred fault-injection/recovery
acceptance. The generated directory and local evidence remain ignored build
artifacts; only this acceptance record and the two script fixes are tracked.

The changes are local and uncommitted pending explicit user confirmation.
