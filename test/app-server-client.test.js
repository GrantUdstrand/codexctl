import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { AppServerClient } from "../src/app-server-client.js";

function fakeSpawn() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit("exit", 0, null);
  };

  let buffer = "";
  child.stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.method === "initialize") {
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { server: "test" } })}\n`);
      } else if (message.method === "thread/list") {
        child.stdout.write(`${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { data: [], nextCursor: null },
        })}\n`);
      }
    }
  });
  return child;
}

test("connects with the App Server handshake and resolves requests", async () => {
  const child = fakeSpawn();
  const client = new AppServerClient({ spawn: () => child, requestTimeoutMs: 1000 });
  await client.connect();
  const result = await client.request("thread/list", { limit: 10 });
  assert.deepEqual(result, { data: [], nextCursor: null });
  await client.close();
});

test("surfaces server approval requests and sends approval responses", async () => {
  const child = fakeSpawn();
  const sent = [];
  const originalWrite = child.stdin.write.bind(child.stdin);
  child.stdin.write = (value, ...args) => {
    for (const line of String(value).trim().split("\n")) sent.push(JSON.parse(line));
    return originalWrite(value, ...args);
  };
  const client = new AppServerClient({ spawn: () => child, requestTimeoutMs: 1000 });
  await client.connect();

  const requestPromise = new Promise((resolve) => client.once("serverRequest", resolve));
  child.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 91,
    method: "item/commandExecution/requestApproval",
    params: { itemId: "item-1", threadId: "thread-1", turnId: "turn-1", command: "go test ./..." },
  })}\n`);
  const request = await requestPromise;
  assert.equal(request.id, 91);
  client.respond(request.id, { decision: "accept" });
  assert.deepEqual(sent.at(-1), { jsonrpc: "2.0", id: 91, result: { decision: "accept" } });
  await client.close();
});
