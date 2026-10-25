import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import metadata from "../package.json" with { type: "json" }

const desktop = resolve(import.meta.dirname, "..")
const app = join(desktop, "dist/app")

await rm(app, { recursive: true, force: true })
await mkdir(join(app, "dist"), { recursive: true })
await mkdir(join(app, "resources"), { recursive: true })
await Promise.all([
  cp(join(desktop, "dist/main.cjs"), join(app, "dist/main.cjs")),
  cp(join(desktop, "dist/preload.cjs"), join(app, "dist/preload.cjs")),
  cp(join(desktop, "resources/icon.png"), join(app, "resources/icon.png")),
  cp(resolve(desktop, "../web/dist"), join(app, "web"), { recursive: true }),
  writeFile(
    join(app, "package.json"),
    JSON.stringify(
      {
        name: "gitui",
        version: metadata.version,
        description: metadata.description,
        type: "module",
        main: metadata.main,
      },
      null,
      2,
    ) + "\n",
  ),
])
