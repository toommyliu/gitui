import { longDate, relativeDate, shortDate } from "./format"
import { dateStyle } from "./settings"

export const detailDate = (seconds: number) => (dateStyle() === "relative" ? relativeDate(seconds) : longDate(seconds))

export const listDate = (seconds: number) => (dateStyle() === "relative" ? relativeDate(seconds) : shortDate(seconds))
