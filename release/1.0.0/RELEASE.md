# Unity Multi-Device Test Center v1.0.0

## Release Identity

- Version: `1.0.0`
- Tag: `v1.0.0`
- Source commit used to build the portable artifact: `ee7da4e`
- Package under acceptance: `com.hg.idleweaponshoptycoon.android`
- Game display name: `Idle Weapon Shop Tycoon`
- Repository: `https://github.com/caiyipeng2/AutoIphoneTest`

## Included Product

The portable Windows package contains the Test Center launcher, Node 22.23.1,
server and console bundles, Appium 3.6.0, UiAutomator2 8.2.2, Java 17,
bundletool, scrcpy 3.1, Chromium, and the Android SDK platform-tools/build-tools
subset required for UiAutomator2.

The accepted workflow supports one to four selected Android devices and has
fresh two-device evidence for Samsung `R5CX211TXNT` and Motorola `ZT4229J5ZR`.

## Operating Modes

- Strict QA Bridge mode for focus/state/arm/acknowledgement checks.
- Explicit Appium-only mode for system-level synchronized actions without
  Unity QA Bridge injection.

## Installation

1. Extract `TestCenterLauncher.zip` to an E-drive directory.
2. Install Android USB/ADB drivers and enable Developer Options and USB
   debugging on every phone.
3. Accept each phone's RSA authorization prompt and confirm `adb devices`
   reports `device`.
4. Start `TestCenterLauncher.exe`, open the console, and verify the Devices
   page before creating a session.

## Verification Evidence

- M9 physical promotion and quarantine/rejoin: M9 Tasks 31 and 33.
- M10 current two-device HTML/ZIP report chain: M10 Task 7.
- M11 current portable two-device smoke and optional exports: M11 Task 18.
- M11 current two-device 60-minute stability: M11 Task 19.

See `CHECKSUMS.txt` for the artifact hashes and `VERIFICATION.md` for the
commands and result counts.

## Rollback

Keep the previous accepted tag/artifact available. Do not rewrite `v1.0.0`;
corrections must use `1.0.1` and a new tag.

## Limitations

- Formal physical stability evidence covers two devices; three- and four-device
  physical stability are separate work.
- Unity command builds remain opt-in and require project-specific signing and
  build configuration.
- Appium-only reports do not claim Unity QA UID capture.
- The package is a Windows portable product and is not published to npm.
