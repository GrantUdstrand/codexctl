#!/usr/bin/env node

import { createInterface } from "node:readline";
import { AppServerClient } from "./app-server-client.js";
import { activeTurnId, CodexApi, latestActivity } from "./codex-api.js";
import { formatThread, formatThreads, shortId, statusLabel } from "./format.js";

export function parseArgs(argv) {
  const options = {
    cwd: null,
    json: false,
    includeArchived: true,
    refreshMs: Number(process.env.CODEXCTL_REFRESH_MS ?? 1000),
    command: "dashboard",
    positional: [],
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith("-")) options.command = args.shift();
  while (args.length) {
    const arg = args.shift();
    if (arg === "--cwd") options.cwd = args.shift();
    else if (arg === "--json") options.json = true;
    else if (arg === "--active-only") options.includeArchived = false;
    else if (arg === "--refresh-ms") options.refreshMs = Number(args.shift());
    else if (arg === "--help" || arg === "-h") options.help = true;
    else options.positional.push(arg);
  }
  return options;
}

export function helpText() {
  return `codexctl — a terminal dashboard for Codex App Server

Usage:
  codexctl                         Open the interactive dashboard
  codexctl watch                   Open the live-refreshing dashboard
  codexctl list [--json]           List active and archived threads
  codexctl attach <thread-id>      Resume and inspect a thread
  codexctl resume <thread-id>      Resume a thread
  codexctl fork <thread-id>        Fork a thread
  codexctl interrupt <thread-id> [turn-id]
  codexctl rename <thread-id> <name>
  codexctl archive <thread-id>

Dashboard commands:
  refresh, attach ID, resume ID, fork ID, interrupt ID [TURN]
  rename ID NAME, archive ID, approvals, approve REQUEST accept|decline|cancel
  help, quit

Options:
  --cwd PATH        Only show threads whose working directory matches PATH
  --active-only     Hide archived threads
  --json            Emit machine-readable output for list
  --refresh-ms N    Refresh the dashboard every N milliseconds (default: 1000)
`;
}

export async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    (dependencies.stdout ?? process.stdout).write(helpText());
    return;
  }

  const client = dependencies.client ?? new AppServerClient({ cwd: options.cwd ?? process.cwd() });
  const api = dependencies.api ?? new CodexApi(client);
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const approvals = new Map();

  client.on("serverRequest", (request) => {
    if (request.method.endsWith("/requestApproval")) {
      approvals.set(String(request.id), request);
      stderr.write(`\nApproval requested: ${request.id} (${request.params?.command ?? request.params?.reason ?? request.method})\n`);
      stderr.write("Use `approve REQUEST_ID accept|decline|cancel` in the dashboard.\n");
    }
  });
  client.on("notification", (notification) => {
    if (notification.method === "thread/status/changed") {
      const status = notification.params?.status?.type ?? "unknown";
      stderr.write(`\nThread ${shortId(notification.params?.threadId)} → ${status}\n`);
    }
  });

  await client.connect();
  try {
    if (options.command === "dashboard" || options.command === "watch") {
      await runDashboard({ api, client, options, stdout, stderr, approvals, input: dependencies.stdin ?? process.stdin });
    } else {
      await runCommand(options, { api, client, stdout, stderr, approvals });
    }
  } finally {
    if (options.command !== "dashboard" || dependencies.keepOpen !== true) await client.close();
  }
}

async function runCommand(options, { api, client, stdout, approvals }) {
  const [threadId, ...rest] = options.positional;
  switch (options.command) {
    case "list": {
      const threads = await loadThreads(api, options);
      stdout.write(options.json ? `${JSON.stringify(threads, null, 2)}\n` : `${formatThreads(threads)}\n`);
      return;
    }
    case "attach": {
      const result = await api.resume(threadId);
      stdout.write(`${formatThread(result.thread ?? result)}\n`);
      return;
    }
    case "resume": {
      const result = await api.resume(threadId);
      stdout.write(`Resumed ${threadId}\n${formatThread(result.thread ?? result)}\n`);
      return;
    }
    case "fork": {
      const result = await api.fork(threadId);
      const forked = result.thread ?? result;
      stdout.write(`Forked ${threadId} → ${forked.id ?? "new thread"}\n`);
      return;
    }
    case "interrupt": {
      const thread = await api.readThread(threadId);
      const turnId = rest[0] ?? activeTurnId(thread);
      if (!turnId) throw new Error(`No in-progress turn found for ${threadId}; provide a turn ID.`);
      await api.interrupt(threadId, turnId);
      stdout.write(`Interrupted ${threadId} turn ${turnId}\n`);
      return;
    }
    case "rename": {
      if (!rest.length) throw new Error("Usage: codexctl rename THREAD_ID NAME");
      await api.rename(threadId, rest.join(" "));
      stdout.write(`Renamed ${threadId}\n`);
      return;
    }
    case "archive":
      await api.archive(threadId);
      stdout.write(`Archived ${threadId}\n`);
      return;
    case "approve": {
      const decision = rest[0] ?? "accept";
      const request = approvals.get(String(threadId));
      if (!request) throw new Error(`Approval request ${threadId} is not pending in this codexctl process.`);
      api.approve(request.id, decision);
      approvals.delete(String(threadId));
      stdout.write(`Approval ${threadId}: ${decision}\n`);
      return;
    }
    default:
      throw new Error(`Unknown command: ${options.command}`);
  }
}

