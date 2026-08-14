# M10 Task 2 - Offline HTML renderer acceptance

## Scope

This slice renders the immutable report model as a dependency-free static HTML
document. It does not query SQLite, create report files, or add Results page
navigation.

## Acceptance behavior

- The document is UTF-8 HTML with inline CSS and no JavaScript, external fonts,
  images, links, or network requests.
- A restrictive CSP uses `default-src 'none'`, inline styles only, no images,
  no base URL, and no form submission.
- The report contains run status/identity, summary metrics, device matrix,
  action timeline, and evidence readiness sections.
- Every dynamic text value and HTML attribute is escaped independently.
- Evidence links are revalidated as local relative paths and attribute-escaped.
- Responsive narrow-screen and print CSS are included without layout-changing
  runtime behavior.
- Missing and failed evidence remain visible with their reason/category instead
  of being silently omitted.

## Verification

- `npm run typecheck` passed.
- `npm run lint -- --fix=false` passed.
- `npm test -- --run packages/reports` passed: 3 files, 9 tests.
- `npm test` passed: 100 files, 404 tests.
- Prettier check passed for all report files in this slice.
- `git diff --check` passed.
- CodeGraph sync passed and indexed the renderer implementation.

## Delivery state

Implementation is intentionally left uncommitted for user confirmation. After
approval, commit and push this slice to `origin/main`.
