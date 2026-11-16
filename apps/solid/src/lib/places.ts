import * as Schema from "effect/Schema"
import { createSignal } from "solid-js"
import { load, save } from "./storage"

const RECENT = "gitui.solid.recent"
const PINNED = "gitui.solid.pinned"
const LIMIT = 50

const decodePaths = Schema.decodeUnknownSync(Schema.Array(Schema.String))

const [recent, setRecent] = createSignal<ReadonlyArray<string>>(load(RECENT, decodePaths, []))
const [pinned, setPinned] = createSignal<ReadonlyArray<string>>(load(PINNED, decodePaths, []))

export { pinned, recent }

const update = (key: string, set: (next: ReadonlyArray<string>) => void, next: ReadonlyArray<string>) => {
  set(next)
  save(key, next)
}

export const remember = (path: string) =>
  update(RECENT, setRecent, [path, ...recent().filter((other) => other !== path)].slice(0, LIMIT))

export const forget = (path: string) =>
  update(
    RECENT,
    setRecent,
    recent().filter((other) => other !== path),
  )

export const togglePin = (folder: string) =>
  update(
    PINNED,
    setPinned,
    pinned().includes(folder) ? pinned().filter((other) => other !== folder) : [...pinned(), folder],
  )
