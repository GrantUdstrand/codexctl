import { spawn as defaultSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";

export class AppServerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AppServerError";
    Object.assign(this, details);
  }
}

export class AppServerClient extends EventEmitter {
  constructor({
    command = "codex",
    args = ["app-server", "--stdio"],
    cwd = process.cwd(),
    env = process.env,
    spawn = defaultSpawn,
    requestTimeoutMs = 60_000,
    clientInfo = {
      name: "codexctl",
      title: "codexctl",
      version: "0.1.0",
    },
  } = {}) {
    super();
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.spawn = spawn;
    this.requestTimeoutMs = requestTimeoutMs;
    this.clientInfo = clientInfo;
    this.child = null;
    this.readline = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.closed = false;
  }

  async connect() {
    if (this.child) return this;

    this.closed = false;
    this.child = this.spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.readline = createInterface({ input: this.child.stdout });
    this.readline.on("line", (line) => this.#handleLine(line));
    this.child.stderr?.on("data", (chunk) => {
      this.emit("stderr", chunk.toString());
    });
    this.child.on("error", (error) => {
      this.emit("processError", error);
      this.#failPending(error);
    });
    this.child.on("exit", (code, signal) => {
      const error = this.closed
        ? null
        : new AppServerError(`Codex App Server exited (${code ?? "signal"}${signal ? ` ${signal}` : ""})`, {
            code,
            signal,
          });
      if (error) this.#failPending(error);
      this.emit("exit", { code, signal });
      this.child = null;
    });

    await this.request("initialize", {
      clientInfo: this.clientInfo,
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
    return this;
  }

  request(method, params = {}) {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new AppServerError("Codex App Server is not connected"));
    }

    const id = this.nextRequestId++;
    const message = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppServerError(`Timed out waiting for ${method}`, { method, id }));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      this.#write(message);
    });
  }

  notify(method, params = {}) {
    this.#write({ jsonrpc: "2.0", method, params });
  }

  respond(id, result) {
    this.#write({ jsonrpc: "2.0", id, result });
  }

  async close() {
    this.closed = true;
    this.#failPending(new AppServerError("Codex App Server client closed"));
    this.readline?.close();
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
  }

  #write(message) {
    if (!this.child?.stdin?.writable) {
      throw new AppServerError("Codex App Server is not connected");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit("protocolError", new AppServerError("Received invalid JSON from Codex App Server", { cause: error, line }));
      return;
    }

    if (message.method) {
      if (message.id !== undefined && message.id !== null) {
        this.emit("serverRequest", message);
      } else {
        this.emit("notification", message);
        this.emit(message.method, message.params);
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id") && message.id !== undefined && message.id !== null) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.emit("orphanResponse", message);
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new AppServerError(message.error.message ?? "Codex App Server request failed", {
          method: pending.method,
          requestId: message.id,
          code: message.error.code,
          data: message.error.data,
        }));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
  }

  #failPending(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
