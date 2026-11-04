import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["packages/*/test/**/*.test.ts", "packages/*/tests/**/*.test.ts", "tests/contracts/**/*.test.ts"], environment: "node" }
});
