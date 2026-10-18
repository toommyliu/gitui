import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"
import { effectImports } from "./eslint.effect-imports.js"

export default defineConfig([
  globalIgnores(["**/node_modules", "**/dist", "apps/web", "packages/ui"]),
  {
    files: ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts", "apps/server/src/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: effectImports,
  },
])
