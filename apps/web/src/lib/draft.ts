import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import * as Exit from "effect/Exit"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { draftAtom, latest, saveDraftAtom } from "./git"

const SAVE_DELAY_MS = 400

const legacyKey = (repo: RepoId) => `gitui.draft:${repo}`

export const useDraft = (repo: RepoId) => {
  const server = latest(useAtomValue(draftAtom(repo)))
  const save = useAtomSet(saveDraftAtom, { mode: "promiseExit" })
  const [message, setMessage] = useState("")
  const saved = useRef<string | undefined>(undefined)
  const seen = useRef<string | undefined>(undefined)
  const editing = useRef(false)
  const latestMessage = useRef(message)

  const persist = useCallback(
    (next: string) => {
      if (saved.current === undefined || next === saved.current) return
      saved.current = next
      void save({ repo, message: next }).then((exit) => {
        if (Exit.isFailure(exit)) toast.error("Couldn't save the commit message draft")
      })
    },
    [repo, save],
  )

  useEffect(() => {
    latestMessage.current = message
  }, [message])

  useEffect(() => {
    if (server === undefined || server === seen.current) return
    const first = seen.current === undefined
    seen.current = server
    if (first) {
      const legacy = localStorage.getItem(legacyKey(repo))
      localStorage.removeItem(legacyKey(repo))
      saved.current = server
      setMessage(server === "" && legacy !== null ? legacy : server)
      return
    }
    if (editing.current) return
    saved.current = server
    setMessage(server)
  }, [repo, server])

  useEffect(() => {
    const timer = setTimeout(() => persist(message), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [message, persist])

  useEffect(() => () => persist(latestMessage.current), [persist])

  return {
    message,
    setMessage,
    onFocus: () => {
      editing.current = true
    },
    onBlur: () => {
      editing.current = false
      persist(latestMessage.current)
    },
    clear: () => {
      saved.current = ""
      setMessage("")
    },
  }
}
