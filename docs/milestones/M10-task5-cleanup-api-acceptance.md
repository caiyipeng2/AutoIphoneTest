# M10-T5 Cleanup API Acceptance

## Scope

This slice exposes the verified cleanup execution service through protected server routes. The client can request a one-time confirmation, execute a confirmed cleanup, and read its append-only audit events.

## Delivered

- Added `POST /api/cleanup/confirmations` for server-issued nonce creation bound to sorted Run IDs and expected bytes.
- Added `POST /api/cleanup/execute` for confirmed cleanup execution; runtime roots remain server-owned (`data/runs` and `data/trash`).
- Added `GET /api/cleanup/:cleanupId/events` for authenticated audit timeline reads.
- Reused bootstrap session, same-origin, host, and CSRF protections for mutations.
- Added strict safe-segment validation, including rejection of `.` and `..` and malformed URL-encoded identifiers.
- Wired the runtime registry to the database-backed confirmation, audit repository, execution service, and trash mover.
- Registered `@test-center/evidence` as a server workspace dependency and TypeScript project reference.

## Verification

- Cleanup API focused tests: 2/2 passed.
- Full Vitest suite: 125 test files, 500 tests passed.
- TypeScript typecheck: passed.
- ESLint: passed.
- Prettier checks for directly edited API/package files: passed.
- `git diff --check`: passed.
- Package lock updated with the new workspace dependency.

## Explicitly Not Included

- No Console cleanup dialog or storage dashboard UI.
- No background cleanup scheduling.
- No retention preview route in this slice.
- No commit or push has been made for this slice.

## Approval Gate

The implementation is locally verified and remains uncommitted and unpushed until explicit user approval.
