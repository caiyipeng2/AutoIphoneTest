# M10 Task 5: Retention Preview Acceptance

## Scope

This atomic slice adds a non-destructive retention preview. It selects runs older than the configured retention window, excludes protected and non-terminal runs, and estimates only ready evidence and report bytes. It does not delete files, mutate SQLite state, issue confirmation nonces, move data to trash, or expose a server/UI route.

## Delivered

- Added `CleanupService.preview` with a validated retention window of 1 to 3650 days.
- Terminal run candidates include completed, failed, interrupted, finalization-failed, and aborted states; active and finalizing states are excluded.
- Protected runs are excluded without changing the input records.
- Estimated bytes include only `READY` evidence/report entries and explicitly exclude immutable imported artifacts.
- Candidates are sorted deterministically by completion time and run ID, with a total estimated byte count for a later cleanup confirmation flow.
- Exported the service through `@test-center/evidence` for future server integration.

## Verification

- Retention preview focused tests: 3/3 passed.
- Full suite: 120 files, 483 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- Prettier checks passed for all files in this slice.
- `git diff --check` and CodeGraph sync passed.

## Not included in this slice

- Server storage route and overview/settings integration.
- Confirmation nonce binding, `DELETING` state transitions, same-volume trash moves, and audited deletion.
- Recovery of partial cleanup failures and unresolved-path reporting.

## Approval gate

Implementation and local verification are complete. The current changes remain uncommitted and unpushed until explicit user approval.
