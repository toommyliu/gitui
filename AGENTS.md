# gitui

A git GUI in the spirit of Sublime Merge. A Node server runs git and serves a React client over a WebSocket. An Electron app wraps the same client and starts the server as a child process.

- `apps/web`: React client, built with Vite.
- `apps/server`: Node server that exposes git over RPC.
- `apps/desktop`: Electron shell.
- `packages/git`: runs git and parses its output.
- `packages/contracts`: RPC schemas shared by client and server.

# vp

Use `vp` for every command, not `npm` or `pnpm`. Run `vp run` with no arguments to list every task.

- `vp install` installs dependencies.
- `vp run <task>` runs a root script, e.g. `vp run dev`.
- `vp run <package>#<task>` runs one package's script, e.g. `vp run @gitui/server#bench`.
- `vp check` and `vp dev` are vp built-ins, not the root scripts of the same name. `vp check` formats and lints but skips typecheck and tests. `vp dev` starts Vite without the dev ports or the server, so use `vp run dev`.

# Checks

CI runs `vp run check` on every pull request and push to main. Don't run `vp run check` or `vp run test` unless asked. Before you finish, check only what you changed:

- `vp check --fix` formats and lints the repo. It exits 0 on lint warnings, but CI fails on them, so fix any it prints.
- `vp test related <files>` inside a package runs the tests that import those files.
- `vp run <package>#typecheck` typechecks the package.

# Dev servers

- Other agents run dev servers on this machine at the same time. Work in your own git worktree, not the main checkout.
- `vp run dev` and `vp run dev:desktop` derive ports from the worktree path. Read your URL from the `[dev]` line they print. Don't assume 5173 or 4600.
- Only stop a process you started, by the PID you got when you spawned it. Never `pkill`, `killall`, or kill whatever holds a port.
- When you finish, leave any dev server you started running and respond with its URL and PID.
