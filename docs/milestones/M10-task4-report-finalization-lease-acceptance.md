# M10 Task 4: Report Finalization Lease

## Scope

This atomic slice establishes the report-only runtime finalization lease. It is intentionally independent from the existing `test_runs.state` check constraint, so it does not change device execution or action synchronization behavior.

## Delivered

- Added migration `0015_report_finalization` with one `run_finalizations` record per run.
- Accepts finalization only for terminal source runs: `FINISHED`, `FAILED`, or `INTERRUPTED`.
- Acquires a persistent `FINALIZING` lease with an incrementing attempt number.
- Publishes HTML first and ZIP second through the existing publication interfaces.
- Writes `COMPLETED` only after both publications return successfully.
- Writes `FINALIZATION_FAILED` with `EXPORT_FAILED` when either publication fails; ZIP is not called after an HTML failure.
- Rejects concurrent `FINALIZING` work and allows a report-only retry after failure with the next attempt number.
- Added focused tests for the success, failure, concurrency, and retry paths.

## Verification

- `npm run typecheck` passed.
- `npm run lint -- --fix=false` passed.
- Prettier check passed for all changed TypeScript files.
- `git diff --check` passed.
- Reports package: 11 files, 37 tests passed.
- Full suite: 108 files, 432 tests passed.
- `codegraph sync` is required after this final edit before approval handoff.

## Not included in this slice

- Startup reconciliation of stale `FINALIZING` leases.
- Wiring this service into the run-completion route or UI.
- Device-side execution, QA Bridge injection, or multi-device synchronization.
- Rebuilding the existing `test_runs.state` constraint to add finalization states.
- Crash-injection or process-restart acceptance testing.

## Approval gate

Implementation and local verification are complete. The current slice remains uncommitted and unpushed until user approval. After approval, commit and push it to the configured remote using the repository workflow.
