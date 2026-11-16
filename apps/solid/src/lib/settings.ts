import * as Schema from "effect/Schema"
import { createSignal } from "solid-js"
import { type DiffThemeId, diffThemeIds } from "./diff-themes"
import { load, save } from "./storage"

export type DiffStyle = "unified" | "split"

const DIFF_STYLE = "gitui.solid.diffStyle"

const [diffStyle, setDiffStyleSignal] = createSignal<DiffStyle>(
  load(DIFF_STYLE, Schema.decodeUnknownSync(Schema.Literals(["unified", "split"])), "unified"),
)

export { diffStyle }

export const toggleDiffStyle = () => {
  const next = diffStyle() === "unified" ? "split" : "unified"
  setDiffStyleSignal(next)
  save(DIFF_STYLE, next)
}

const FILES = "gitui.solid.files"

const [filesOpen, setFilesOpenSignal] = createSignal(load(FILES, Schema.decodeUnknownSync(Schema.Boolean), true))

export { filesOpen }

export const toggleFilesOpen = () => {
  const next = !filesOpen()
  setFilesOpenSignal(next)
  save(FILES, next)
}

const HIDE_TESTS = "gitui.solid.hideTests"

const [hideTests, setHideTestsSignal] = createSignal(load(HIDE_TESTS, Schema.decodeUnknownSync(Schema.Boolean), false))

export { hideTests }

export const toggleHideTests = () => {
  const next = !hideTests()
  setHideTestsSignal(next)
  save(HIDE_TESTS, next)
}

const DIFF_THEME = "gitui.solid.diffTheme"

const [diffTheme, setDiffThemeSignal] = createSignal<DiffThemeId>(
  load(DIFF_THEME, Schema.decodeUnknownSync(Schema.Literals(diffThemeIds)), "pierre"),
)

export { diffTheme }

export const setDiffTheme = (next: DiffThemeId) => {
  setDiffThemeSignal(next)
  save(DIFF_THEME, next)
}

const WRAP = "gitui.solid.wrap"
const IGNORE_WHITESPACE = "gitui.solid.ignoreWhitespace"

const [wrapLines, setWrapLines] = createSignal(load(WRAP, Schema.decodeUnknownSync(Schema.Boolean), false))
const [ignoreWhitespace, setIgnoreWhitespaceSignal] = createSignal(
  load(IGNORE_WHITESPACE, Schema.decodeUnknownSync(Schema.Boolean), false),
)

export { ignoreWhitespace, wrapLines }

export const toggleWrapLines = () => {
  const next = !wrapLines()
  setWrapLines(next)
  save(WRAP, next)
}

export const setIgnoreWhitespace = (next: boolean) => {
  setIgnoreWhitespaceSignal(next)
  save(IGNORE_WHITESPACE, next)
}

export const fetchIntervals = ["off", "5", "15", "30"] as const
export type FetchInterval = (typeof fetchIntervals)[number]

const FETCH = "gitui.solid.backgroundFetch"

const [backgroundFetch, setBackgroundFetchSignal] = createSignal<FetchInterval>(
  load(FETCH, Schema.decodeUnknownSync(Schema.Literals(fetchIntervals)), "15"),
)

export { backgroundFetch }

export const setBackgroundFetch = (next: FetchInterval) => {
  setBackgroundFetchSignal(next)
  save(FETCH, next)
}

const choiceSetting = <const T extends string>(key: string, options: ReadonlyArray<T>, fallback: T) => {
  const [state, setState] = createSignal<{ readonly value: T }>({
    value: load(key, Schema.decodeUnknownSync(Schema.Literals(options)), fallback),
  })
  const set = (next: T) => {
    setState({ value: next })
    save(key, next)
  }
  return [() => state().value, set] as const
}

export const [changeMarkers, setChangeMarkers] = choiceSetting(
  "gitui.solid.changeMarkers",
  ["color", "signs", "both"],
  "color",
)
export const [changeColors, setChangeColors] = choiceSetting(
  "gitui.solid.changeColors",
  ["red-green", "blue-orange"],
  "red-green",
)
export const [diffTextSize, setDiffTextSize] = choiceSetting(
  "gitui.solid.diffTextSize",
  ["small", "medium", "large"],
  "medium",
)
export const [wordDiff, setWordDiff] = choiceSetting("gitui.solid.wordDiff", ["word", "char", "none"], "word")
export const [lineNumbers, setLineNumbers] = choiceSetting("gitui.solid.lineNumbers", ["on", "off"], "on")
export const [dateStyle, setDateStyle] = choiceSetting("gitui.solid.dates", ["relative", "exact"], "relative")
export const [subjectGuide, setSubjectGuide] = choiceSetting("gitui.solid.subjectGuide", ["off", "50", "72"], "72")
export const iconSets = ["minimal", "standard", "complete"] as const
export type IconSet = (typeof iconSets)[number]
export const [fileIcons, setFileIcons] = choiceSetting("gitui.solid.fileIcons", ["off", ...iconSets], "off")
export const [iconColors, setIconColors] = choiceSetting("gitui.solid.iconColors", ["on", "off"], "on")
export const [statusSide, setStatusSide] = choiceSetting("gitui.solid.statusSide", ["left", "right"], "left")