async function runDashboard({ api, client, options, stdout, stderr, approvals, input }) {
  let threads = [];
  let attachedThreadId = null;
  let refreshing = false;
  let rendering = false;
  let rl;
  const cache = new Map();

  const refresh = async (force = false) => {
    if (refreshing) return;
    refreshing = true;
    try {
      const summaries = await api.listThreads({ cwd: options.cwd, includeArchived: options.includeArchived });
      threads = await Promise.all(summaries.map(async (summary) => {
        const cached = cache.get(summary.id);
        if (!force && cached && cached.updatedAt === summary.updatedAt && cached.isArchived === summary.isArchived) {
          return cached;
        }
        try {
          const detail = await api.readThread(summary.id);
          const thread = { ...summary, ...detail, isArchived: summary.isArchived };
          cache.set(summary.id, thread);
          return thread;
        } catch {
          cache.set(summary.id, summary);
          return summary;
        }
      }));
      const currentIds = new Set(summaries.map((summary) => summary.id));
      for (const id of cache.keys()) if (!currentIds.has(id)) cache.delete(id);
    } finally {
      refreshing = false;
    }
  };

  const render = async ({ force = false } = {}) => {
    if (rendering) return;
    rendering = true;
    try {
      await refresh(force);
      stdout.write("\n\x1b[2J\x1b[H");
      stdout.write("codexctl — Codex App Server dashboard\n\n");
      stdout.write(`${formatThreads(threads)}\n\n`);
      stdout.write(`live refresh: every ${options.refreshMs}ms  pending approvals: ${approvals.size}${attachedThreadId ? `  attached: ${shortId(attachedThreadId)}` : ""}\n`);
      stdout.write("Commands: attach ID | resume ID | fork ID | interrupt ID [TURN] | rename ID NAME | archive ID | approvals | approve REQUEST DECISION | refresh | help | quit\n");
      if (rl) rl.prompt(true);
    } finally {
      rendering = false;
    }
  };

  await render({ force: true });
  rl = createInterface({ input, output: stdout, terminal: Boolean(input.isTTY && stdout.isTTY), prompt: "codexctl> " });
  rl.prompt();
  const timer = setInterval(() => {
    render().catch((error) => stderr.write(`Refresh error: ${error.message}\n`));
  }, Math.max(100, options.refreshMs || 1000));
  try {
    for await (const line of rl) {
      const command = line.trim();
      if (!command) {
        rl.prompt();
        continue;
      }
      if (command === "quit" || command === "exit" || command === "q") break;
      try {
        if (command === "help") stdout.write(`\n${helpText()}\n`);
        else if (command === "refresh") await render({ force: true });
        else if (command === "approvals") {
          for (const [id, request] of approvals) stdout.write(`${id}: ${request.params?.command ?? request.params?.reason ?? request.method}\n`);
        } else {
          const parsed = parseArgs(command.split(/\s+/));
          if (["attach", "resume", "fork", "interrupt", "rename", "archive"].includes(parsed.command)) {
            parsed.positional[0] = resolveThreadId(parsed.positional[0], threads);
          }
          if (parsed.command === "attach") attachedThreadId = parsed.positional[0];
          if (parsed.command === "approve") {
            const requestId = parsed.positional[0];
            const decision = parsed.positional[1] ?? "accept";
            const request = approvals.get(String(requestId));
            if (!request) throw new Error(`Approval request ${requestId} is not pending.`);
            client.respond(request.id, { decision });
            approvals.delete(String(requestId));
            stdout.write(`Approval ${requestId}: ${decision}\n`);
          } else {
            await runCommand(parsed, { api, client, stdout, stderr, approvals });
          }
          await render({ force: true });
        }
      } catch (error) {
        stderr.write(`Error: ${error.message}\n`);
      }
      rl.prompt();
    }
  } finally {
    clearInterval(timer);
    rl.close();
  }
}

async function loadThreads(api, options, { hydrate = false } = {}) {
  const threads = await api.listThreads({ cwd: options.cwd, includeArchived: options.includeArchived });
  if (!hydrate) return threads;
  return await Promise.all(threads.map(async (thread) => {
    try {
      return { ...thread, ...(await api.readThread(thread.id)) };
    } catch {
      return thread;
    }
  }));
}

export function resolveThreadId(value, threads) {
  if (!value) throw new Error("A thread ID is required.");
  const exact = threads.find((thread) => thread.id === value);
  if (exact) return exact.id;
  const matches = threads.filter((thread) => thread.id.startsWith(value));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) throw new Error(`Thread prefix ${value} is ambiguous.`);
  throw new Error(`No thread matches ${value}. Run refresh and try again.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    process.stderr.write(`codexctl: ${error.message}\n`);
    process.exitCode = 1;
  });
}
