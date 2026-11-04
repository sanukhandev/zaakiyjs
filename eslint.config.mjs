import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/node_modules/**", ".generated/**", "**/dist/**", "**/build/**", "**/.turbo/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } }
  }
];
