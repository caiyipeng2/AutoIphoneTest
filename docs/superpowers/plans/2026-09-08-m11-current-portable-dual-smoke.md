# M11 Current Portable Dual-Device Smoke Plan

**Goal:** Rebuild and revalidate the current portable runtime with two physical Android devices.

### Task 1: Fix portable Android runtime dependency

- [x] Add the Android SDK `platform-tools` and latest `build-tools` subset to the portable package.
- [x] Make the WinForms Launcher inject portable ADB/SDK/data paths when the bundled SDK exists.
- [x] Make M11 smoke/stability runners use the bundled SDK ADB.
- [x] Add portable layout/build-script regression assertions.

### Task 2: Rebuild and verify

- [x] Rebuild current main portable directory and release ZIP.
- [x] Verify manifest file hashes and required SDK files.
- [x] Run two-device Appium-only smoke with Tap/Swipe and optional exports.
- [x] Independently validate HTML/PDF/JUnit/Excel output formats and cleanup.

### Task 3: Approval boundary

- [x] Stop for user approval before commit and push.
