import blessed from "blessed";
import { activeTurnId, extractText } from "./codex-api.js";
import { formatTimestamp, shortId, statusLabel, threadTitle } from "./format.js";

export function formatTranscript(thread) {
  const turns = thread?.turns ?? [];
  if (!turns.length) return "No transcript available. Attach this session and send a reply to start a turn.";

  const lines = [];
  for (const turn of turns) {
    for (const item of turn.items ?? []) {
      const text = extractText(item);
      if (!text) continue;
      const label = item.type === "userMessage"
        ? "You"
        : item.type === "agentMessage"
          ? "Codex"
          : item.type ?? "Activity";
      lines.push(`${label}\n${text}`);
    }
    if (turn.error?.message) lines.push(`Error\n${turn.error.message}`);
  }
  return lines.length ? lines.join("\n\n") : "No transcript items recorded.";
}

export async function runTui({ api, client, options, approvals }) {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: "codexctl — Codex sessions",
  });
  screen.enableMouse();

  const sessionList = blessed.list({
    parent: screen,
    top: 0,
    left: 0,
    width: "35%",
    bottom: 3,
    label: " Sessions ",
    border: "line",
    keys: true,
    vi: true,
    mouse: true,
    tags: false,
    style: {
      selected: { fg: "black", bg: "cyan" },
      item: { fg: "white" },
      border: { fg: "blue" },
      label: { fg: "cyan" },
    },
  });
  const transcript = blessed.box({
    parent: screen,
    top: 0,
    left: "35%",
    right: 0,
    bottom: 3,
    label: " Session ",
    border: "line",
    tags: false,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    scrollbar: { ch: " ", track: { bg: "gray" }, style: { inverse: true } },
    style: { border: { fg: "green" }, label: { fg: "green" } },
  });
  const composer = blessed.textbox({
    parent: screen,
    left: "35%",
    right: 0,
    bottom: 1,
    height: 2,
    label: " Reply — Tab to focus, Enter to send ",
    border: "line",
    inputOnFocus: true,
    keys: true,
    mouse: true,
    tags: false,
    style: { border: { fg: "yellow" }, label: { fg: "yellow" } },
  });
  const footer = blessed.box({
    parent: screen,
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    tags: false,
    style: { fg: "white", bg: "blue" },
  });

  let threads = [];
  let selectedId = null;
  let attachedId = null;
  let refreshing = false;
  let closed = false;
  let statusMessage = "Loading sessions…";
  const cache = new Map();

  const render = () => {
    if (closed) return;
    const selected = threads.find((thread) => thread.id === selectedId) ?? null;
    sessionList.setItems(threads.map((thread) => sessionLabel(thread, attachedId)));
    const selectedIndex = threads.findIndex((thread) => thread.id === selectedId);
    if (selectedIndex >= 0) sessionList.select(selectedIndex);
    transcript.setLabel(` ${selected ? threadTitle(selected) : "No session selected"} `);
    transcript.setContent(selected ? formatTranscript(selected) : "Select a session to inspect it.");
    composer.setLabel(` ${attachedId ? "Reply — Enter to send" : "Reply — attach a session first"} `);
    footer.setContent(`${statusMessage}  |  ${attachedId ? `attached ${shortId(attachedId)}` : "detached"}  |  approvals ${approvals.size}  |  Click/Enter attach  Tab switch  Esc detach  Ctrl-C quit`);
    screen.render();
  };

  const refresh = async (force = false) => {
    if (refreshing || closed) return;
    refreshing = true;
    try {
      const summaries = await api.listThreads({ cwd: options.cwd, includeArchived: options.includeArchived });
      const next = await Promise.all(summaries.map(async (summary) => {
        const cached = cache.get(summary.id);
        if (!force && cached && cached.updatedAt === summary.updatedAt && cached.isArchived === summary.isArchived) return cached;
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
      threads = next;
      const ids = new Set(next.map((thread) => thread.id));
      for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
      if (!selectedId || !ids.has(selectedId)) selectedId = next[0]?.id ?? null;
      statusMessage = `${next.length} session${next.length === 1 ? "" : "s"} · refreshed ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      statusMessage = `Refresh error: ${error.message}`;
    } finally {
      refreshing = false;
      render();
    }
  };

  const detach = async () => {
    const id = attachedId;
    attachedId = null;
    composer.clearValue();
    sessionList.focus();
    if (id) {
      try {
        await api.unsubscribe(id);
        statusMessage = `Detached from ${shortId(id)}; session continues in the background.`;
      } catch (error) {
        statusMessage = `Detached locally; unsubscribe failed: ${error.message}`;
      }
    }
    render();
  };

  const attach = async (thread) => {
    if (!thread) return;
    selectedId = thread.id;
    if (attachedId === thread.id) {
      composer.focus();
      render();
      return;
    }
    if (attachedId) await detach();
    try {
      await api.resume(thread.id);
      attachedId = thread.id;
      composer.focus();
      statusMessage = `Attached to ${shortId(thread.id)}.`;
      await refresh(true);
    } catch (error) {
      statusMessage = `Attach failed: ${error.message}`;
      render();
    }
  };

  const send = async (value) => {
    const text = String(value ?? "").trim();
    if (!text) return;
    if (!attachedId) {
      statusMessage = "Attach a session before sending a reply.";
      composer.clearValue();
      render();
      return;
    }
    const thread = cache.get(attachedId) ?? threads.find((item) => item.id === attachedId);
    try {
      const turnId = activeTurnId(thread);
      if (turnId) await api.steer(attachedId, text, turnId);
      else await api.startTurn(attachedId, text);
      composer.clearValue();
      statusMessage = `Sent to ${shortId(attachedId)}.`;
      await refresh(true);
      composer.focus();
    } catch (error) {
      statusMessage = `Send failed: ${error.message}`;
      render();
    }
  };

  const onNotification = (notification) => {
    const threadId = notification.params?.threadId;
    if (threadId) cache.delete(threadId);
    if (threadId === attachedId || notification.method === "thread/status/changed") {
      statusMessage = `${notification.method.replaceAll("/", " ")} · ${threadId ? shortId(threadId) : ""}`.trim();
      refresh().catch(() => {});
    }
  };
  const onServerRequest = (request) => {
    const threadId = request.params?.threadId;
    statusMessage = `${request.method.endsWith("/requestApproval") ? "Approval" : "Input"} requested${threadId ? ` for ${shortId(threadId)}` : ""}.`;
    render();
  };

  const respondToApproval = (decision) => {
    if (screen.focused === composer) return;
    const request = [...approvals.values()].find((item) => !attachedId || item.params?.threadId === attachedId)
      ?? approvals.values().next().value;
    if (!request) {
      statusMessage = "No pending approval request.";
      render();
      return;
    }
    client.respond(request.id, { decision });
    approvals.delete(String(request.id));
    statusMessage = `Approval ${decision}.`;
    render();
  };

  client.on("notification", onNotification);
  client.on("serverRequest", onServerRequest);
  sessionList.on("select", (_item, index) => {
    attach(threads[index]).catch((error) => {
      statusMessage = `Attach failed: ${error.message}`;
      render();
    });
  });
  composer.on("submit", (value) => {
    send(value).catch((error) => {
      statusMessage = `Send failed: ${error.message}`;
      render();
    });
  });
  composer.key("escape", () => detach());
  transcript.on("click", () => {
    if (attachedId) composer.focus();
  });

  const timer = setInterval(() => refresh(), Math.max(500, options.refreshMs || 1000));
  let close;
  const done = new Promise((resolve) => {
    close = async () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      client.off("notification", onNotification);
      client.off("serverRequest", onServerRequest);
      if (attachedId) {
        try { await api.unsubscribe(attachedId); } catch { /* closing */ }
      }
      screen.destroy();
      resolve();
    };
  });
  screen.key("tab", () => {
    if (screen.focused === composer) sessionList.focus();
    else composer.focus();
    screen.render();
  });
  screen.key("a", () => respondToApproval("accept"));
  screen.key("d", () => respondToApproval("decline"));
  screen.key("c", () => respondToApproval("cancel"));
  screen.key("escape", () => {
    if (attachedId) detach();
    else sessionList.focus();
  });
  screen.key(["C-c", "C-q"], () => close());
  screen.on("resize", () => render());

  await refresh(true);
  sessionList.focus();
  return done;
}

function sessionLabel(thread, attachedId) {
  const marker = attachedId === thread.id ? "▶" : thread.isArchived ? "·" : thread.status?.type === "active" ? "●" : "○";
  const age = formatTimestamp(thread.updatedAt);
  return `${marker} ${shortId(thread.id)} ${threadTitle(thread)} · ${statusLabel(thread)} · ${age}`;
}
