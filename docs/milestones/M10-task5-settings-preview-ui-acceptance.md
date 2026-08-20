# M10 Task 5: Settings Retention Preview UI Acceptance

## Scope

This atomic slice connects the existing Settings page to the retention preview API. Operators can edit and save the retention window, refresh a read-only candidate preview, and see loading, empty, error, candidate, and estimated-byte states. It does not add destructive cleanup confirmation, deletion controls, protected-run editing, or the Overview storage dashboard.

## Delivered

- Added typed console API access for `GET /api/cleanup/preview` and `PATCH /api/settings` with CSRF and optimistic version headers.
- Added `CleanupPreviewPanel` with a dense operations-console layout, candidate table, cutoff date, estimated bytes, explicit read-only safety state, loading feedback, empty state, and accessible error region.
- Converted the Settings retention input to a controlled field with 1-3650 validation.
- Wired the Settings save action to the server and reports the returned configuration version and success/error state.
- Added responsive single-column behavior for the preview summary and candidate table on narrow screens.

## Verification

- Focused console tests: 5/5 passed.
- Full suite: 128 files, 505 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build --workspace @test-center/console` passed.
- Prettier checks passed for the edited console files.
- Real browser verification passed with a bootstrap session at `http://127.0.0.1:4780/#overview?code=dev-bootstrap-code`:
  - Settings page loaded with the protected preview request.
  - Retention changed from 14 to 45 days and saved successfully; configuration version advanced from 1 to 2.
  - Preview cutoff updated from 2026-08-06 to 2026-07-06.
  - Screenshots: `output/playwright/settings-cleanup-preview-authenticated.png` and `output/playwright/settings-cleanup-preview-saved.png`.
- Browser console contained only the pre-existing missing `/favicon.ico` 404.

## Not included in this slice

- Overview free-space/pressure dashboard.
- Protected-run management controls.
- Destructive confirmation dialog, cleanup execution, recovery, and audit manifest UI.

## Approval gate

Implementation and local verification are complete. The current changes remain uncommitted and unpushed until explicit user approval.
