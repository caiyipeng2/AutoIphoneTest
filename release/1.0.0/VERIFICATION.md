# v1.0.0 Verification

## Source Gates

| Check | Result |
| --- | --- |
| `npm test` | 159 test files passed, 1 skipped; 647 tests passed, 2 skipped |
| `npm run typecheck` | PASS |
| `npm run lint -- --quiet` | PASS |
| Launcher Release build | PASS, 0 warnings, 0 errors |
| `git diff --check` | PASS |
| CodeGraph status | Index up to date |

## Portable Artifact

- Build source: commit `ee7da4e`.
- Portable layout and manifest test: 2/2 passed.
- Manifest: 41,504 files.
- `scripts/verify-portable.ps1`: PASS, 41,504 files and Node `v22.23.1`.
- ZIP size: 709,792,409 bytes.
- ZIP SHA-256: `00A690DBD426037FD2AE3DC1DB682577A9DBCB3DB7A050EFFA3C3D999B804636`.
- Manifest SHA-256: `7FB5288DF6242FA8B4330DA47CBC10A7CEA902489C1C9725C5D14B9BE523EEEF`.
- Clean portable verifier: the same manifest walk is used by
  `scripts/verify-portable.ps1`; layout test passed against the current root.

## Hardware and Reports

- M11 Task 18: two-device portable smoke, Tap/Swipe success on both devices,
  HTML/ZIP/Excel/PDF/JUnit all `READY`.
- M11 Task 19: 3,600-second two-device stability, 324 samples, 270 post-warmup
  samples, analyzer `PASS`, zero checkpoint errors, zero crashes/restarts,
  max queue depth 0, max WAL 4,165,352 bytes, cleanup worker/lease/forward 0.
- M9 Task 33: physical Follower quarantine and rejoin passed on the same
  Samsung/Motorola pair.

## Publication Gate

This file is prepared for the `v1.0.0` release commit. The annotated tag and
GitHub Release must be created only after the release commit is pushed and the
GitHub connection is verified. No tag or GitHub Release is created by this
local verification step.

## Publication Attempt

- User authorization was received for `origin/main` and the `v1.0.0` release.
- Initial push attempts were stopped by the automatic permission review
  timeout because the terminal inherited an invalid localhost proxy.
- After clearing `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `GIT_HTTP_PROXY`,
  and `GIT_HTTPS_PROXY`, direct HTTPS and `git ls-remote` checks passed.
- `origin/main` now resolves to `5e9bab9d0551739df3d981d09bd16d216e616506`.
- Annotated tag `v1.0.0` is pushed and resolves to the same commit.
- GitHub CLI `v2.100.0` was installed under `E:\Tools\GitHubCLI\v2.100.0`.
- GitHub Release `v1.0.0` is published at
  `https://github.com/caiyipeng2/AutoIphoneTest/releases/tag/v1.0.0`.
- Asset `TestCenterLauncher.zip` is `uploaded`, 709,792,409 bytes, with
  GitHub digest `sha256:00a690dbd426037fd2ae3dc1db682577a9dbcb3db7a050effa3c3d999b804636`.
