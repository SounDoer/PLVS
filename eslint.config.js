import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import plvsAdrTheme from "./eslint-plugin-plvs-adr-theme.js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks, "plvs-adr": plvsAdrTheme },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Audio engine intentionally reads refs during render for snapshot logic
      "react-hooks/refs": "warn",
      // Catch-all error variables conventionally named _
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Empty catch blocks are intentional in audio teardown paths
      "no-empty": ["error", { allowEmptyCatch: true }],
      "plvs-adr/no-tailwind-dark-palette-variant": "error",
    },
  },
  {
    files: ["src/**/*.jsx"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // JSX was historically outside ESLint's default file set. Adopt the two
      // correctness rules immediately without implicitly opting the existing UI
      // into the broader React Compiler lint migration.
      ...Object.fromEntries(
        Object.keys(reactHooks.configs.recommended.rules).map((rule) => [rule, "off"])
      ),
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  { ignores: ["dist/", "public/"] },
];
