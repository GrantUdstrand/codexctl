import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { clearSession, isActiveThread, isNotLoadedThread, observeThread, parseAge, parseArgs, purgeNotLoaded, resolveThreadId, selectPurgeThreads } from "../src/cli.js";

test("parses dashboard options and positional arguments", () => {
  const options = parseArgs(["watch", "--json", "--cwd", "/tmp/project", "--refresh-ms", "250"]);
  assert.deepEqual(options, {
    command: "watch",
    cwd: "/tmp/project",
    json: true,
    includeArchived: true,
    refreshMs: 250,
    purgeAction: null,
    olderThanSeconds: null,
    confirm: false,
    dryRun: false,
    positional: [],
  });
});

test("parses safe purge modes", () => {
  assert.deepEqual(parseArgs(["purge", "--delete", "--confirm"]), {
    command: "purge",
    cwd: null,
    json: false,
    includeArchived: true,
    refreshMs: 1000,
    purgeAction: "delete",
    olderThanSeconds: null,
    confirm: true,
    dryRun: false,
    positional: [],
  });
  assert.equal(isNotLoadedThread({ status: { type: "notLoaded" } }), true);
  assert.equal(isNotLoadedThread({ status: { type: "idle" } }), false);
  assert.equal(parseAge("7d"), 7 * 86_400);
  assert.equal(parseAge("1w"), 7 * 86_400);
  assert.throws(() => parseAge("last-week"), /Invalid --older-than/);
});

test("clear previews a single session and requires an explicit action", async () => {
  const calls = [];
  let output = "";
  const api = {
    async listThreads() {
      return [{ id: "abcdef01-full", updatedAt: 20, status: { type: "idle" }, preview: "Keep or clear me" }];
    },
    async delete(id) { calls.push(["delete", id]); },
  };
  await clearSession(
    { cwd: null, includeArchived: true, dryRun: false, purgeAction: null, positional: ["abcdef"] },
    { api, stdout: { write(value) { output += value; } }, input: Readable.from([]) },
  );
  assert.match(output, /Selected session/);
  assert.match(output, /Dry run only/);
  assert.deepEqual(calls, []);
});

test("clear permanently deletes only after DELETE confirmation", async () => {
  const calls = [];
  const api = {
    async listThreads() {
      return [{ id: "abcdef01-full", updatedAt: 20, status: { type: "idle" }, preview: "Delete me" }];
    },
    async delete(id) { calls.push(id); },
  };
  await clearSession(
    { cwd: null, includeArchived: true, dryRun: false, purgeAction: "delete", confirm: true, positional: ["abcdef"] },
    { api, stdout: { write() {} }, input: Readable.from(["DELETE\n"]) },
  );
  assert.deepEqual(calls, ["abcdef01-full"]);
});

test("observe reads a session without resuming it", async () => {
  const calls = [];
  let output = "";
  const api = {
    async listThreads() {
      return [{ id: "abcdef01-full", updatedAt: 20, status: { type: "active" }, preview: "Watching progress" }];
    },
    async readThread(id) {
      calls.push(id);
      return {
        id,
        status: { type: "active" },
        updatedAt: 20,
        cwd: "/tmp/project",
        preview: "Watching progress",
        turns: [{ id: "turn-1", status: "inProgress", items: [] }],
      };
    },
  };
  await observeThread(
    { cwd: null, includeArchived: true, refreshMs: 1000, positional: ["abcdef"] },
    { api, stdout: { write(value) { output += value; } }, input: Readable.from([]) },
  );
  assert.deepEqual(calls, ["abcdef01-full"]);
  assert.match(output, /turn: in progress \(turn-1\)/);
  assert.match(output, /Watching progress/);
});

test("resolves unique displayed thread prefixes", () => {
  const threads = [{ id: "abcdef01-full" }, { id: "12345678-full" }];
  assert.equal(resolveThreadId("abcdef", threads), "abcdef01-full");
  assert.throws(() => resolveThreadId("nope", threads), /No thread matches/);
  assert.throws(() => resolveThreadId("", threads), /thread ID is required/);
});

test("purge dry run lists notLoaded threads without changing anything", async () => {
  const calls = [];
  let output = "";
  const api = {
    async listThreads() {
      return [
        { id: "not-loaded", updatedAt: 20, status: { type: "notLoaded" }, preview: "Old session" },
        { id: "idle", updatedAt: 10, status: { type: "idle" }, preview: "Keep session" },
      ];
    },
    async archive(id) { calls.push(["archive", id]); },
    async delete(id) { calls.push(["delete", id]); },
  };
  await purgeNotLoaded(
    { cwd: null, includeArchived: true, dryRun: true, purgeAction: null },
    { api, stdout: { write(value) { output += value; } }, input: Readable.from([]) },
  );
  assert.match(output, /notLoaded candidates \(1\)/);
  assert.match(output, /Dry run only/);
  assert.deepEqual(calls, []);
});

test("permanent purge requires confirmation text before deleting", async () => {
  const calls = [];
  const api = {
    async listThreads() {
      return [{ id: "not-loaded", updatedAt: 20, status: { type: "notLoaded" }, preview: "Old session" }];
    },
    async delete(id) { calls.push(id); },
  };
  await purgeNotLoaded(
    { cwd: null, includeArchived: true, dryRun: false, purgeAction: "delete", confirm: true },
    { api, stdout: { write() {} }, input: Readable.from(["DELETE\n"]) },
  );
  assert.deepEqual(calls, ["not-loaded"]);
});

test("age purge excludes active writers and keeps going after a race", async () => {
  const now = Math.floor(Date.now() / 1000);
  const old = now - 8 * 86_400;
  const threads = [
    { id: "active", updatedAt: old, status: { type: "active" } },
    { id: "race", updatedAt: old, status: { type: "notLoaded" } },
    { id: "safe", updatedAt: old, status: { type: "notLoaded" } },
    { id: "recent", updatedAt: now - 86_400, status: { type: "idle" } },
  ];
  const selection = selectPurgeThreads(threads, { olderThanSeconds: 7 * 86_400 }, now);
  assert.deepEqual(selection.candidates.map((thread) => thread.id), ["race", "safe"]);
  assert.deepEqual(selection.skippedActive.map((thread) => thread.id), ["active"]);
  assert.equal(isActiveThread(threads[0]), true);

  const calls = [];
  let output = "";
  const api = {
    async listThreads() { return threads; },
    async delete(id) {
      if (id === "race") throw new Error("already has an active writer");
      calls.push(id);
    },
  };
  await purgeNotLoaded(
    { cwd: null, includeArchived: true, olderThanSeconds: 7 * 86_400, dryRun: false, purgeAction: "delete", confirm: true },
    { api, stdout: { write(value) { output += value; } }, input: Readable.from(["DELETE\n"]) },
  );
  assert.deepEqual(calls, ["safe"]);
  assert.match(output, /Skipping 1 active\/writing thread/);
  assert.match(output, /already has an active writer/);
});
