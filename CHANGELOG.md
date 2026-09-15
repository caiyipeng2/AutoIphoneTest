# Changelog

## 1.0.0 - 2026-09-15

### Added

- Local Unity Android multi-device control plane for one Leader and one to
  three Followers.
- Appium-only synchronization path for games without QA Bridge injection.
- QA Bridge mode with explicit focus/state/arm/acknowledgement contracts.
- Device discovery, deployment identity, session lifecycle, action dispatch,
  incident timeline, and device-scoped result evidence.
- Explicit pause/resume, action retry/skip, quarantined-device rejoin, and
  paused-session Leader promotion controls.
- Offline HTML, verified evidence ZIP, Excel, PDF, and JUnit report outputs.
- Portable Windows packaging with a self-contained Android SDK subset,
  Appium/UiAutomator2, Node, Java, bundletool, scrcpy, and Chromium.

### Recovery and Safety

- Deterministic `PAUSE_ALL` and `QUARANTINE_FAILED_DEVICE` policies.
- No automatic action replay after faults.
- Atomic evidence publication, report finalization recovery, ZIP manifest
  verification, storage-pressure gates, recoverable cleanup, and audit records.
- Serial-bound Appium, ADB, port, worker, logcat, and video resource cleanup.

### Verification

- M9 two-device Leader promotion and physical quarantine/rejoin accepted.
- M10 current two-device HTML/ZIP report chain accepted.
- M11 current portable two-device smoke and optional exports accepted.
- M11 current portable two-device 60-minute stability accepted by the fixed
  analyzer with zero crashes, restarts, queue violations, or resource leaks.

### Known Limitations

- Formal physical stability evidence currently covers two devices; three- and
  four-device physical stability remains separate work.
- Unity command builds are opt-in and require project-specific signing/build
  configuration.
- Appium-only reports do not claim Unity QA UID capture.
