# M10 Task 4: Startup Finalization Recovery

## Scope

This atomic slice makes report finalization restart-safe at server startup. A report lease that remains `FINALIZING` beyond the configured five-minute lease window is treated as abandoned; the report and its terminal source run receive an explicit `INTERRUPTED` outcome.

## Delivered

- Added `ReportFinalizationRecoveryService` with an injectable clock and stale threshold.
- Reconciles only rows that are still `FINALIZING` and older than the cutoff.
- Updates the finalization row to `INTERRUPTED` with `STARTUP_INTERRUPTED` in the same transaction.
- Updates a `FINISHED` or `FAILED` source run to `INTERRUPTED`; other run states are not overwritten.
- Uses state and timestamp guards so repeated startup reconciliation is idempotent and fresh work remains active.
- Added `EVIDENCE_REPORTS_MIGRATION` and `REPORT_FINALIZATION_MIGRATION` to the server runtime migration list.
- Runs reconciliation immediately after database migration in `createRuntimeDeviceRegistry`.
- Synchronized `apps/server` package metadata and `package-lock.json` for the reports dependency.

## Verification

- Recovery service focused tests: 2/2 passed.
- Recovery plus existing runtime tests: 3/3 passed.
- Full suite: 109 files, 434 tests passed.
- `npm run typecheck` passed.
- `npm run lint -- --fix=false` passed.
- Prettier check passed for all changed files.
- `git diff --check` passed.
- CodeGraph sync passed after the final source edit.

## Not included in this slice

- Run-completion route that starts HTML/ZIP finalization.
- Results history/report API or console UI wiring.
- Retry orchestration after an `INTERRUPTED` finalization.
- Process-crash injection against a real report file write.
- Device execution or QA Bridge behavior.

## Approval gate

Implementation and local verification are complete. The current slice remains uncommitted and unpushed until user approval. After approval, commit and push it to the configured remote using the repository workflow.
