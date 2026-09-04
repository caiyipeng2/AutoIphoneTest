# M9 Task 26 - Action retry console acceptance

Date: 2026-09-04

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android`

## Scope

This slice brings persisted action history and explicit Retry into the Sessions
console. Failed and unknown actions are visible with their sequence, request
identity, state, and parent link; Retry creates a fresh child action through the
existing protected API.

## Implementation

- `RunActionRepository.list()` returns actions in stable `actionSeq` order.
- `GET /api/sessions/:id/actions` is authentication-protected and returns 404
  for an unknown session.
- Sessions loads action history after create, refresh, pause, and resume.
- Retry is shown only for `FAILED` or `UNKNOWN` actions while the session is
  `RUNNING`; loading and request errors use the existing alert region.
- Retry client IDs always carry a `retry-` prefix and the UI refreshes the list
  after the request, exposing the resulting `parentActionId`.
- The compact action table has stable rows, Lucide icons, and narrow-screen
  wrapping without changing the existing dashboard palette.

## Automated evidence

- Repository/API/runtime/console focused tests: **46/46 passed**
- Full Vitest suite: **158 test files passed, 1 skipped; 636 tests passed, 2 skipped**
- Console production build: PASS
- TypeScript typecheck: PASS
- ESLint: PASS
- Prettier on changed files: PASS
- CodeGraph: index up to date

## Acceptance boundary

Retry is explicit and never triggered by fault recovery or resume. Action Skip,
quarantined-device rejoin, and Leader promotion remain separate follow-up
slices. The user approved this slice for commit and push to `main`.
