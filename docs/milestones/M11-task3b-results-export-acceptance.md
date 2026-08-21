# M11 Task 3B - Results optional export API and UI acceptance

This atomic slice exposes the Task 3A optional export queue to the authenticated Results workflow.
The default HTML/ZIP output remains automatic; EXCEL, PDF, and JUNIT are explicitly selected by the user.

## Delivered

- `POST /api/results/:id/exports` accepts one or more `EXCEL|PDF|JUNIT` formats.
- The request requires the existing authenticated session, same-origin/host checks, CSRF, and an idempotency key.
- The response is `202` with the current result and persisted `PENDING`, `READY`, or `FAILED` export records.
- `GET /api/results/:id/exports/:format` now serves all five formats with fixed content types and download names.
- Runtime wiring loads the immutable report snapshot and uses the Excel, PDF, and JUnit publishers behind the Task 3A queue.
- Results detail provides checkboxes, a single generate action, state/time/size/hash metadata, downloads, and optional-format retry buttons.

## Verification

| Check                              | Result                      |
| ---------------------------------- | --------------------------- |
| Task 3B route/API/UI focused tests | 19 passed                   |
| Full Vitest suite                  | 141 files, 545 tests passed |
| TypeScript project build           | Passed                      |
| ESLint                             | Passed                      |
| Prettier and `git diff --check`    | Passed                      |
| Console production build           | Passed                      |
| CodeGraph sync                     | Passed; index up to date    |

## User flow

1. Open a terminal result in Results and enter its detail view.
2. Select EXCEL, PDF, and/or JUNIT in the optional export picker.
3. Click `生成选中格式`; the page shows queued state immediately and prevents duplicate submission.
4. Refresh or reopen the detail to see final state, timestamps, size, and SHA-256.
5. Download a READY export, or retry a FAILED/MISSING optional format to create a new attempt.

This slice is local and uncommitted pending explicit user acceptance. The next delivery action is to commit and push the verified changes to `main`.
