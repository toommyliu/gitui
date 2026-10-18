import { resolve } from "node:path"
import { NodeRuntime } from "@effect/platform-node"
import * as Layer from "effect/Layer"
import { serverLayer } from "./server.ts"

serverLayer({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4600),
  repoRoots: (process.env.REPO_ROOTS ?? "").split(":").filter((root) => root !== ""),
  webDist: resolve(import.meta.dirname, "../../web/dist"),
}).pipe(Layer.launch, NodeRuntime.runMain)
