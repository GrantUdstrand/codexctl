import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionEntries, formatTranscript, isActiveSession, projectName } from "../src/tui.js";

test("formats a thread transcript for the interactive pane", () => {
  const transcript = formatTranscript({
    turns: [
      { items: [
        { type: "userMessage", content: [{ type: "text", text: "Run the tests" }] },
        { type: "agentMessage", text: "I found one failing test." },
        { type: "commandExecution", command: "npm test" },
      ] },
    ],
  });
  assert.match(transcript, /You\nRun the tests/);
  assert.match(transcript, /Codex\nI found one failing test/);
  assert.match(transcript, /commandExecution\nnpm test/);
});

test("handles threads without stored turns", () => {
  assert.match(formatTranscript({ turns: [] }), /No transcript available/);
});

test("groups active sessions before inactive sessions", () => {
  const entries = buildSessionEntries([
    {
      id: "idle",
      cwd: "/Users/grant/StudioProjects/Occam-2",
      gitInfo: { originUrl: "git@github.com:GrantUdstrand/Occam.git" },
      status: { type: "idle" },
    },
    {
      id: "active",
      cwd: "/Users/grant/StudioProjects/Occam",
      gitInfo: { originUrl: "git@github.com:GrantUdstrand/Occam.git" },
      status: { type: "active" },
    },
  ], "active");
  assert.deepEqual(entries.map((entry) => entry.thread?.id ?? entry.label), [
    "── Occam ──",
    "  ACTIVE (1)",
    "active",
    "  INACTIVE (1)",
    "idle",
  ]);
  assert.equal(isActiveSession({ status: { type: "active" } }), true);
  assert.equal(isActiveSession({ status: { type: "idle" } }), false);
  assert.equal(projectName({
    cwd: "/Users/grant/StudioProjects/Occam-7",
    gitInfo: { originUrl: "https://github.com/GrantUdstrand/Occam.git" },
  }), "Occam");
  const observedEntries = buildSessionEntries([
    { id: "active", cwd: "/Users/grant/StudioProjects/Occam", status: { type: "active" } },
  ], null, { observedId: "active" });
  assert.match(observedEntries.find((entry) => entry.thread)?.label ?? "", /^◉ /);
  assert.equal(projectName({ cwd: "/Users/grant/StudioProjects/Occam/" }), "Occam");
  assert.equal(projectName({}), "Unknown project");
});
