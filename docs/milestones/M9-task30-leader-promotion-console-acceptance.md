# M9 Task 30 - Leader promotion console acceptance

Date: 2026-09-07

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android`

## Scope

This slice exposes the paused-session Leader promotion contract in the
Sessions console. It does not claim physical two-device promotion; that gate
remains the next validation slice after this local implementation is approved.

## Console behavior

- The device-group panel renders `晋升 Leader` only for an `ACTIVE` follower
  while the session is `PAUSED`.
- The button includes a Crown icon and text, so the role action is not conveyed
  by color alone.
- Clicking the button sends
  `POST /api/sessions/:id/devices/:serial/promote-leader` with the operator
  reason and the encoded device serial.
- The selected control shows `晋升中`; the session controls remain disabled
  until the mutation and action refresh finish.
- A successful response replaces the session snapshot, so the promoted device
  is rendered as `Leader` and the session returns to `运行中`.
- API failures are surfaced through the existing console error region and do
  not claim a role change.

## Automated evidence

- Sessions page focused test: **6/6 passed**
- Full Vitest suite: **159 test files passed, 1 skipped; 646 tests passed, 2 skipped**
- TypeScript typecheck: **PASS**
- ESLint: **PASS**
- Console production build: **PASS**
- Prettier check on changed source files: **PASS**
- CodeGraph sync/status: **index up to date**
- `git diff --check`: **PASS**

## Hardware boundary and approval state

No physical two-device promotion result is claimed here. The next slice will
pause a real two-device session, promote the active follower from this
console, and verify the new leader's video and action path.

The implementation and evidence are complete locally and are awaiting user
approval before commit and push to `origin/main`.
