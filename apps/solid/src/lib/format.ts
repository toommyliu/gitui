const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
const sameYear = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
const otherYear = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" })
const full = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" })

const DAY = 86_400_000

export const shortDate = (seconds: number, now = Date.now()) => {
  const date = new Date(seconds * 1000)
  const age = now - date.getTime()
  if (age < DAY && new Date(now).getDate() === date.getDate()) return time.format(date)
  if (age < 6 * DAY) return weekday.format(date)
  if (new Date(now).getFullYear() === date.getFullYear()) return sameYear.format(date)
  return otherYear.format(date)
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" })

const units = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
] as const

export const relativeDate = (seconds: number, now = Date.now()) => {
  const age = Math.max(0, Math.round(now / 1000 - seconds))
  const unit = units.find(([, size]) => age >= size)
  return unit === undefined ? relative.format(0, "second") : relative.format(-Math.floor(age / unit[1]), unit[0])
}

export const longDate = (seconds: number) => full.format(new Date(seconds * 1000))

export const shortOid = (oid: string) => oid.slice(0, 7)

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1)

export const dirname = (path: string) => {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? "" : path.slice(0, slash + 1)
}
