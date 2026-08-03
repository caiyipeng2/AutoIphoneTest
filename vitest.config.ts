import { defineConfig } from "vitest/config";

import { vitestProjects } from "./vitest.workspace.js";

export default defineConfig({
  test: {
    projects: vitestProjects,
  },
});
