import * as BrowserKeyValueStore from "@effect/platform-browser/BrowserKeyValueStore"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"

export const Settings = Schema.Struct({
  diffStyle: Schema.Literals(["unified", "split"]),
  wrapLines: Schema.Boolean,
  repoBase: Schema.optionalKey(Schema.String),
})
export type Settings = typeof Settings.Type

const storage = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)

export const settingsAtom = Atom.kvs({
  runtime: storage,
  key: "gitui.settings",
  schema: Settings,
  defaultValue: (): Settings => ({ diffStyle: "unified", wrapLines: false }),
})
