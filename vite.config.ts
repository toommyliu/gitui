import { recommended } from "@effect/tsgo/oxlint-presets"
import { defineConfig } from "vite-plus"

export default defineConfig({
  fmt: {
    printWidth: 120,
    semi: false,
    singleQuote: false,
    trailingComma: "all",
    sortPackageJson: false,
    sortTailwindcss: {
      stylesheet: "apps/web/src/globals.css",
      functions: ["cn", "cva"],
    },
    ignorePatterns: ["pnpm-lock.yaml", "**/dist/**", "prompt.txt"],
  },
  lint: {
    extends: [recommended],
    plugins: ["typescript", "react", "import", "unicorn", "oxc"],
    categories: {
      correctness: "error",
    },
    options: {
      typeAware: true,
    },
    ignorePatterns: ["**/dist/**", "**/node_modules/**"],
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "warn",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^effect(/[a-z]+)*$",
              message: 'Import the module by subpath, e.g. import * as Schema from "effect/Schema".',
            },
          ],
        },
      ],
      "effecttsgo/unstable-api-usage": "off",
      "import/default": "off",
      "react/incompatible-library": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
})
