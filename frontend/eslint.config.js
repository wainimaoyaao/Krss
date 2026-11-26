import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "coverage"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ["src/components/entry-list/EntryList.tsx"],
    rules: {
      // 本文件用 @tanstack/react-virtual 的 useVirtualizer，React Compiler 编译不了这个库，
      // 只会反复报「Compilation Skipped」，关掉这条噪音；immutability / refs 等语义规则仍然生效。
      "react-hooks/incompatible-library": "off",
    },
  },
]);
