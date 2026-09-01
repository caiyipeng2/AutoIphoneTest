# M9 Task 21: Real Two-Device v63 Action Matrix

Date: 2026-09-01

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android` (versionCode `63`, versionName `2.0.9`)

Execution mode: Appium-only managed actions; no Unity QA Bridge injection

ADB service: shared `D:\ADB\platform-tools\adb.exe` server on port `5038`

## Devices

| ADB serial    | Model         | Viewport    | Role     | Result |
| ------------- | ------------- | ----------- | -------- | ------ |
| `R5CX211TXNT` | `SM-S9280`    | `1080x2340` | LEADER   | PASS   |
| `ZT4229J5ZR`  | `moto g 2025` | `720x1604`  | FOLLOWER | PASS   |

Both devices reported `device` before and after the matrix. Motorola was installed
with the official Motorola 64-bit USB driver before this run; its Windows interface
was changed from generic `WinUsb Device` to `Motorola ADB Interface`.

## Action matrix

The matrix ran `tests/hardware/m9-action-matrix.ts` sequentially for each device.
Every action creates an isolated UiAutomator2 session and releases its Appium,
system, MJPEG, logcat, and ADB resources in `finally` cleanup.

| Action            | `R5CX211TXNT` | `ZT4229J5ZR` | Postcondition                     |
| ----------------- | ------------- | ------------ | --------------------------------- |
| activate          | PASS          | PASS         | Target package reaches foreground |
| Back              | PASS          | PASS         | Android keycode `4` accepted      |
| long press + drag | PASS          | PASS         | W3C pointer actions accepted      |
| terminate         | PASS          | PASS         | Game process disappears           |
| restart           | PASS          | PASS         | New process reaches foreground    |

Aggregate result: **PASS, 10/10 action/device cases**.

The long press/drag script reads each device's `wm size` through the same ADB
server endpoint as Appium, so normalized coordinates are converted using the
actual device viewport rather than a fixed `1080x2340` assumption.

## Evidence

- Matrix log: `E:\Temp\UnityMultiDeviceAcceptance\m9-action-matrix-dual-v63-20260901-final.log`
- Formal package dual sync/report evidence:
  `E:\Temp\UnityMultiDeviceAcceptance\m11-portable-dual-20260901-r2\m11-portable-smoke.json`
- Dual sync session: `run-cd9b4f83-ac00-4bfd-aa5f-85ffc53ad97e`
- Sync actions: tap and swipe both `SUCCEEDED` on both devices.
- Reports: HTML, ZIP, Excel, PDF, and JUnit all `READY`.

## Boundary

This is a two-device v63 acceptance. It does not claim three- or four-device
capacity or the four-device soak. Fault injection and active-session recovery
remain skipped under the existing user confirmation.

Local source changes and this acceptance record are submitted only after local
verification; no Unity game source repository files are committed here.
