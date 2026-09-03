# M9 Task 24 - Explicit action retry acceptance

Date: 2026-09-03

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

Package under test: `com.hg.idleweaponshoptycoon.android`

## Scope

This slice adds an authenticated, CSRF-protected retry command for terminal
`FAILED` or `UNKNOWN` actions. A retry creates a new action identity and action
sequence, copies the immutable command, records `parentActionId`, and can be
dispatched through the existing action dispatcher. Fault monitors and resume
recovery never call this command automatically.

## Implementation

- Migration `0021_action_retries` adds nullable `actions.parent_action_id` and
  an index for parent lookup.
- `RunActionRepository.retry()` rejects missing, non-terminal, or unavailable
  parents and preserves the parent action unchanged.
- `RuntimeSessionRouteService.retryAction()` verifies the action belongs to the
  requested run, creates the child, and dispatches only the child.
- `POST /api/sessions/:id/actions/:actionId/retry` reuses host/origin, CSRF,
  authentication, and bounded client request validation.
- Console state API exposes `retrySessionAction()` with a typed action response.

## Automated evidence

Command:

`npm test -- packages/database/src/action-retry-migration.test.ts packages/sessions/src/run-repository.test.ts apps/server/src/routes/sessions.test.ts apps/server/src/session-runtime.test.ts`

Result: **41/41 tests passed**.

Additional checks:

- `npm run typecheck`: PASS
- `npm run lint -- --quiet`: PASS
- Prettier check on changed files: PASS
- Full suite: 158 test files passed, 1 skipped; 633 tests passed, 2 skipped.

## Acceptance boundary

Only an explicit operator request creates a retry child. There is no automatic
replay after a fault, pause, resume, or worker rebuild. Action skip, quarantined
device rejoin, and leader promotion remain separate follow-up commands.

The user approved this slice for commit and push to `main`.
