import { allRefsVisible, RefVisibility } from "@gitui/contracts"
import * as Schema from "effect/Schema"
import { createSignal, type Signal } from "solid-js"
import { load, save } from "./storage"

export type Location =
  | { readonly section: "branches" | "remotes" | "tags"; readonly name?: undefined }
  | { readonly section: "branches" | "remotes"; readonly name: string }

export type LocationState = "shown" | "hidden" | "inherited"

const decode = Schema.decodeUnknownSync(RefVisibility)
const storageKey = (commonDir: string) => `gitui.solid.visibility:${commonDir}`

const stores = new Map<string, Signal<RefVisibility>>()

const store = (commonDir: string) => {
  const existing = stores.get(commonDir)
  if (existing !== undefined) return existing
  const created = createSignal(load(storageKey(commonDir), decode, allRefsVisible))
  stores.set(commonDir, created)
  return created
}

export const refVisibility = (commonDir: string): RefVisibility => store(commonDir)[0]()

export const setRefVisibility = (commonDir: string, next: RefVisibility) => {
  store(commonDir)[1](next)
  save(storageKey(commonDir), next)
}

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
