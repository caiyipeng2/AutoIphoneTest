# M9 Task 20: Real Two-Device v61 Action Matrix

Date: 2026-08-26  
Repository: `E:\Projects\UnityMultiDeviceTestCenter`  
Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `61`, versionName `2.0.7`)  
Execution mode: Appium-only managed action scripts; no QA Bridge injection
ADB service: shared `D:\ADB\platform-tools\adb.exe` server on port `5038`

## Devices

| ADB serial    | Model      | Viewport    | Result |
| ------------- | ---------- | ----------- | ------ |
| `R5CX211TXNT` | `SM-S9280` | `1080x2340` | PASS   |
| `R5CWB17PN0Y` | `SM-A5460` | `1080x2340` | PASS   |

Both devices reported `device` in the project ADB snapshot before and after the matrix.
The Appium log also records `adbPort:5038`, `suppressKillServer:true`, and `adb.exe -P 5038`
for session creation, activation, pointer actions, and cleanup.

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

Before the successful rerun, the first matrix reached 6/10 action cases and reported
missing game PIDs for terminate/restart. The root cause was the hardware scripts'
`AdbClient` querying the default 5037 server while Appium was using the user-connected
5038 server. The scripts now pass the same ADB endpoint to process checks. Appium's
`adbPort` and `suppressKillServer` capabilities also prevent different adb binaries from
replacing the shared server. The corrected second matrix passed 10/10.

The user-approved fault-injection acceptance remains skipped. This matrix covers only
the normal action path and does not claim M8 four-device capacity acceptance.

## Reproduction command

```powershell
$env:TEST_CENTER_PROJECT_ROOT='E:\Projects\UnityMultiDeviceTestCenter'
$env:TEST_CENTER_M9_SERIALS='R5CX211TXNT,R5CWB17PN0Y'
$env:TEST_CENTER_PACKAGE='com.hg.idleweaponshoptycoon.android'
$env:TEST_CENTER_ADB_PATH='D:\ADB\platform-tools\adb.exe'
$env:TEST_CENTER_APPIUM_ADB_PORT='5038'
$env:TEST_CENTER_ADB_SERVER_PORT='5038'
$env:TEST_CENTER_APPIUM_HOME='E:\Projects\UnityMultiDeviceTestCenter\data\appium-home'
& 'E:\Projects\UnityMultiDeviceTestCenter\tools\node\22.23.1\node.exe' --import tsx tests\hardware\m9-action-matrix.ts
```

The run used Appium ports `4723-4727`, UiAutomator2 system ports `8200-8204`, and
MJPEG ports `7810-7814`; no Appium listeners or session forwards remained after
completion, and both devices remained online on ADB port `5038`.

## Implementation scope

- `@test-center/appium` now validates and serializes optional `appium:adbPort` and
  `appium:suppressKillServer` capabilities.
- Session preflight, action executor, and managed device worker accept and propagate the
  shared ADB port.
- The server reads `TEST_CENTER_APPIUM_ADB_PORT` (or
  `TEST_CENTER_ADB_SERVER_PORT`) and enables shared-server protection when configured.
- All five M9 hardware scripts use the same endpoint for Appium and direct ADB process
  checks.

## Local approval boundary

This evidence document is local and uncommitted. It is ready for user review; commit
and push to `origin/main` require explicit confirmation.
