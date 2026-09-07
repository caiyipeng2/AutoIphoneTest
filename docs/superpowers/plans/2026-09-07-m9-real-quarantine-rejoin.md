# M9 Real Quarantine and Rejoin Verification Plan

**Goal:** Validate physical follower quarantine and console rejoin on two Android devices.

### Task 1: Execute physical recovery flow

- [x] Confirm two actual devices and v63 package availability.
- [x] Start Appium-only session with `QUARANTINE_FAILED_DEVICE`.
- [x] Inject a real Follower UiAutomator2 failure and verify quarantine evidence.
- [x] Pause, rejoin the quarantined Follower, and verify epoch/generation rebuild.
- [x] Submit and verify a synchronized post-rejoin action on both devices.

### Task 2: Record and close the hardware gate

- [x] Finish the run and verify worker/forward cleanup.
- [x] Move evidence to E: and record the acceptance boundary.
- [x] Stop for user approval before commit and push.
