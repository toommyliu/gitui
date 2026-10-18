# gitui

A git GUI in the spirit of Sublime Merge. A Node server runs git and serves a React client over a WebSocket. An Electron app wraps the same client and starts the server as a child process.

- `apps/web`: React client, built with Vite.
- `apps/server`: Node server that exposes git over RPC.
- `apps/desktop`: Electron shell.
- `packages/git`: runs git and parses its output.
- `packages/contracts`: RPC schemas shared by client and server.

Run `pnpm check` before you finish. It runs format, lint, typecheck and tests.

# Dev servers

- Other agents run dev servers on this machine at the same time. Work in your own git worktree, not the main checkout.
- `pnpm dev` and `pnpm dev:desktop` derive ports from the worktree path. Read your URL from the `[dev]` line they print. Don't assume 5173 or 4600.
- Only stop a process you started, by the PID you got when you spawned it. Never `pkill`, `killall`, or kill whatever holds a port.
