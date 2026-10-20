import * as BrowserKeyValueStore from "@effect/platform-browser/BrowserKeyValueStore"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"
import { diffThemeIds } from "./diff-themes"
import { isNarrow } from "./narrow"

const withDefault = <S extends Schema.Top>(schema: S, value: S["Encoded"]) =>
  schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)))

export const Settings = Schema.Struct({
  diffStyle: Schema.Literals(["unified", "split"]),
  wrapLines: Schema.Boolean,
  changeMarkers: withDefault(Schema.Literals(["color", "signs", "both"]), "color"),
  wordDiff: withDefault(Schema.Literals(["word", "char", "none"]), "word"),
  lineNumbers: withDefault(Schema.Boolean, true),
  diffTheme: withDefault(Schema.Literals(diffThemeIds), "pierre"),
  diffTextSize: withDefault(Schema.Literals(["small", "medium", "large"]), "medium"),
  historyDates: withDefault(Schema.Literals(["exact", "relative"]), "exact"),
  subjectGuide: withDefault(Schema.Literals(["off", "50", "72"]), "off"),
  historyRemotes: withDefault(Schema.Boolean, true),
  ignoreWhitespace: withDefault(Schema.Boolean, false),
  backgroundFetch: withDefault(Schema.Literals(["off", "5", "15", "30"]), "off"),
  lineCounts: withDefault(Schema.Literals(["all", "code"]), "all"),
})
export type Settings = typeof Settings.Type

const storage = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)

export const settingsAtom = Atom.kvs({
  runtime: storage,
  key: "gitui.settings",
  schema: Settings,
  defaultValue: (): Settings => ({
    diffStyle: "unified",
    wrapLines: false,
    changeMarkers: "color",
    wordDiff: "word",
    lineNumbers: true,
    diffTheme: "pierre",
    diffTextSize: "medium",
    historyDates: "exact",
    subjectGuide: "off",
    historyRemotes: true,
    ignoreWhitespace: false,
    backgroundFetch: "off",
    lineCounts: "all",
  }),
})

export const settingsSections = ["general", "appearance", "diffs", "history", "commit", "keyboard"] as const
export type SettingsSection = (typeof settingsSections)[number]

const SettingsView = Schema.Literals([...settingsSections, "sections"])
export type SettingsView = typeof SettingsView.Type

const SettingsEntry = Schema.Struct({ settings: SettingsView, session: Schema.String })

const session = String(performance.timeOrigin)

const currentEntry = () => Option.getOrNull(Schema.decodeUnknownOption(SettingsEntry)(history.state))

const currentView = (): SettingsView | null => currentEntry()?.settings ?? null

export const settingsViewAtom = Atom.writable(
  (get): SettingsView | null => {
    const sync = () => get.setSelf(currentView())
    window.addEventListener("popstate", sync)
    get.addFinalizer(() => window.removeEventListener("popstate", sync))
    return currentView()
  },
  (ctx, to: SettingsView | "open" | "back") => {
    const current = currentView()
    if (to === "back") {
      if (currentEntry()?.session === session) return history.back()
      history.replaceState(null, "")
      return ctx.setSelf(null)
    }
    if (to === "open" && current !== null) return
    const next = to === "open" ? (isNarrow() ? "sections" : "general") : to
    const entry: typeof SettingsEntry.Type = { settings: next, session }
    if (current === null || current === "sections") history.pushState(entry, "")
    else history.replaceState(entry, "")
    ctx.setSelf(next)
  },
).pipe(Atom.keepAlive)
