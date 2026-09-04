# M9 Task 27 - Explicit action skip acceptance

Date: 2026-09-04

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android`

## Scope

This slice adds explicit Action Skip for terminal `FAILED` or `UNKNOWN`
actions. Skip records an immutable operator decision while preserving the
original action state for forensic history; it never calls a device worker or
the action dispatcher.

## Implementation

- Migration `0022_action_skip_decisions` stores one linked decision per action
  and enforces per-run client request idempotency.
- `RunActionRepository.skip()` validates parent state, run state (`RUNNING` or
  `PAUSED`), bounded reason, and duplicate request payload.
- Action `resolution: SKIPPED` is included in list/get views, and a skipped
  parent cannot be retried.
- `POST /api/sessions/:id/actions/:actionId/skip` is protected by the existing
  host/origin, authentication, and CSRF checks.
- Sessions console shows Skip only for unresolved terminal actions, accepts it
  while running or paused, displays the audit reason, and removes further
  Retry/Skip controls after refresh.

## Automated evidence

- Migration/repository/API/runtime/console focused tests: **49/49 passed**
- Full Vitest suite: **159 test files passed, 1 skipped; 639 tests passed, 2 skipped**
- Console production build: PASS
- TypeScript typecheck: PASS
- ESLint: PASS
- Prettier on changed files: PASS
- CodeGraph: index up to date

## Acceptance boundary

Skip is an explicit operator decision and is never triggered by fault recovery,
resume, or Retry. The parent action remains `FAILED` or `UNKNOWN` and is marked
with a separate `SKIPPED` resolution. Device rejoin and Leader promotion remain
separate follow-up slices. The user approved this slice for commit and push to
`main`.
