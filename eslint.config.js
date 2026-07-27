// ── ESLint (flat config) ──────────────────────────────────────────────────
// Type-aware linting for the React/TS frontend. The Rust side is covered by
// `cargo clippy`, not here.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // Underscore-prefixed bindings are intentional throwaways.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The store and API layer legitimately widen to `unknown`, never `any`.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // Config files run in Node and are not part of the app bundle.
  {
    files: ["*.config.js", "*.config.ts"],
    languageOptions: { globals: globals.node },
  }
);
