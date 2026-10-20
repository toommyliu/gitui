import * as BrowserKeyValueStore from "@effect/platform-browser/BrowserKeyValueStore"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"

const LIMIT = 50

const storage = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)

export const recentAtom = Atom.kvs({
  runtime: storage,
  key: "gitui.recent",
  schema: Schema.Array(Schema.String),
  defaultValue: (): ReadonlyArray<string> => [],
})

export const pinnedAtom = Atom.kvs({
  runtime: storage,
  key: "gitui.pinned",
  schema: Schema.Array(Schema.String),
  defaultValue: (): ReadonlyArray<string> => [],
})

export const addRecent = (recent: ReadonlyArray<string>, path: string) =>
  [path, ...recent.filter((other) => other !== path)].slice(0, LIMIT)
