import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { isNotLoadedThread, parseArgs, purgeNotLoaded, resolveThreadId } from "../src/cli.js";

test("parses dashboard options and positional arguments", () => {
  const options = parseArgs(["watch", "--json", "--cwd", "/tmp/project", "--refresh-ms", "250"]);
  assert.deepEqual(options, {
    command: "watch",
    cwd: "/tmp/project",
    json: true,
    includeArchived: true,
    refreshMs: 250,
    purgeAction: null,
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
    confirm: true,
    dryRun: false,
    positional: [],
  });
  assert.equal(isNotLoadedThread({ status: { type: "notLoaded" } }), true);
  assert.equal(isNotLoadedThread({ status: { type: "idle" } }), false);
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
