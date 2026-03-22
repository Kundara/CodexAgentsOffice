import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { CodexThread } from "./types";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

interface ThreadListResult {
  data: CodexThread[];
}

export interface AppServerNotification {
  method: string;
  params?: Record<string, unknown>;
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stderr = "";
  private notificationListeners = new Set<(message: AppServerNotification) => void>();

  private constructor() {
    this.child = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.on("exit", (code, signal) => {
      const reason =
        code === 0 || signal === "SIGTERM"
          ? null
          : new Error(`codex app-server exited unexpectedly (${code ?? signal ?? "unknown"}).`);

      if (!reason) {
        return;
      }

      for (const pending of this.pending.values()) {
        pending.reject(reason);
      }
      this.pending.clear();
    });
  }

  static async create(): Promise<CodexAppServerClient> {
    const client = new CodexAppServerClient();
    await client.request("initialize", {
      clientInfo: {
        name: "codex_agents_office",
        title: "Codex Agents Office",
        version: "0.1.0"
      }
    });
    client.notify("initialized");
    return client;
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      const message = JSON.parse(line) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: { message?: string };
      };

      if (typeof message.method === "string" && typeof message.id !== "number") {
        const notification: AppServerNotification = {
          method: message.method,
          params: message.params
        };
        for (const listener of this.notificationListeners) {
          listener(notification);
        }
        continue;
      }

      if (typeof message.id !== "number") {
        continue;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        continue;
      }

      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "app-server request failed"));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private send(payload: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.send(params ? { method, params } : { method });
  }

  onNotification(listener: (message: AppServerNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  request<TResult>(method: string, params?: Record<string, unknown>): Promise<TResult> {
    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as TResult), reject });
      this.send(params ? { id, method, params } : { id, method });
    });
  }

  async listThreads(params: {
    cwd?: string;
    limit?: number;
    sourceKinds?: string[];
  }): Promise<CodexThread[]> {
    const result = await this.request<ThreadListResult>("thread/list", {
      cwd: params.cwd ?? null,
      limit: params.limit ?? 12,
      sourceKinds: params.sourceKinds ?? [
        "cli",
        "vscode",
        "exec",
        "appServer",
        "subAgent",
        "subAgentReview",
        "subAgentCompact",
        "subAgentThreadSpawn",
        "subAgentOther"
      ],
      archived: false
    });
    return result.data ?? [];
  }

  async readThread(threadId: string): Promise<CodexThread> {
    const result = await this.request<{ thread: CodexThread }>("thread/read", {
      threadId,
      includeTurns: true
    });
    return result.thread;
  }

  close(): void {
    if (!this.child.killed) {
      this.child.kill();
    }
  }
}

export async function withAppServerClient<T>(
  fn: (client: CodexAppServerClient) => Promise<T>
): Promise<T> {
  const client = await CodexAppServerClient.create();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}
