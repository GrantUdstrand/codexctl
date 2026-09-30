import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, resolveThreadId } from "../src/cli.js";

test("parses dashboard options and positional arguments", () => {
  const options = parseArgs(["watch", "--json", "--cwd", "/tmp/project", "--refresh-ms", "250"]);
  assert.deepEqual(options, {
    command: "watch",
    cwd: "/tmp/project",
    json: true,
    includeArchived: true,
    refreshMs: 250,
    positional: [],
  });
});

test("resolves unique displayed thread prefixes", () => {
  const threads = [{ id: "abcdef01-full" }, { id: "12345678-full" }];
  assert.equal(resolveThreadId("abcdef", threads), "abcdef01-full");
  assert.throws(() => resolveThreadId("nope", threads), /No thread matches/);
  assert.throws(() => resolveThreadId("", threads), /thread ID is required/);
});
