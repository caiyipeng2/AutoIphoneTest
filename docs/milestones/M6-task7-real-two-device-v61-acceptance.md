# M6 Task 7: Real Two-Device v61 Synchronization Acceptance

## Scope

This is a fresh hardware acceptance of the M6 multi-device session and action
path using the Idle Weapon Shop Tycoon Android package. The run uses the
existing Appium-only action path; it does not require QA Bridge injection.

## Preconditions

- Package: `com.hg.idleweaponshoptycoon.android` (display name `Idle Weapon Shop Tycoon`).
- Package build checked before the run: version name `2.0.7`, version code `61`.
- Devices: `R5CX211TXNT` (`SM-S9280`) and `R5CWB17PN0Y` (`SM-A5460`).
- Both devices reported `device` through ADB and viewport `1080x2340` during the run.
- Appium: `http://127.0.0.1:4723`, with UiAutomator2 system ports `8201` and `8202`
  and MJPEG ports `7811` and `7812`.

## Execution

The acceptance command was run with:

```powershell
$env:TEST_CENTER_ADB_PATH = "E:\Projects\UnityMultiDeviceTestCenter\tools\scrcpy\3.1\adb.exe"
$env:ANDROID_SERIALS = "R5CX211TXNT,R5CWB17PN0Y"
$env:TEST_CENTER_PACKAGE = "com.hg.idleweaponshoptycoon.android"
$env:TEST_CENTER_APPIUM_URL = "http://127.0.0.1:4723"
$env:TEST_CENTER_APPIUM_SYSTEM_PORT = "8201"
$env:TEST_CENTER_APPIUM_MJPEG_PORT = "7811"
node scripts/accept-m6-session-action.mjs
```

The acceptance script migration list was corrected before this run to include
`0010_action_commands`, `0012_run_membership_transitions`, and
`0013_run_failure_policy`, matching the runtime service schema.

## Evidence

- Raw evidence: `data/runs/m6-session-action-1787711522175/acceptance.json`.
- Run: `m6-session-action-1787711522175`.
- Session: `run-66047905-dd49-4c88-8072-0cdf6a677f64`.
- Roles: leader `R5CX211TXNT`, follower `R5CWB17PN0Y`; both membership states `ACTIVE`.
- Session states: `CREATED` -> `PREFLIGHT` -> `RUNNING`.
- Action: `act-4249272f-cdd7-4593-b9d1-d65b13bb3b55` (center tap).
- Both target result rows: `SUCCEEDED`; each Appium result reported the expected
  foreground package and `pointerActionCount: 3`.
- Aggregate action: `SUCCEEDED`.
- Outbox: `ACKED`, attempt count `1`.
- Overall script result: `passed: true`, exit code `0`.

## Cleanup and boundary

The temporary Appium process was stopped after the run and ports `4723`,
`8201`, `8202`, `7811`, and `7812` were verified without listeners. A post-run
ADB check enumerated `R5CWB17PN0Y` but not `R5CX211TXNT`; `adb reconnect device`
did not restore the second transport. This does not invalidate the recorded
action result, but a follow-up cable/USB transport check is required before
another hardware run.

This slice proves one synchronized tap on two real devices. It does not yet
cover the 1-4 device capacity matrix, long-running soak, failure recovery, or
QA Bridge-specific actions.

## Approval gate

The script change and this evidence document are verified locally. They remain
uncommitted until explicit approval for this slice.
