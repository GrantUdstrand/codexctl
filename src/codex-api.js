export class CodexApi {
  constructor(client) {
    this.client = client;
  }

  async listThreads({ cwd = null, includeArchived = true, limit = 100 } = {}) {
    const groups = includeArchived ? [false, true] : [false];
    const results = await Promise.all(groups.map((archived) => this.#listThreadGroup({ archived, cwd, limit })));
    return results.flat().sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  }

  async #listThreadGroup({ archived, cwd, limit }) {
    const threads = [];
    let cursor = null;
    do {
      const result = await this.client.request("thread/list", {
        archived,
        cwd,
        cursor,
        limit,
        sortKey: "updated_at",
        sortDirection: "desc",
      });
      for (const thread of result?.data ?? []) {
        threads.push({ ...thread, isArchived: archived });
      }
      cursor = result?.nextCursor ?? null;
    } while (cursor);
    return threads;
  }

  async readThread(threadId, { includeTurns = true } = {}) {
    const result = await this.client.request("thread/read", { threadId, includeTurns });
    return result?.thread ?? result;
  }

  resume(threadId, options = {}) {
    return this.client.request("thread/resume", { threadId, ...options });
  }

  fork(threadId, options = {}) {
    return this.client.request("thread/fork", { threadId, ...options });
  }

  interrupt(threadId, turnId) {
    return this.client.request("turn/interrupt", { threadId, turnId });
  }

  rename(threadId, name) {
    return this.client.request("thread/name/set", { threadId, name });
  }

  archive(threadId) {
    return this.client.request("thread/archive", { threadId });
  }

  approve(requestId, decision = "accept") {
    this.client.respond(requestId, { decision });
  }
}

export function latestActivity(thread) {
  const turns = thread?.turns ?? [];
  const lastTurn = turns.at(-1);
  const items = lastTurn?.items ?? [];
  const lastItem = items.at(-1);
  const text = extractText(lastItem);
  if (text) return compact(text);
  if (lastTurn?.error?.message) return compact(lastTurn.error.message);
  return compact(thread?.preview || "No activity recorded");
}

export function extractText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join(" ");
  if (typeof value !== "object") return "";

  for (const key of ["text", "message", "summary", "command", "reason"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key];
  }
  for (const key of ["content", "parts", "items", "output", "input"]) {
    const text = extractText(value[key]);
    if (text) return text;
  }
  return "";
}

export function compact(value, maxLength = 88) {
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export function activeTurnId(thread) {
  return (thread?.turns ?? []).find((turn) => turn.status === "inProgress")?.id ?? null;
}
