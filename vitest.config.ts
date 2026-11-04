import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["packages/*/test/**/*.test.ts", "tests/contracts/**/*.test.ts"], environment: "node" }
});
