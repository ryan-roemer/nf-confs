import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    ignores: [".data/*", "data/*", "node_modules/*"],
  },
  js.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
];
