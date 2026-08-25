# M11 Task 6 Real Android Package Acceptance

Date: 2026-08-25  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`  
Package: `com.hg.idleweaponshoptycoon.android`  
Display name: `Idle Weapon Shop Tycoon`  
Device: `R5CX211TXNT` (`SM-S9280`)

## Package source and installation

| Item                      | Result                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| AAB                       | `D:\飞书存储\AAB_Install\AAB_Install\idle_weaponshop_haiwai_v61_2026_08_25_17_14-release.aab`  |
| APKS                      | `D:\飞书存储\AAB_Install\AAB_Install\idle_weaponshop_haiwai_v61_2026_08_25_17_14-release.apks` |
| Manifest package          | `com.hg.idleweaponshoptycoon.android`                                                          |
| versionCode / versionName | `61` / `2.0.7`                                                                                 |
| Bundletool                | `1.15.4`                                                                                       |
| Installation              | PASS, bundletool install-apks against the only online ADB device                               |
| Installed split set       | `base.apk`, `split_UnityDataAssetPack.apk`, `split_config.arm64_v8a.apk`                       |
| Launcher                  | `com.unity3d.player.UnityPlayerActivity`                                                       |

## Runtime acceptance

The package was force-stopped and cold-started with ADB. Android reported `Status: ok`, `LaunchState: COLD`, and the focused activity was the expected Unity player activity.

| Check                                        | Result                                                        | Evidence                                                      |
| -------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Appium UiAutomator2 preflight                | PASS                                                          | `data\runs\m6-appium-preflight-1787651160828\acceptance.json` |
| Normalized tap at `(0.5, 0.5)`               | PASS, foreground package matched, 3 pointer actions           | `data\runs\m6-appium-action-1787651187812\acceptance.json`    |
| Normalized swipe `(0.5, 0.4) -> (0.5, 0.45)` | PASS, foreground package matched, 4 pointer actions           | `data\runs\m6-appium-action-1787651197871\acceptance.json`    |
| Device viewport                              | `1080x2340`                                                   | Recorded by both action manifests                             |
| Cleanup                                      | PASS, Appium `4723`, system `8201`, and MJPEG `7811` released | Post-run port check                                           |

## Boundary

This is a one-device package and action smoke acceptance. It does not claim two-device synchronization, Unity QA Bridge handshake, fault-policy recovery, or a Unity source-project build. Those require the corresponding devices, package instrumentation, or Unity project inputs.

## Decision

**PASS for single-device installation, launch, Appium preflight, tap, and swipe on versionCode 61.**
