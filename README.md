# gitui

A git GUI in the spirit of Sublime Merge. A Node server runs git and serves a React client, which talks to it over a WebSocket.

## Running it

```sh
pnpm install
pnpm serve
```

`pnpm serve` builds the web app and starts the server. The repo picker also opens any absolute path you type.

| Variable     | Default     | Meaning                                                          |
| ------------ | ----------- | ---------------------------------------------------------------- |
| `HOST`       | `127.0.0.1` | Address to bind                                                  |
| `PORT`       | `4600`      | Port to bind                                                     |
| `REPO_ROOTS` | none        | `:`-separated directories whose repositories the picker suggests |

Anyone who can reach the port can run git in any directory the server's user can read. Bind it to a private address.

## Layout

| Path                         | What it holds                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `packages/contracts`         | Effect Schema domain types and the RPC group shared by server and client           |
| `packages/git`               | git runner, NUL-delimited output parsers, commit graph layout, repo service        |
| `apps/server`                | RPC handlers, file watcher, static file serving                                    |
| `apps/web`                   | React client: tabs, locations sidebar, commit graph, commit and working-copy views |
| `apps/web/src/components/ui` | shadcn components (base-ui, mira preset)                                           |

## Performance

- The server streams `git log --topo-order` and lays out the graph as commits arrive. The client fetches 200-row pages for the rows on screen.
- Every list is virtualized: commits, sidebar refs, changed files. Pierre's `CodeView` virtualizes diffs and highlights code in a worker pool.
- Whole-commit patches over 4 MB fall back to a file list, and each file's diff is fetched on demand.
- Reads run with `GIT_OPTIONAL_LOCKS=0`, so the client never competes with another git process for `index.lock`. A filesystem watcher invalidates only the affected queries, at most every 120 ms.

## Checks

`pnpm check` runs oxfmt, oxlint with the Effect language service rules, `tsc` on TypeScript 7, and the vitest suite. The pre-commit hook runs it too. The git tests build real repositories in temp directories.
