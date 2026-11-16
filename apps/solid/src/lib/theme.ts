import { type Theme as Preference, Theme } from "@gitui/contracts"
import * as Schema from "effect/Schema"
import { createSignal } from "solid-js"
import { desktop } from "./desktop"

const KEY = "theme"
const isPreference = Schema.is(Theme)
const media = matchMedia("(prefers-color-scheme: dark)")

const stored = () => {
  try {
    const value = localStorage.getItem(KEY)
    return isPreference(value) ? value : "system"
  } catch {
    return "system"
  }
}

const [preference, setPreferenceSignal] = createSignal<Preference>(stored())
const systemIsDark = () => desktop?.isSystemDark() ?? media.matches

const [systemDark, setSystemDark] = createSignal(systemIsDark())

const resolve = (value: Preference, dark: boolean) => (value === "system" ? (dark ? "dark" : "light") : value)

const apply = (resolved: "dark" | "light") => {
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(resolved)
  root.style.colorScheme = resolved
}

export const theme = () => resolve(preference(), systemDark())

export { preference }

export const setPreference = (value: Preference) => {
  setPreferenceSignal(value)
  try {
    localStorage.setItem(KEY, value)
  } catch {}
  apply(resolve(value, systemDark()))
  desktop?.setTheme(value)
}

export const toggleTheme = () => setPreference(theme() === "dark" ? "light" : "dark")

let settling: ReturnType<typeof setTimeout> | undefined
const followSystem = (dark: boolean) => {
  clearTimeout(settling)
  settling = setTimeout(() => {
    if (dark === systemDark()) return
    setSystemDark(dark)
    apply(resolve(stored(), dark))
  }, 300)
}

if (desktop === undefined) media.addEventListener("change", () => followSystem(media.matches))
else desktop.onSystemDark((dark) => followSystem(dark === true))

desktop?.onTheme((value) => {
  if (isPreference(value)) setPreference(value)
})

desktop?.setTheme(stored())
apply(resolve(stored(), systemDark()))
