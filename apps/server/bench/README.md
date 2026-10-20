# Bench

`pnpm bench` times the git operations the UI triggers. It replays the same RPCs the client sends, over a WebSocket, to the real server running in-process. After each mutation it also does what the client does. It refetches status, refs and the first log page, and restarts that refetch whenever a watch event arrives mid-flight.

```sh
pnpm bench                                  # 5 rounds of every scenario on this checkout
pnpm bench --only remove-worktree,refs      # a subset
pnpm bench --base main                      # A/B against another ref, rounds alternate base/head
pnpm bench --compare old.json new.json      # compare two saved runs
```

Other flags are `--rounds`, `--trials` (samples per scenario per round) and `--ballast`.

## What a row means

- `rpc` is the time from sending the request to getting the response.
- `settled` adds the client's refetch. It ends when a refetch finishes without a watch event interrupting it, which is when the UI shows the new state.
- `events` counts watch events from the start of the op until 300ms of quiet. Each one costs the client another refetch.
- `restarts` counts refetches a watch event interrupted.
- The indented lines are the git commands the server ran during the op for the median sample, with start offset and duration. They come from the server's own command log.

A comparison says `within spread` when the base and head ranges overlap. Treat that as no measurable difference.

## Fixture

The first run clones git/git into `~/.cache/gitui-bench` (override with `GITUI_BENCH_CACHE`) and builds a template pinned to v2.47.0. The template has 954 tags, an `origin` remote, 17 local branches tracking `origin/master`, 2 stashes and a commit-graph. Every round copies the template into a temp dir, so rounds never share state and never touch your repos. Worktrees get `--ballast` ignored files under `node_modules/` (default 30000, about what a pnpm install leaves in this repo's worktrees). The fixture then waits until the worktree's files are over a second older than its index and refreshes the index. Without that, git treats every file as racily clean and `git status` there re-hashes all of them, which a worktree made a while ago wouldn't do. Git runs with `GIT_CONFIG_GLOBAL` pointed at an empty file, so your global config doesn't change the numbers.

Each round runs in a fresh process. `--base` clones the ref into `~/.cache/gitui-bench/checkouts/<sha>` and runs `pnpm install` there once. Before each run it copies this checkout's `bench/` over the base's, so both sides measure with the same code and `--base` works with refs from before the bench existed. Results go to `~/.cache/gitui-bench/results/`.

## Adding a scenario

Add an entry to `scenarios.ts`. `setup` prepares the fixture with plain git and runs outside the timed window. `run` sends the RPCs being measured. `verify` throws if the op didn't do its job, so a fast failure can't pass as a fast success.
