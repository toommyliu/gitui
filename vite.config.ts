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
      stylesheet: "apps/solid/src/styles.css",
    },
    ignorePatterns: ["pnpm-lock.yaml", "**/dist/**", "prompt.txt"],
  },
  lint: {
    extends: [recommended],
    plugins: ["typescript", "import", "unicorn", "oxc"],
    categories: {
      correctness: "error",
    },
    options: {
      typeAware: true,
    },
    ignorePatterns: ["**/dist/**", "**/node_modules/**"],
    rules: {
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
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      {
        files: ["apps/solid/**"],
        rules: {
          "no-unassigned-vars": "off",
        },
      },
    ],
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
})
