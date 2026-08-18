# M10 Task 5: Cleanup Confirmation Acceptance

## Scope

This atomic slice adds a durable, one-time cleanup confirmation nonce. The nonce binds the normalized sorted Run ID set and the exact expected byte estimate, with an expiry and atomic consume check. It does not move or delete files, change run states, or expose a storage route/UI.

## Delivered

- Added migration `0016_cleanup_confirmations` with hashed nonce, canonical Run ID JSON, expected bytes, expiry, and consumed timestamp.
- Added `CleanupConfirmationService.issue` and `consume` with injectable clock and TTL for deterministic tests.
- Run IDs are required, non-empty, unique, and sorted before persistence and comparison.
- Changed byte estimates, changed Run ID sets, expired nonces, invalid nonces, and reuse are rejected.
- Registered the migration in the runtime database bootstrap and exported the service through `@test-center/security`.

## Verification

- Cleanup confirmation focused tests: 3/3 passed.
- Full suite: 121 files, 486 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- Prettier checks passed for the new service, tests, migration, exports, package metadata, and this acceptance document; the existing runtime file kept its pre-existing formatting outside this slice.
- `git diff --check` and CodeGraph sync passed.

## Not included in this slice

- Server confirmation issue/consume routes and UI confirmation dialog.
- `DELETING` state transitions, same-volume trash moves, per-item deletion, and audit manifests.
- Recovery of partial cleanup failures and unresolved-path reporting.

## Approval gate

Implementation and local verification are complete. The current changes remain uncommitted and unpushed until explicit user approval.
