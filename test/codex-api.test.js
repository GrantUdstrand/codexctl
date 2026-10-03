import assert from "node:assert/strict";
import test from "node:test";
import { CodexApi, activeTurnId, latestActivity } from "../src/codex-api.js";

class FakeClient {
  constructor() {
    this.calls = [];
  }

  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "thread/list") {
      if (params.archived === false && !params.cursor) {
        return {
          data: [{ id: "active", updatedAt: 20, status: { type: "active", activeFlags: [] }, turns: [] }],
          nextCursor: "page-2",
        };
      }
      if (params.archived === false) return { data: [], nextCursor: null };
      return {
        data: [{ id: "archived", updatedAt: 10, status: { type: "idle" }, turns: [] }],
        nextCursor: null,
      };
    }
    return { ok: true, thread: { id: params.threadId } };
  }

  respond(id, result) {
    this.calls.push({ method: "response", id, result });
  }
}

test("lists active and archived threads with pagination", async () => {
  const client = new FakeClient();
  const api = new CodexApi(client);
  const threads = await api.listThreads();
  assert.deepEqual(threads.map((thread) => [thread.id, thread.isArchived]), [
    ["active", false],
    ["archived", true],
  ]);
  assert.equal(client.calls.filter((call) => call.method === "thread/list").length, 3);
});

test("maps lifecycle operations to App Server methods", async () => {
  const client = new FakeClient();
  const api = new CodexApi(client);
  await api.resume("t1");
  await api.startTurn("t1", "Run the tests");
  await api.steer("t1", "Focus on the failing test", "turn1");
  await api.unsubscribe("t1");
  await api.fork("t1");
  await api.interrupt("t1", "turn1");
  await api.rename("t1", "New name");
  await api.archive("t1");
  await api.delete("t1");
  api.approve(7, "accept");
  assert.deepEqual(client.calls.map((call) => call.method), [
    "thread/resume",
    "turn/start",
    "turn/steer",
    "thread/unsubscribe",
    "thread/fork",
    "turn/interrupt",
    "thread/name/set",
    "thread/archive",
    "thread/delete",
    "response",
  ]);
  assert.deepEqual(client.calls.at(-1), { method: "response", id: 7, result: { decision: "accept" } });
});

test("extracts latest activity and active turn IDs", () => {
  const thread = {
    preview: "Initial prompt",
    turns: [
      { id: "turn-1", status: "completed", items: [{ type: "agentMessage", text: "First answer" }] },
      { id: "turn-2", status: "inProgress", items: [{ type: "commandExecution", command: "npm test" }] },
    ],
  };
  assert.equal(latestActivity(thread), "npm test");
  assert.equal(activeTurnId(thread), "turn-2");
});
