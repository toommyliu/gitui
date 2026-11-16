# @gitui/solid

The Solid 2 client. It talks to the server over the RPC contracts in `packages/contracts`.

- Solid is pinned to `2.0.0-rc.14` with UI SDK's patch for `@solidjs/web` (`patches/`). Raise it only together with `@ui-sdk/solid`'s tested range.
- Before using ui-sdk, read `node_modules/@ui-sdk/solid/docs/llms.txt`, then only the component pages you need under `docs/components/`. To build a component ui-sdk doesn't ship, search `docs/core.md` by heading.
- Solid 2 docs ship in `node_modules/solid-js/skills/` and its diagnostics guide names every dev warning.

## Layout

- `src/lib/rpc.ts`: the Effect RPC client. `call` for requests, `collect` and `subscribe` for streams.
- `src/lib/repo.ts`: one store per open repo. `track(...scopes)` inside a memo makes it refetch when the server's watcher or `invalidate` bumps those scopes.
- `src/lib/workspaces.ts`: open repos, the active one, and each repo's view and whether its list is hidden (`focused`).
- `src/lib/settings.ts`: persisted UI settings (diff layout, file list, hide tests, code-only counts). `src/lib/theme.ts` owns the theme and syncs it with the desktop menu.
- `src/components/files-pane.tsx`: the file tree beside a diff, shared by History, Branches and Stashes.
- `src/lib/hotkeys.ts`: every shortcut. A chord is a typed string, so a typo fails the build.
- `src/components/diff.tsx`: `DiffStack` wraps `@pierre/diffs`' plain `CodeView`.

## UI rules

- Build from `src/components/ui.tsx`: `Button`, `Bar`, `Kbd`, `Count`, `Empty`, `Alert`, `Tip`, `CopyHash`, and `ROW` for every row height. Don't add a second button, toolbar or alert style.
- No native `title`. Use `Tip` when a hint adds something, like a shortcut or the label of an icon-only button; otherwise show nothing.
- Prefer feedback where the action happened: `CopyHash` turns into a check, and a failure shows as an `Alert` next to what failed (`Failures` under a toolbar). When feedback doesn't fit neatly inline, a toast is fine. A success that the UI already shows, like counts updating, needs no message.
- Alerts tint their background with their tone: error, warning, success, info.
- Nothing overscrolls: `html`, `body` and `#root` set `overscroll-behavior: none`. Never set it on `*`: truncated text is `overflow: hidden`, which makes it a scroll container, and the wheel then stops at it instead of reaching the list.
- Search and filter fields are `SearchBar`: a flush, square, full-width row under a toolbar, never a rounded input inside one.
- Icons only where they carry meaning. ui-sdk parts are styled in `src/skin.css`, not `@ui-sdk/core/web.css`.
- The window's top bar holds, from the left: the list toggle (⌘B, never moves), the repo switcher (`repo-switcher.tsx`), then whatever the active view puts there with `TopBar`. There is no repository sidebar.
- Every view stays mounted after its first visit, hidden. Register shortcuts with `useCommand`; `CommandScope` makes them fire only in the visible view of the active repo.
- Lists, trees and diffs never overscroll.

## Rules that bit us

- Create an async memo above the `Loading` boundary of any component that reads it while setting up. ui-sdk parts read some props at setup, so a pending value there rebuilds the whole branch and the memo restarts forever.
- JSX passed through a prop other than `children` is a getter that rebuilds on every read. Read it through `children(() => props.slot)` once.
- Writes from event handlers and stream callbacks are fine. Writes inside a memo or an effect's compute half throw in development.
- `tabindex`, `class={[...]}` and camelCase `onClick` are the 2.0 spellings.

## Checks

- `vp run @gitui/solid#typecheck`
- `vp check --fix` from the repo root.
