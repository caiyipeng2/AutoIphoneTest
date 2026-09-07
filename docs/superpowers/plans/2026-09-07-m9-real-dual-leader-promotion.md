# M9 Real Dual-Device Leader Promotion Verification Plan

**Goal:** Validate the approved console promotion control on two physical Android devices.

### Task 1: Run the physical promotion flow

- [x] Restore a shared ADB server on port 5038 and confirm Samsung/Motorola are online.
- [x] Start the isolated Appium-only server with the project Appium Home.
- [x] Create, preflight, start, pause, and promote the real two-device session.
- [x] Submit a post-promotion synchronized action and verify both target results.

### Task 2: Record and close the hardware gate

- [x] Finalize the run as `FINISHED` and verify no runtime ports/listeners remain.
- [x] Record the physical evidence and limitations in the M9 acceptance docs.
- [ ] Stop for user approval before commit and push.
