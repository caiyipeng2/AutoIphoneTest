# M6 Task 4 Primary Video Provider Acceptance

Date: 2026-08-10
Scope: scrcpy 3.1 H.264 packet parsing, serial-bound Tango ViewProvider, ADB tunnel transport, and authenticated gateway metadata.

## Implemented

- `ScrcpyVideoParser` accepts arbitrary read boundaries, validates the H.264 codec and dimensions, parses the 12-byte v3.1 packet header, preserves config/key flags and presentation timestamps, bounds payload size, and detects truncated streams.
- `TangoScrcpyViewProvider` publishes bounded, serial-owned `EncodedFrame` records with `provider="tango"`, `degraded=false`, frame IDs, metrics epoch, and H.264 packet metadata.
- `AdbScrcpyVideoTransport` pushes the pinned server, binds one serial/scid through `adb forward`, disables audio/control/device metadata, and owns socket/process/forward cleanup.
- The existing authenticated video gateway now forwards optional H.264 key/config/timestamp metadata without changing the degraded screenshot contract.
- `scripts/accept-m6-task4-primary-video.mjs` records real-device first-frame evidence.

## Automated verification

- H.264 parser tests: `3` passing.
- Tango ViewProvider tests: `2` passing.
- ADB transport argument test: `1` passing.
- Existing gateway regression: passing.
- TypeScript project build: passing.

## Real-device attempt

Evidence: `E:\Projects\UnityMultiDeviceTestCenter\data\runs\m6-task4-primary-video-1786350911819\acceptance.json`

- The acceptance script reached cleanup correctly, but the ADB server currently reports no attached device, so no first frame was received.
- This is an environment availability failure, not a provider/parser assertion failure. The same script can be rerun when `R5CX211TXNT` is visible in `adb devices`.

## Limitations

The provider now emits encoded H.264 packets, but browser WebCodecs canvas decoding and UI presentation remain in the following console/session slice. The current real-device evidence is blocked by temporary device disconnection.
