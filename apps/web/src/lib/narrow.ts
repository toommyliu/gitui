import { useSyncExternalStore } from "react"

const narrowQuery = window.matchMedia("(max-width: 767px)")

export const isNarrow = () => narrowQuery.matches

export const useNarrow = () =>
  useSyncExternalStore((notify) => {
    narrowQuery.addEventListener("change", notify)
    return () => narrowQuery.removeEventListener("change", notify)
  }, isNarrow)
