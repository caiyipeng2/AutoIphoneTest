# M6 Task 3 Primary scrcpy Process Acceptance

Date: 2026-08-10
Scope: fixed scrcpy 3.1 provisioning and serial-bound, headless primary-process supervision for the Android game test path.

## Implemented

- `tools/tool-manifest.json` records the official scrcpy 3.1 archive, executable, server executable, SHA-256, and version check.
- `scripts/provision-scrcpy.ps1` verifies the archive hash, checks both `scrcpy.exe` and `scrcpy-server`, accepts the official multiline version banner, publishes atomically, and is idempotent.
- `ScrcpyPrimaryProcess` validates the Android serial, launches only the fixed executable with read-only, no-window, no-audio, no-clipboard, H.264 arguments, and owns process shutdown.
- Because scrcpy `--no-window` disables local video playback, the current process slice supplies an explicit MKV recording sink. The future raw H.264 decoder can replace this sink without changing serial/process ownership.

## Real-device acceptance

Evidence: `E:\Projects\UnityMultiDeviceTestCenter\data\runs\scrcpy-primary-1786348392274\acceptance.json`

- Device: `R5CX211TXNT`, physical Android device.
- Executable: `E:\Projects\UnityMultiDeviceTestCenter\tools\scrcpy\3.1\scrcpy.exe`.
- Spawn: successful; the process remained alive through the 8-second warm-up window.
- Video sink: MKV file created at `screen.mkv`, `2,883,584` bytes.
- Termination: the owned process ended with `SIGTERM`; no lingering process remained.
- Server transfer: `scrcpy-server` was pushed to the device successfully.

## Automated verification

- Provisioning fixture test: passed, including hash rejection, atomic publish, and idempotent rerun.
- Primary-process unit tests: `2` passing, covering serial-bound arguments, lifecycle, and startup failure.
- TypeScript project build: passed.

## Limitations

This slice proves fixed-version installation and the real-device process boundary, not raw H.264 frame decoding or browser presentation. The MKV sink is an interim video endpoint; the primary ViewProvider remains a follow-up slice.
