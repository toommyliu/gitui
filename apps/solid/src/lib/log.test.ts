import { RepoId } from "@gitui/contracts"
import * as Schema from "effect/Schema"
import { createRoot, flush } from "solid-js"
import { describe, expect, it, vi } from "vite-plus/test"

interface Request {
  readonly method: string
  readonly args: { readonly logId?: string; readonly start?: number; readonly count?: number }
}

interface Subscriber {
  send(value: unknown): void
}

interface PendingPage {
  readonly request: Request
  readonly resolve: (rows: unknown) => void
}

const server = vi.hoisted(() => ({
  subscribers: new Map<string, Subscriber>(),
  pages: new Array<PendingPage>(),
}))

vi.mock("./rpc", () => {
  const git = new Proxy({}, { get: (_, method) => (args: Request["args"]) => ({ method: String(method), args }) })
  return {
    connection: () => "connected",
    describeError: String,
    collect: async () => undefined,
    call: (request: (client: unknown) => Request) =>
      new Promise((resolve) => server.pages.push({ request: request(git), resolve })),
    subscribe: (request: (client: unknown) => Request, onValue: (value: never) => void) => {
      server.subscribers.set(request(git).method, { send: onValue })
      return () => undefined
    },
  }
})

const { createRepo } = await import("./repo")
const { createLog } = await import("./log")

const commits = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({ oid: `${prefix}${index}`, subject: `${prefix}${index}` }))

const send = (method: string, value: unknown) => server.subscribers.get(method)?.send(value)

const answerPages = async (logId: string, rows: ReadonlyArray<unknown>) => {
  await Promise.resolve()
  for (const pending of server.pages.splice(0)) {
    const { start = 0, count = 0 } = pending.request.args
    if (pending.request.args.logId === logId) pending.resolve(rows.slice(start, start + count))
    else server.pages.push(pending)
  }
  await new Promise((resolve) => setTimeout(resolve))
  flush()
}

describe("createLog", () => {
  it("keeps showing the current rows until the new log's visible rows load", async () => {
    const log = createRoot(() => createLog(createRepo(Schema.decodeSync(RepoId)("repo")), () => ""))
    flush()

    send("OpenLog", { logId: "old", loaded: 3, done: true })
    flush()
    log.ensure(0, 3)
    await answerPages("old", commits("old-", 3))
    expect(log.row(0)?.oid).toBe("old-0")

    send("WatchRepo", { scopes: ["refs"] })
    flush()
    send("OpenLog", { logId: "new", loaded: 4, done: true })
    flush()

    expect([0, 1, 2].map((index) => log.row(index)?.oid)).toEqual(["old-0", "old-1", "old-2"])
    expect(log.handle()?.logId).toBe("old")

    await answerPages("new", commits("new-", 4))
    expect(log.handle()?.logId).toBe("new")
    expect([0, 1, 2, 3].map((index) => log.row(index)?.oid)).toEqual(["new-0", "new-1", "new-2", "new-3"])
  })
})
