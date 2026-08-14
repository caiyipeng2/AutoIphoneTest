# M10 Task 2 - Offline HTML safety primitives acceptance

## Scope

This slice establishes the reports package boundary and the pure safety
primitives required by the future offline HTML renderer. It does not render a
report, query run data, add JavaScript, or change the console UI.

## Acceptance behavior

- `escapeHtmlText` encodes `&`, `<`, `>`, double quotes, and apostrophes while
  preserving safe Unicode text.
- `escapeHtmlAttribute` applies the same complete entity encoding for quoted
  attributes.
- `toSafeRelativeHref` accepts only non-empty local forward-slash paths.
- Absolute paths, protocol URLs, directory traversal, backslashes, query or
  fragment suffixes, encoded path characters, and control characters are
  rejected before a value can become an HTML link.
- The new `@test-center/reports` package is included in the root TypeScript
  project references and npm workspace lockfile.

## Verification

- `npm run typecheck` passed.
- `npm run lint -- --fix=false` passed.
- `npm test -- --run packages/reports/src/html-escape.test.ts` passed: 1 file,
  3 tests.
- `npm test` passed: 98 files, 398 tests.
- Prettier check passed for all files in this slice.
- `git diff --check` passed.
- CodeGraph sync passed and indexed the new reports package files.

## Delivery state

Implementation is intentionally left uncommitted for user confirmation. After
approval, commit and push this slice to `origin/main`.
