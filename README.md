# Unity Multi-Device Test Center

Unity Multi-Device Test Center is a local Windows control plane for testing a
self-developed Unity Android game on one to four connected devices. The
operator selects a Leader and Followers, sends an action from the console, and
the runtime dispatches the same normalized action to every active member while
recording device-level results and evidence.

The current product release is `v1.0.0` for the accepted two-device workflow.
The package under the current acceptance records is **Idle Weapon Shop Tycoon**
(`com.hg.idleweaponshoptycoon.android`, versionCode `63`).

## Capabilities

- Device discovery with serial-bound identity and UID-ready report fields.
- One Leader plus one to three Followers, with a dynamic 1-4 device selector.
- Appium-only synchronization for packages without a Unity QA Bridge.
- Optional QA Bridge mode for focus, state, arm, and acknowledgement checks.
- Tap, swipe, long press, drag, text, Back, activate, terminate, and restart.
- Pause/resume, explicit action retry/skip, quarantined Follower rejoin, and
  paused-session Leader promotion.
- Typed incidents, deterministic `PAUSE_ALL` or
  `QUARANTINE_FAILED_DEVICE` recovery, and no automatic action replay.
- Offline HTML and verified ZIP reports plus optional Excel, PDF, and JUnit
  exports.
- Portable Windows delivery with bundled Node, Java, Appium, UiAutomator2,
  Android SDK platform-tools/build-tools, scrcpy, and Chromium.

## Runtime Modes

`TEST_CENTER_BRIDGE_MODE=required` is the strict default and expects the Unity
QA Bridge package. `TEST_CENTER_BRIDGE_MODE=optional` selects Appium-only mode;
it does not inject QA Bridge messages and synchronizes system-level touch
actions instead.

## Local Development

Requirements:

- Windows with Node `22.23.1` and npm workspaces.
- Android SDK platform-tools and USB debugging enabled on each phone.
- ADB-authorized devices shown as `device`, not `unauthorized` or `offline`.

Useful checks:

```powershell
npm test
npm run typecheck
npm run lint -- --quiet
npm run build --workspace @test-center/console
```

The production-like user flow is the portable build under `dist/` or an
E-drive clean extraction. The E-drive portable release and its verification
records are kept outside Git because the archive is large.

## Operator Flow

1. Connect and authorize one to four Android devices.
2. Open the Devices page and verify model, serial, online state, and package.
3. Open Sessions, select the device group, choose the Leader, and select the
   bridge mode and failure policy.
4. Run preflight, start the session, and operate the Leader viewport.
5. Review synchronized action results and the incident timeline.
6. Pause when needed; resume, retry, skip, rejoin, or promote a Leader only
   through explicit operator controls.
7. Finish the session and open Results to download HTML, ZIP, or optional
   Excel/PDF/JUnit output.

## Acceptance Records

- [M9 acceptance](docs/milestones/M9-acceptance.md)
- [M10 acceptance](docs/milestones/M10-acceptance.md)
- [M11 acceptance](docs/milestones/M11-acceptance.md)
- [v1.0.0 release design](docs/superpowers/specs/2026-09-15-v1-release-design.md)
- [v1.0.0 release checklist](release/1.0.0/RELEASE.md)

## Scope and Limitations

The current formal hardware evidence covers two Android devices. The UI and
runtime contracts support one to four devices, but three- and four-device
physical stability are separate acceptance work. The Unity command build
provider remains opt-in and requires an explicit Unity path, arguments builder,
and signing configuration. This repository is not published as an npm package;
the portable Windows archive is the product delivery.
