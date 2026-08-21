# M11 Task 3A - Optional export queue foundation

## Scope

This atomic slice adds the persistence and queue foundation for user-selectable EXCEL, PDF, and JUNIT exports. The mandatory HTML/ZIP finalization path remains unchanged.

Implemented behavior:

- Migration `0019_optional_report_exports` upgrades the report export format constraint while preserving existing HTML/ZIP rows.
- `ReportExportRepository` accepts all five report formats and lists attempts for one run.
- `ReportExportService` accepts a nonempty, duplicate-free set of optional formats and an idempotency key.
- Requests with the same idempotency key and payload return the same job records; reuse with another payload is rejected.
- PDF work has one active slot; Excel/JUnit share two active slots.
- Jobs load a terminal immutable report snapshot only when execution begins.
- Each exporter publishes atomically, then the repository records READY metadata (relative path, SHA-256, and size).
- Publisher failures become FAILED export rows without mutating the run state.
- Output paths are constrained to the run root and use format-specific extensions.

## Verification

| Check                              | Result                                         |
| ---------------------------------- | ---------------------------------------------- |
| TDD RED: missing migration/service | Passed: new tests failed before implementation |
| Task 3A focused tests              | 3 passed                                       |
| Reports/database regression        | 23 files, 75 tests passed                      |
| Full test suite                    | 141 files, 541 tests passed                    |
| TypeScript typecheck               | Passed                                         |
| ESLint                             | Passed                                         |
| Prettier and `git diff --check`    | Passed                                         |
| Console production build           | Passed                                         |

## Acceptance boundary

This is a local, uncommitted slice pending user confirmation. It does not yet add the HTTP request endpoint, export download expansion, Results page menu/job list, retry UI, or end-to-end browser flow. Those are the next Task 3B slice.
