# M11 Task 2B - PDF report export

## Scope

This slice adds a PDF exporter for the immutable report model. It reuses the existing dependency-free HTML report, injects print-only layout rules, and renders through a browser boundary that blocks all network requests.

Implemented behavior:

- A4 landscape output with print backgrounds enabled.
- A report-specific header and footer with Run ID and Chromium page-number placeholders.
- Repeating table headers and row-safe page breaks for long report sections.
- A `document.fonts.ready` wait before printing so layout is settled before pagination.
- Offline HTML remains the source of truth; no remote assets or scripts are introduced.
- The default Playwright factory blocks `**/*` requests and service workers before creating a page.
- `playwright@1.55.0` is declared as the reports runtime dependency; the existing repository version is intentionally not upgraded in this slice.
- A maximum page count is enforced (default `100`) to prevent unbounded output.
- Rendered bytes return SHA-256, byte size, and detected page count.
- Publication writes `${finalPath}.partial` and renames it only after a complete render.
- Browser and page resources close in success and failure paths.

## Verification

| Check                               | Result                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| TDD RED: missing `pdf-exporter.ts`  | Passed: test collection failed as expected                                                                                |
| PDF exporter tests                  | 3 passed                                                                                                                  |
| Reports package regression          | 18 files, 61 tests passed                                                                                                 |
| Full test suite                     | 139 files, 538 tests passed                                                                                               |
| TypeScript typecheck                | Passed                                                                                                                    |
| ESLint                              | Passed                                                                                                                    |
| Console production build            | Passed                                                                                                                    |
| Prettier and `git diff --check`     | Passed                                                                                                                    |
| Real Chromium PDF smoke             | Passed with explicit `executablePath` injection to installed system Chrome: 2 pages, 74,122 bytes, valid `%PDF-` magic    |
| Print-media visual inspection       | Passed: E-drive PNG screenshot reviewed; headings, metrics, tables, spacing, and empty states have no overlap or clipping |
| Project-local Chromium provisioning | Blocked: E-drive download left an incomplete `chromium-1187` (`chrome.dll` is 0 bytes)                                    |

## Acceptance boundary

This is a local, uncommitted slice pending user confirmation. After confirmation it may be committed and pushed to `origin/main`. Real rendering and print-media visual checks passed with the explicit system-Chrome path; the portable package still needs a complete matching Chromium binary under its E-drive cache before Task 4 packaging acceptance.

Next atomic slice: repair the project-local Chromium provisioning for portable packaging, then proceed to the optional export queue/UI work.
