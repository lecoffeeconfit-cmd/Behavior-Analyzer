import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "**/.next/**",
    "**/public/wasm/**",
    "**/public/vision-worker.js",
    "**/next-env.d.ts",
    "dist/**",
  ]),
  { files: ["**/*.tsx"], plugins: { "react-hooks": reactHooks }, rules: reactHooks.configs.recommended.rules },
  // Browser automation callbacks intentionally execute DOM APIs inside Node scripts.
  { files: ["scripts/**/*.mjs"], rules: { "no-undef": "off" } },
]);

export default eslintConfig;
