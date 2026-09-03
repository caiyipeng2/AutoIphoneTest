# M11 Task 16 - Current portable release acceptance

Date: 2026-09-03

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

## Release artifact

The release was built from the current `main` source after M11 Task 15. It
includes the Appium SDK-root pinning fix and the corrected stability analyzer.

| Check            | Result                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| ZIP              | `E:\Projects\UnityMultiDeviceTestCenter\dist\releases\m11-20260903-current\TestCenterLauncher.zip` |
| ZIP size         | 645,765,046 bytes                                                                                  |
| ZIP SHA-256      | `64FE1010057C3A3AD3716EAC4B9D0007CBCADF8A138BE26553D979957B9FFF34`                                 |
| Manifest files   | 41,311                                                                                             |
| Manifest SHA-256 | `3D8C91C27EF1F94F3D00D15CAE109A69E45F823488292DD6D848847543DE5F5E`                                 |
| Bundled Node     | `v22.23.1`                                                                                         |

## Clean extraction

The ZIP was extracted to the independent E-drive directory
`E:\Temp\UnityMultiDeviceAcceptance\m11-release-20260903-clean`. The complete
manifest walk passed for all 41,311 files, including bundled Node runtime
validation.

## Published-package dual-device smoke

The smoke used the generated `dist\portable-20260903` directory, which has the
same manifest as the release ZIP, and did not set `ANDROID_HOME` manually. The
runtime itself derived the SDK root from its bundled `adb.exe`.

| Check              | Result                                      |
| ------------------ | ------------------------------------------- |
| Session            | `run-ade32c9e-422d-4dbe-aa1d-d1b171eb2765`  |
| Devices            | `R5CX211TXNT` Leader, `ZT4229J5ZR` Follower |
| Duration / samples | 120 seconds / 11                            |
| Actions / analyzer | 0 errors / `PASS`                           |
| Runtime allocation | 2 workers, 2 leases, 4 forwards             |
| Max queue / WAL    | 0 / 2,805,752 bytes                         |
| Finalization       | `COMPLETED`, HTML and ZIP `READY`           |
| Cleanup            | worker 0, lease 0, forward 0                |

Evidence: `E:\Temp\UnityMultiDeviceAcceptance\m11-release-20260903-dual-smoke\m11-stability.json`

HTML SHA-256: `9a9e705834a58c0f0248175c95c512fe9a773b8deca43aa62d0ab2c64975ca19`

ZIP SHA-256: `275095dea4119039944105ee52af57ee8fa0bda26a9c724a4eddad056df59213`

After the run both physical devices remained online, `mStayOn=false` was
restored on each device, and no ADB forwards remained.

## Verification

- Current release manifest verification: PASS, 41,311 files
- Published-package dual-device smoke: PASS
- Source full suite before packaging: 618 passed, 2 skipped
- Source typecheck, lint, and Prettier: PASS

The release ZIP and generated E-drive directories are local build artifacts and
are intentionally not tracked in Git.
