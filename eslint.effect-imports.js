export const effectImports = {
  "no-restricted-imports": [
    "error",
    {
      paths: ["effect", "effect/rpc", "effect/process", "effect/reactivity", "effect/http", "effect/socket"].map((name) => ({
        name,
        message: 'Import the module by subpath, e.g. import * as Schema from "effect/Schema".',
      })),
    },
  ],
}
