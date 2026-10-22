import * as BrowserKeyValueStore from "@effect/platform-browser/BrowserKeyValueStore"
import { allRefsVisible, RefVisibility } from "@gitui/contracts"
import * as Atom from "effect/reactivity/Atom"

const storage = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)

export const visibilityAtom = Atom.family((commonDir: string) =>
  Atom.kvs({
    runtime: storage,
    key: `gitui.visibility:${commonDir}`,
    schema: RefVisibility,
    defaultValue: (): RefVisibility => allRefsVisible,
  }),
)

export type Location =
  | { readonly section: "branches" | "remotes" | "tags" | "stashes"; readonly name?: undefined }
  | { readonly section: "branches" | "remotes"; readonly name: string }

export type LocationState = "shown" | "hidden" | "inherited"

const lists = { branches: "hiddenBranches", remotes: "hiddenRemotes" } as const

export const locationState = (visibility: RefVisibility, location: Location): LocationState => {
  if (location.name === undefined) return visibility[location.section] ? "shown" : "hidden"
  if (!visibility[location.section]) return "inherited"
  const hidden = visibility[lists[location.section]]
  if (hidden.includes(location.name)) return "hidden"
  return hidden.some((entry) => location.name.startsWith(`${entry}/`)) ? "inherited" : "shown"
}

export const toggleLocation = (visibility: RefVisibility, location: Location): RefVisibility => {
  if (location.name === undefined) return { ...visibility, [location.section]: !visibility[location.section] }
  const key = lists[location.section]
  const hidden = visibility[key]
  return {
    ...visibility,
    [key]: hidden.includes(location.name)
      ? hidden.filter((entry) => entry !== location.name)
      : [...hidden, location.name],
  }
}
