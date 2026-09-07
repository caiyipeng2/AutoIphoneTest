# M9 Task 32 - Device rejoin console acceptance

Date: 2026-09-07

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android`

## Scope

This slice exposes the existing paused-run quarantined-follower rejoin
contract in the Sessions console. It does not claim physical quarantine and
rejoin; that remains a separate hardware gate.

## Console behavior

- The device-group panel renders `重新加入` only for a `QUARANTINED`
  `FOLLOWER` while the session is `PAUSED`.
- Clicking the control sends
  `POST /api/sessions/:id/devices/:serial/rejoin` with the operator reason and
  encoded serial.
- The selected control shows `加入中`; session controls remain disabled until
  the mutation and action refresh finish.
- A successful response replaces the session snapshot, so the member becomes
  `ACTIVE` and the session returns to `运行中`.
- API failures use the existing console error region and do not claim a
  membership change.

## Automated evidence

- Sessions page focused test: **7/7 passed**
- Full Vitest suite: **159 test files passed, 1 skipped; 647 tests passed, 2 skipped**
- TypeScript typecheck: **PASS**
- ESLint: **PASS**
- Console production build: **PASS**
- Prettier check on changed source and docs: **PASS**
- `git diff --check`: **PASS**
- CodeGraph sync/status: **index synchronized**

## Hardware boundary and approval state

No physical quarantine/rejoin result is claimed in this slice. The next
hardware slice should cause a real follower to enter `QUARANTINED`, verify it
is back online, use this console control to rebuild the active group, and
submit a post-rejoin synchronized action.

The implementation and evidence were approved and pushed to `origin/main` in
commit `d81e07e`.
