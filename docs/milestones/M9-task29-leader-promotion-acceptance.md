# M9 Task 29 - Paused leader promotion acceptance

Date: 2026-09-07

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android`

## Scope

This slice adds explicit Leader promotion while a run is paused. An active
follower can become the new leader after all active members pass online and
preflight checks; the worker group is rebuilt with incremented generations and
the run advances to a new epoch without replaying actions.

## Implementation

- `POST /api/sessions/:id/devices/:serial/promote-leader` is protected by the
  existing host/origin, authentication, and CSRF checks.
- Only a `PAUSED` run and current-epoch active follower are eligible.
- All active members are checked online and through the configured preflight
  probe before worker startup.
- The new epoch swaps roles, records
  `OPERATOR_LEADER_PROMOTED:<serial>:<reason>`, and starts video on the new
  leader.
- Any preflight, worker, or transaction failure leaves the original paused
  epoch unchanged and cleans up newly started resources.

## Automated evidence

- Leader promotion runtime and route tests: **33/33 passed**
- Full Vitest suite: **159 test files passed, 1 skipped; 645 tests passed, 2 skipped**
- TypeScript typecheck: PASS
- ESLint: PASS
- Prettier on changed files: PASS
- CodeGraph: index up to date

## Hardware boundary

No physical promotion result is claimed in this slice. A real paused two-device
run is required to validate the new leader's video and action path after a
device fault.

The user approved this slice for commit and push to `main`.
