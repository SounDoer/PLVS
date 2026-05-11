import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Audio engine intentionally reads refs during render for snapshot logic
      "react-hooks/refs": "warn",
      // Catch-all error variables conventionally named _
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      // Empty catch blocks are intentional in audio teardown paths
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  { ignores: ["dist/", "public/"] },
];
