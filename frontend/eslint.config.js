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
      "react-hooks/incompatible-library": "off",
      // 本文件的刷新记账是「ref 里的可变袋子」（在 useCallback / effect 里改 .current：
      // 去重 Set、计时器 id、active/finished 标志）。React Compiler 的 immutability 规则
      // 把回调里对 ref 内容的写入判成「改了不该改的值」，7 处全是这个形状；
      // 改成 state 会改掉「同一轮刷新只报一次条数」的语义，需要单独一批带浏览器验收。
      "react-hooks/immutability": "off",
    },
  },
]);
