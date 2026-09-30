# codexctl

`codexctl` is a small, dependency-free terminal dashboard for managing local
Codex App Server threads. It is intentionally an MVP: it uses the installed
`codex` executable as the App Server host and keeps the UI in the terminal.

## Requirements

- Node.js 20 or newer
- Codex CLI installed and authenticated (`codex login`)
- A Git checkout is recommended, but the tool can inspect threads from any
  working directory visible to Codex

## Run it

From this directory:

```sh
npm test
node src/cli.js
```

To make the command available as `codexctl` while developing:

```sh
npm link
codexctl
```

The client starts `codex app-server --stdio`, performs the App Server
handshake, and then talks JSON-RPC over the child process's standard input and
output. It uses the same local Codex authentication and configuration as the
installed CLI.

## Commands

```text
codexctl                         interactive dashboard
codexctl list                    active and archived threads
codexctl list --json             machine-readable thread summaries
codexctl attach THREAD_ID        resume and inspect a thread
codexctl resume THREAD_ID        resume a thread
codexctl fork THREAD_ID          fork a thread
codexctl interrupt THREAD_ID [TURN_ID]
codexctl rename THREAD_ID NAME
codexctl archive THREAD_ID
```

The dashboard refreshes the active and archived thread lists, hydrates the
thread history needed for latest-activity display, and shows runtime status
including `waitingOnApproval` and `waitingOnUserInput` flags.

The dashboard is live by default: it refreshes every second while keeping the
command prompt available. Use `codexctl watch` for the explicit live-dashboard
command, or override the interval with `--refresh-ms N` or the
`CODEXCTL_REFRESH_MS` environment variable.

Inside the dashboard, use `refresh`, `attach ID`, `resume ID`, `fork ID`,
`interrupt ID [TURN]`, `rename ID NAME`, `archive ID`, `approvals`, or
`approve REQUEST_ID accept|decline|cancel`. Press `quit` or `Ctrl-D` to exit.

Approval requests are connection-scoped App Server callbacks. They appear in
the dashboard while the associated Codex turn is running; an approval request
cannot be approved later by starting a separate `codexctl approve` process.

`notLoaded` is a normal runtime status for a persisted thread that is not
currently loaded in memory. It is not a deletion candidate by itself, so
`codexctl` does not purge those threads automatically. Use `archive` to remove
a thread from the active list while preserving its history; permanent deletion
should be an explicit, separately confirmed operation.

Use `--cwd PATH` to filter threads to an exact working directory, and
`--active-only` to omit archived threads.

## Architecture

- `src/app-server-client.js` implements a small JSON-RPC-over-stdio client and
  handles server-initiated approval requests.
- `src/codex-api.js` maps dashboard actions to App Server thread methods and
  extracts latest activity from persisted turn items.
- `src/format.js` renders the terminal table and thread details.
- `src/cli.js` provides the interactive dashboard and one-shot commands.
- `test/` covers protocol handshaking, approval responses, thread pagination,
  lifecycle operations, and table rendering.

The implementation targets the stable App Server lifecycle methods and opts
into the protocol's experimental capability flag so current Codex servers can
return their complete thread metadata. If the App Server protocol changes,
the installed `codex` version is the source of truth.
