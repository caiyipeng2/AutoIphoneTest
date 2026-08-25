# M11 Task 4 - Portable Windows delivery acceptance

This atomic slice assembles a self-contained Windows directory and an atomic ZIP release for the Unity Android multi-device test center. The directory keeps the launcher's expected `apps/server`, `apps/console`, `tools`, `data`, and `node_modules` layout while materializing workspace junctions as ordinary files.

## Delivered

- `scripts/build-portable.ps1` builds the server/console, publishes a single-file `TestCenterLauncher.exe`, copies verified Node/Java/bundletool/scrcpy/Appium/Chromium assets, copies production runtime dependencies, writes configuration and operating documentation, and emits an ordered SHA-256/size manifest.
- `scripts/write-release-manifest.mjs` rejects symbolic links and records a license component for every shipped file.
- `scripts/verify-portable.ps1` verifies every manifest hash and the bundled Node version after extraction.
- `tests/integration/portable-layout.test.ts` checks required runtime layout and rejects source paths, escaping links, caches, secrets, imported apps, and historical runs.
- `config/settings.example.json`, `THIRD_PARTY_NOTICES.md`, and the operating/extension guides document the supported workflow and the opt-in Unity command build provider.

## Verification

| Check                                          | Result                                                    |
| ---------------------------------------------- | --------------------------------------------------------- |
| TypeScript project build                       | Passed                                                    |
| Full Vitest suite                              | 141 files, 545 tests passed                               |
| Portable layout test on source-built directory | 2 passed                                                  |
| Portable layout test on ZIP extraction         | 2 passed                                                  |
| Portable manifest verifier                     | 41,254 files and Node `v22.23.1` verified                 |
| Extracted ZIP                                  | `dist/releases/TestCenterLauncher.zip`, 645,525,185 bytes |
| ESLint and Prettier                            | Passed for new code/docs                                  |

The generated directory and ZIP are ignored build artifacts. Source changes remain local and are pending explicit user approval before commit and push.
