import type { BuildOptions } from "esbuild"

const common: BuildOptions = {
  bundle: true,
  platform: "node",
  target: "node24",
  sourcemap: true,
  logLevel: "warning",
}

export const bundles: ReadonlyArray<BuildOptions> = [
  { ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs", format: "cjs", external: ["electron"] },
  {
    ...common,
    entryPoints: ["src/preload.ts"],
    outfile: "dist/preload.cjs",
    format: "cjs",
    external: ["electron"],
  },
  {
    ...common,
    entryPoints: ["src/backend.ts"],
    outfile: "dist/backend.mjs",
    format: "esm",
    external: ["bufferutil", "utf-8-validate"],
    banner: {
      js: 'import { createRequire as createBannerRequire } from "node:module"; const require = createBannerRequire(import.meta.url);',
    },
  },
]
