import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const contractsSource = fileURLToPath(
  new URL("./packages/contracts/src/", import.meta.url),
).replaceAll("\\", "/");
const environmentSource = fileURLToPath(
  new URL("./packages/environment/src/", import.meta.url),
).replaceAll("\\", "/");
const securitySource = fileURLToPath(
  new URL("./packages/security/src/", import.meta.url),
).replaceAll("\\", "/");

export default defineConfig({
  resolve: {
    // Tests must resolve workspace imports from tracked source, never from ignored
    // build output that may be missing or stale in a clean checkout.
    alias: [
      {
        find: /^@test-center\/contracts\/(.+)$/,
        replacement: `${contractsSource}$1.ts`,
      },
      {
        find: "@test-center/contracts",
        replacement: `${contractsSource}environment.ts`,
      },
      {
        find: /^@test-center\/environment\/(.+)$/,
        replacement: `${environmentSource}$1.ts`,
      },
      {
        find: /^@test-center\/contracts\/(health|settings)$/,
        replacement: `${contractsSource}$1.ts`,
      },
      {
        find: /^@test-center\/security\/(.+)$/,
        replacement: `${securitySource}$1.ts`,
      },
    ],
  },
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    exclude: ["**/dist/**"],
  },
});
