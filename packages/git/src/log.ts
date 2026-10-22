import { allRefsVisible, type RefVisibility } from "@gitui/contracts"

const excludes = (hidden: ReadonlyArray<string>) =>
  hidden.flatMap((name) => [`--exclude=${name}`, `--exclude=${name}/*`])

export const logRevArgs = (
  hasHead: boolean,
  refs: RefVisibility = allRefsVisible,
  stashes: ReadonlyArray<string> = [],
) => [
  ...(hasHead ? ["HEAD"] : []),
  ...(refs.branches ? excludes(refs.hiddenBranches) : ["--exclude=*"]),
  "--branches",
  ...(refs.remotes ? [...excludes(refs.hiddenRemotes), "--remotes"] : []),
  ...(refs.tags ? ["--tags"] : []),
  ...stashes,
]

export interface StashCommit {
  readonly oid: string
  readonly parents: ReadonlyArray<string>
}

export const stashParentsArgs = ["stash", "list", "--format=%H %P"]

export const parseStashParents = (text: string): Array<StashCommit> =>
  text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [oid = "", ...parents] = line.split(" ")
      return { oid, parents }
    })

export interface LogQuery {
  readonly words: ReadonlyArray<string>
  readonly authors: ReadonlyArray<string>
  readonly paths: ReadonlyArray<string>
}

export const parseLogQuery = (query: string): LogQuery => {
  const words: Array<string> = []
  const authors: Array<string> = []
  const paths: Array<string> = []
  for (const [, key, quoted, bare] of query.matchAll(/(?:(author|path):)?(?:"([^"]*)"?|(\S+))/g)) {
    const value = quoted ?? bare ?? ""
    if (value === "") continue
    if (key === "author") authors.push(value)
    else if (key === "path") paths.push(value.replace(/^\.?\//, ""))
    else words.push(value)
  }
  return { words, authors, paths }
}

export const isEmptyQuery = (query: LogQuery) =>
  query.words.length === 0 && query.authors.length === 0 && query.paths.length === 0

export const shaCandidate = (query: LogQuery) =>
  query.authors.length === 0 &&
  query.paths.length === 0 &&
  query.words.length === 1 &&
  /^[0-9a-f]{4,40}$/i.test(query.words[0]!)
    ? query.words[0]!
    : undefined

export const hasGraph = (query: LogQuery) => query.words.length === 0 && query.authors.length === 0

const filterArgs = (query: LogQuery) => [
  ...(query.paths.length > 0 && hasGraph(query) ? ["--parents"] : []),
  ...(query.words.length + query.authors.length > 0 ? ["--regexp-ignore-case", "--fixed-strings"] : []),
  ...(query.words.length > 1 ? ["--all-match"] : []),
  ...query.words.map((word) => `--grep=${word}`),
  ...query.authors.map((author) => `--author=${author}`),
]

export const logArgs = (revs: ReadonlyArray<string>, query: LogQuery) => [
  "log",
  "-z",
  "--topo-order",
  "--format=%H%x00%P%x00%an%x00%at%x00%s",
  ...filterArgs(query),
  ...revs,
  "--",
  ...query.paths,
]
