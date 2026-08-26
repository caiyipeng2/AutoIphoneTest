# M9 Task 20: Real Two-Device v61 Action Matrix

Date: 2026-08-26  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`  
Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `61`, versionName `2.0.7`)  
Execution mode: Appium-only managed action scripts; no QA Bridge injection

## Devices

| ADB serial    | Model      | Viewport    | Result |
| ------------- | ---------- | ----------- | ------ |
| `R5CX211TXNT` | `SM-S9280` | `1080x2340` | PASS   |
| `R5CWB17PN0Y` | `SM-A5460` | `1080x2340` | PASS   |

Both devices reported `device` in the project ADB snapshot before and after the matrix.

## Action matrix

The matrix ran `tests/hardware/m9-action-matrix.ts` sequentially for each device. Every
action creates an isolated UiAutomator2 session, verifies its postcondition, and cleans
up the Appium process and device-side forwards.

| Action            | `R5CX211TXNT` | `R5CWB17PN0Y` | Postcondition                                       |
| ----------------- | ------------- | ------------- | --------------------------------------------------- |
| activate          | PASS          | PASS          | Target package reaches foreground                   |
| Back              | PASS          | PASS          | Android keycode `4` accepted; package remains valid |
| long press + drag | PASS          | PASS          | W3C pointer actions accepted (`4` and `5` actions)  |
| terminate         | PASS          | PASS          | `pidof` confirms the game process disappears        |
| restart           | PASS          | PASS          | PID changes and target package reaches foreground   |

Aggregate result: **PASS, 10/10 action/device cases**.

## Repeatability note

The first full-matrix attempt had one transient failure while creating the
`terminate` session for `R5CX211TXNT`: Appium reported that the device was not in its
connected-device list. The same action passed when run alone immediately afterward,
and the complete action sequence for that device passed. A second complete two-device
matrix then passed 10/10 without code changes. This is recorded as an environment
connection/readiness fluctuation, not an accepted action failure.

The user-approved fault-injection acceptance remains skipped. This matrix covers only
the normal action path and does not claim M8 four-device capacity acceptance.

## Reproduction command

```powershell
$env:TEST_CENTER_PROJECT_ROOT='E:\Projects\UnityMultiDeviceTestCenter'
$env:TEST_CENTER_M9_SERIALS='R5CX211TXNT,R5CWB17PN0Y'
$env:TEST_CENTER_PACKAGE='com.hg.idleweaponshoptycoon.android'
$env:TEST_CENTER_ADB_PATH='E:\Projects\UnityMultiDeviceTestCenter\tools\scrcpy\3.1\adb.exe'
$env:TEST_CENTER_APPIUM_HOME='E:\Projects\UnityMultiDeviceTestCenter\data\appium-home'
& 'E:\Projects\UnityMultiDeviceTestCenter\tools\node\22.23.1\node.exe' --import tsx tests\hardware\m9-action-matrix.ts
```

The run used Appium ports `4723-4727`, UiAutomator2 system ports `8200-8204`, and
MJPEG ports `7810-7814`; no listeners remained after completion.

## Local approval boundary

This evidence document is local and uncommitted. It is ready for user review; commit
and push to `origin/main` require explicit confirmation.
