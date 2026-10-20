import { useAtomValue } from "@effect/atom-react"
import * as Atom from "effect/reactivity/Atom"
import { relativeDate, shortDate } from "./format"
import { settingsAtom } from "./settings"

const minuteAtom = Atom.make((get) => {
  const timer = setInterval(() => get.setSelf(Date.now()), 60_000)
  get.addFinalizer(() => clearInterval(timer))
  return Date.now()
})

export const useHistoryDate = () => {
  const now = useAtomValue(minuteAtom)
  const relative = useAtomValue(settingsAtom).historyDates === "relative"
  return (seconds: number) => (relative ? relativeDate(seconds, now) : shortDate(seconds, now))
}
