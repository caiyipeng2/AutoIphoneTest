# M9 Task 28 - Quarantined follower rejoin acceptance

Date: 2026-09-07

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android`

## Scope

This slice adds an explicit paused-run rejoin command for a quarantined
follower. Rejoin verifies the device is online and passes the existing preflight
probe, rebuilds the full active worker group with incremented generations, and
advances the run epoch without replaying actions.

## Implementation

- `POST /api/sessions/:id/devices/:serial/rejoin` is protected by host/origin,
  authentication, and CSRF checks.
- Only a current-epoch `QUARANTINED` follower can rejoin; leaders, active
  members, and non-paused runs are rejected.
- The registry and preflight probe run before worker allocation.
- Worker start receives a generation map with every active member and the
  rejoined follower incremented by one.
- The database transition inserts a new active epoch and records
  `OPERATOR_REJOINED:<serial>:<reason>` only after worker startup succeeds.
- Preflight, worker, video, or transaction failure leaves the run paused and
  stops newly created resources.

## Automated evidence

- Rejoin runtime and route tests: **30/30 passed**
- Full Vitest suite: **159 test files passed, 1 skipped; 642 tests passed, 2 skipped**
- Console production build: PASS
- TypeScript typecheck: PASS
- ESLint: PASS
- Prettier on changed files: PASS
- CodeGraph: index up to date

## Hardware boundary

No physical rejoin result is claimed in this slice. The earlier Motorola
device was unavailable after fault injection; real rejoin requires a returned
ADB device and a fresh two-device acceptance run.

The user approved this slice for commit and push to `main`.
