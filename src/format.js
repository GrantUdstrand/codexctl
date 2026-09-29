import { compact, latestActivity } from "./codex-api.js";

export function statusLabel(thread) {
  const status = thread?.status;
  if (!status) return "unknown";
  if (status.type === "active" && status.activeFlags?.length) return `active:${status.activeFlags.join(",")}`;
  return status.type;
}

export function formatTimestamp(seconds, now = Date.now()) {
  if (!seconds) return "-";
  const date = new Date(seconds * 1000);
  const ageSeconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86_400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return date.toISOString().slice(0, 10);
}

export function threadTitle(thread) {
  return compact(thread?.name || thread?.preview || thread?.id || "(untitled)", 42);
}

export function formatThreads(threads, now = Date.now()) {
  if (!threads.length) return "No Codex threads found.";
  const rows = threads.map((thread) => [
    shortId(thread.id),
    thread.isArchived ? "archived" : statusLabel(thread),
    formatTimestamp(thread.updatedAt, now),
    threadTitle(thread),
    latestActivity(thread),
  ]);
  const headers = ["ID", "STATUS", "UPDATED", "THREAD", "LATEST ACTIVITY"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  return [line(headers), widths.map((width) => "─".repeat(width)).join("  "), ...rows.map(line)].join("\n");
}

export function formatThread(thread, now = Date.now()) {
  return [
    `${threadTitle(thread)} (${thread.id})`,
    `status: ${thread.isArchived ? "archived" : statusLabel(thread)}`,
    `updated: ${formatTimestamp(thread.updatedAt, now)}`,
    `cwd: ${thread.cwd || "-"}`,
    `branch: ${thread.gitInfo?.branch || "-"}`,
    `activity: ${latestActivity(thread)}`,
  ].join("\n");
}

export function shortId(id) {
  return id ? id.slice(0, 8) : "-";
}
