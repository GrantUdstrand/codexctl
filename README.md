# codexctl

`codexctl` is a small terminal dashboard for managing local
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
codexctl ui                      mouse-enabled session cockpit
codexctl watch                   live session cockpit
codexctl list                    active and archived threads
codexctl list --json             machine-readable thread summaries
codexctl attach THREAD_ID        resume and inspect a thread
codexctl observe THREAD_ID       read-only live view; does not become the writer
codexctl resume THREAD_ID        resume a thread
codexctl fork THREAD_ID          fork a thread
codexctl interrupt THREAD_ID [TURN_ID]
codexctl compact THREAD_ID
codexctl rename THREAD_ID NAME
codexctl archive THREAD_ID
codexctl clear THREAD_ID
codexctl clear THREAD_ID --archive --confirm
codexctl clear THREAD_ID --delete --confirm
codexctl purge --dry-run
codexctl purge --older-than 7d --dry-run
codexctl purge --older-than 7d --delete --confirm
codexctl purge --archive --confirm
codexctl purge --delete --confirm
```

The dashboard refreshes the active and archived thread lists, hydrates the
thread history needed for latest-activity display, and shows runtime status
including `waitingOnApproval` and `waitingOnUserInput` flags.

The dashboard is live by default: it refreshes every second while keeping the
command prompt available. Use `codexctl watch` for the explicit live-dashboard
command, or override the interval with `--refresh-ms N` or the
`CODEXCTL_REFRESH_MS` environment variable.

When run from a real terminal, the dashboard opens as a two-pane cockpit. Use
the mouse or arrow keys to select a session. Sessions are grouped into
`ACTIVE` and `INACTIVE` sections; PageUp/PageDown moves through the grouped
list without losing your place during refreshes. They are grouped by the
repository origin by default, so all Occam worktrees appear under `Occam`.
A single click or Enter attaches the highlighted session; type a reply in the
composer, and press Escape to detach. Detaching unsubscribes the
dashboard from that thread without interrupting its Codex turn, so you can
move on while it continues in the background. Press Tab to cycle through the
session list, transcript pane, and reply box (the reply box is skipped in
observer mode). Scroll the transcript with PageUp/PageDown or the arrow keys.
Press `m` to start manual compaction for the
highlighted session. Press `o` to observe the highlighted session read-only;
observer mode polls `thread/read` and never resumes or writes to the session.
Press `g` to toggle between project-grouped and global active/inactive views.
Piped/non-TTY invocations keep the plain readline
dashboard for scripting and smoke tests.

When an approval arrives, focus the session list and press `a` to accept, `d`
to decline, or `c` to cancel. These shortcuts are disabled while typing in the
reply box.

Inside the dashboard, use `refresh`, `attach ID`, `resume ID`, `fork ID`,
`observe ID`, `interrupt ID [TURN]`, `rename ID NAME`, `archive ID`, `approvals`, or
`approve REQUEST_ID accept|decline|cancel`. Press `quit` or `Ctrl-D` to exit.

For a separate live read-only terminal view, use:

```sh
codexctl observe THREAD_ID
```

This polls the saved thread state and does not call `thread/resume`, so another
Codex client can remain the writer. Press Ctrl-C to leave observer mode.

To clear one session from the command line, `clear` first shows a dry-run
preview and makes no changes. Use `--archive --confirm` to remove it from the
active list while preserving history, or `--delete --confirm` and type `DELETE`
to permanently remove its stored history:

```sh
codexctl clear THREAD_ID
codexctl clear THREAD_ID --archive --confirm
codexctl clear THREAD_ID --delete --confirm
```

Approval requests are connection-scoped App Server callbacks. They appear in
the dashboard while the associated Codex turn is running; an approval request
cannot be approved later by starting a separate `codexctl approve` process.

`notLoaded` is a normal runtime status for a persisted thread that is not
currently loaded in memory. It is not a deletion candidate by itself, so
`codexctl` does not purge those threads automatically. Use `archive` to remove
a thread from the active list while preserving its history; permanent deletion
should be an explicit, separately confirmed operation.

To review matching threads without changing anything:

```sh
codexctl purge --dry-run
```

To archive them, preserving history:

```sh
codexctl purge --archive --confirm
```

To permanently delete them, including archived matches, use the separate
destructive mode. It prints the same candidate list and then requires both
`--confirm` and typing `DELETE` at the prompt:

```sh
codexctl purge --delete --confirm
```

For age-based cleanup, use `--older-than` with a duration such as `7d`, `1w`,
or `24h`. Age cleanup considers all matching active and archived sessions but
automatically excludes sessions currently marked active or writing. If a
writer starts after the preview, that individual session is skipped and the
rest of the cleanup continues.

```sh
codexctl purge --older-than 7d --dry-run
codexctl purge --older-than 7d --delete --confirm
```

Use `--active-only` with any of these commands to exclude archived threads
from the candidate list.

Use `--cwd PATH` to filter threads to an exact working directory, and
`--active-only` to omit archived threads.

## Architecture

- `src/app-server-client.js` implements a small JSON-RPC-over-stdio client and
  handles server-initiated approval requests.
- `src/codex-api.js` maps dashboard actions to App Server thread methods and
  extracts latest activity from persisted turn items.
- `src/format.js` renders the terminal table and thread details.
- `src/tui.js` provides the mouse-enabled two-pane session cockpit.
- `src/cli.js` provides the dashboard fallback and one-shot commands.
- `test/` covers protocol handshaking, approval responses, thread pagination,
  lifecycle operations, and table rendering.

The implementation targets the stable App Server lifecycle methods and opts
into the protocol's experimental capability flag so current Codex servers can
return their complete thread metadata. If the App Server protocol changes,
the installed `codex` version is the source of truth.
