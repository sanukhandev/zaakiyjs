import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/node_modules/**", ".generated/**", "**/dist/**", "**/build/**", "**/.turbo/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["packages/core/src/jsx-runtime.ts"], rules: { "@typescript-eslint/no-namespace": "off" } },
  {
    files: ["benchmarks/h4-hydration/**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        AbortController: "readonly",
        URL: "readonly",
        document: "readonly",
        MutationObserver: "readonly",
        performance: "readonly",
        window: "readonly"
      }
    }
  },

  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } }
  }
];
