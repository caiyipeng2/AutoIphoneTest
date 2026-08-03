import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "coverage/**",
      "data/**",
      "playwright-report/**",
      "TestResults/**",
      "tools/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
];
