import { build } from "esbuild"
import { bundles } from "./bundles.ts"

await Promise.all(bundles.map((options) => build(options)))
