import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.ts", "tests/**/*.js", "tests/**/*.mjs"],
    globals: true,
  },
});
