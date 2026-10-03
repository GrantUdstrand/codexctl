import assert from "node:assert/strict";
import test from "node:test";
import { formatTranscript } from "../src/tui.js";

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
