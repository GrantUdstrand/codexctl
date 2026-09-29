import assert from "node:assert/strict";
import test from "node:test";
import { formatThreads, statusLabel } from "../src/format.js";

test("formats a thread dashboard with status and latest activity", () => {
  const output = formatThreads([
    {
      id: "12345678-abc",
      name: "Fix flaky test",
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
      updatedAt: 1_700_000_000,
      preview: "Investigate the test",
      turns: [{ items: [{ command: "go test ./..." }] }],
      isArchived: false,
    },
  ], 1_700_000_060_000);
  assert.match(output, /12345678/);
  assert.match(output, /active:waitingOnApproval/);
  assert.match(output, /Fix flaky test/);
  assert.match(output, /go test \.\/\.\.\./);
});

test("labels idle and archived states", () => {
  assert.equal(statusLabel({ status: { type: "idle" } }), "idle");
  assert.equal(statusLabel({ status: { type: "active", activeFlags: [] } }), "active");
});
