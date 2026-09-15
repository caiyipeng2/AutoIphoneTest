# Unity Multi-Device Test Center v1.0.0 Release Design

Date: 2026-09-15

Repository: `E:\Projects\UnityMultiDeviceTestCenter`

## Goal

Prepare a reproducible `v1.0.0` release for the Unity Android multi-device
test center after M0-M11 acceptance, while keeping generated binaries outside
the Git history and preserving an auditable E-drive evidence path.

## Release Surface

### Version Metadata

- Set the repository root package version to `1.0.0`.
- Set all first-party workspace package versions and internal workspace
  dependency versions to `1.0.0`.
- Leave third-party dependency versions, generated Unity package metadata, and
  historical fixture metadata unchanged.
- Keep the repository package private; the product release is the portable
  Windows artifact, not an npm publication.

### Root Documentation

- Add `README.md` with product scope, supported 1-4 device model, required
  Android USB authorization, Appium-only and QA Bridge modes, local startup,
  report/export behavior, and links to the milestone acceptance records.
- Add `CHANGELOG.md` with the `1.0.0` section grouped into product features,
  recovery behavior, reporting/portable delivery, and verification evidence.

### Release Directory

Create and track:

```text
release/1.0.0/
  RELEASE.md
  CHECKSUMS.txt
  VERIFICATION.md
```

- `RELEASE.md` identifies the source commit, package name, version, supported
  modes, device scope, known limitations, installation flow, rollback path,
  and artifact location.
- `CHECKSUMS.txt` records the portable ZIP filename, byte size, SHA-256, and
  manifest SHA-256.
- `VERIFICATION.md` records the exact commands and fresh outputs for tests,
  typecheck, lint, Launcher build, portable manifest verification, two-device
  smoke, optional exports, and 60-minute stability.
- The large ZIP remains on E: under the acceptance/release artifact root and
  is attached to GitHub Release; it is not committed to Git.

## Artifact and Verification Contract

The release candidate uses the current portable artifact with the bundled
Android SDK subset, Appium Home, Node 22.23.1, Java 17, bundletool, scrcpy,
Chromium, server/console build, and launcher. Before release publication:

1. Run `npm test`, `npm run typecheck`, `npm run lint -- --quiet`, and the
   Launcher Release build.
2. Run `scripts/verify-portable.ps1` against the clean E-drive portable root.
3. Confirm the current two-device smoke and optional HTML/ZIP/Excel/PDF/JUnit
   hashes from M11 Task 18.
4. Confirm the current two-device 60-minute analyzer PASS from M11 Task 19.
5. Verify `git diff --check`, CodeGraph status, branch cleanliness, and source
   commit identity.

## GitHub Release Strategy

- Commit version/docs/release metadata to `main`.
- Push `main` to `origin`.
- Create an annotated tag `v1.0.0` at the release commit.
- Push the tag only after local artifact and verification checks pass.
- Create a GitHub Release titled `v1.0.0`, attach the portable ZIP, and include
  the contents of `RELEASE.md` and `CHECKSUMS.txt` in the release notes.
- Do not create a GitHub Release or tag pointing at an unverified artifact.

## Network Failure Fallback

If GitHub access is blocked by the configured proxy:

- Finish all local version/docs/release metadata commits.
- Keep the release ZIP and verification evidence on E:.
- Do not claim the tag or GitHub Release was published.
- Record the exact failed network command and leave the local commit ready for
  a later `git push origin main`, `git push origin v1.0.0`, and `gh release create`.

## Rollback

- Do not rewrite or delete `v1.0.0` after publication.
- A correction creates `1.0.1` and tag `v1.0.1`.
- The previous accepted commit remains the rollback target; release metadata
  names the exact source commit and artifact hash.

## Out Of Scope

- No npm publication.
- No change to the default QA Bridge/Appium-only product policy.
- No expansion from the accepted two-device hardware scope to three or four
  devices in this release slice.
- No new Unity package build or signing operation.
