import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, resolveThreadId } from "../src/cli.js";

test("parses dashboard options and positional arguments", () => {
  assert.deepEqual(parseArgs(["list", "--json", "--cwd", "/tmp/project"]), {
    command: "list",
    cwd: "/tmp/project",
    json: true,
    includeArchived: true,
    positional: [],
  });
});

test("resolves unique displayed thread prefixes", () => {
  const threads = [{ id: "abcdef01-full" }, { id: "12345678-full" }];
  assert.equal(resolveThreadId("abcdef", threads), "abcdef01-full");
  assert.throws(() => resolveThreadId("nope", threads), /No thread matches/);
  assert.throws(() => resolveThreadId("", threads), /thread ID is required/);
});
