# M11 Task 8: Latest v61 APKS Two-Device Acceptance

Date: 2026-08-26  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`  
APKS: `D:\飞书存储\AAB_Install\AAB_Install\idle_weaponshop_haiwai_v61_2026_08_25_21_13-release.apks`  
Runtime root: `E:\M11-Portable-Verify-20260821`

## Installation evidence

The same APKS was installed with bundletool `1.18.3` on both connected devices.
Both installs exited with code `0`.

| Serial        | Model      | Package version | Installed splits                | Result |
| ------------- | ---------- | --------------- | ------------------------------- | ------ |
| `R5CX211TXNT` | `SM-S9280` | `61` / `2.0.7`  | base, UnityDataAssetPack, arm64 | PASS   |
| `R5CWB17PN0Y` | `SM-A5460` | `61` / `2.0.7`  | base, UnityDataAssetPack, arm64 | PASS   |

ADB `pm path` and `dumpsys package` were checked after each install. The package
name is `com.hg.idleweaponshoptycoon.android`.

## Installed-package portable flow

Evidence JSON: `data/hardware-m11-portable-smoke-20260826-v61-install/m11-portable-smoke.json`  
Run: `run-57e54e53-a8c6-4211-8574-39fba040d757`

| Phase            | Result                                                |
| ---------------- | ----------------------------------------------------- |
| Device discovery | Both selected devices ONLINE                          |
| Session          | `CREATED -> PREFLIGHT -> RUNNING -> FINISHED`         |
| Tap              | Both target devices `SUCCEEDED`                       |
| Swipe            | Both target devices `SUCCEEDED`                       |
| Default reports  | HTML and ZIP `READY`; finalization `COMPLETED`        |
| Optional reports | Excel, PDF and JUnit `READY` and downloaded           |
| Cleanup          | Portable server and managed device resources released |

## Downloaded output hashes

| Format    |   Bytes | SHA-256                                                            |
| --------- | ------: | ------------------------------------------------------------------ |
| HTML      |   7,551 | `58563d07be9292bf98bede8db8bf70ea6397af8d833197285d6e113edf199b2d` |
| ZIP       |   2,711 | `d484a4ee6cc0c880a1be1857bc774d5f82368bbefdae8dfdd0ab3546c93a2ac6` |
| Excel     |  10,601 | `d20c793ce3ba0a174a4587415f0d6cbd7430ab2ca31f83a1809fcf1aa37aa9ab` |
| PDF       | 124,317 | `62b4386c9d1b4a22f38e6bebd21bde5c86ed4623d9caa0b2a840d16141363383` |
| JUnit XML |   1,851 | `eb2b710995e939570e1d390b954790b13d22462ac336ea46d61a2425243fd3aa` |

## Acceptance boundary

This slice proves the latest user-provided v61 APKS can be installed and exercised
on two real Android devices through the clean E-drive portable runtime. It does not
claim four-device capacity, QA Bridge handshake, Unity source-project builds, or the
user-deferred fault-injection/recovery acceptance.

The evidence document is local and uncommitted. Commit and push require explicit
user confirmation.
