import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "src-tauri/target",
      "src-tauri/gen",
      "node_modules",
      "test-results",
      "playwright-report",
      "tests/corpus/generated",
      "tests/corpus/out",
      "scripts/tmp",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // CLAUDE.md: src/engine must run in Node (MCP reuses it) — no React/DOM/Tauri.
    files: ["src/engine/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "react",
            "react-dom",
            "react/*",
            "react-dom/*",
            "@tauri-apps/*",
            "@embedpdf/core",
            "@embedpdf/plugin-*",
            "@embedpdf/engines/react",
          ],
        },
      ],
      "no-restricted-globals": ["error", "window", "document", "navigator"],
    },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.{ts,mjs}", "*.config.{ts,js}"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  prettier,
);
