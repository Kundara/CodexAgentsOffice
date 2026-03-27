import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { CodexThread } from "./types";
import { spawnCodexProcess } from "./codex-command";

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

export interface AppServerServerRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface AppServerResponseMessage {
  id: number;
  result?: unknown;
  error?: { message?: string };
}

type ParsedAppServerMessage =
  | { kind: "response"; message: AppServerResponseMessage }
  | { kind: "notification"; message: AppServerNotification }
  | { kind: "serverRequest"; message: AppServerServerRequest }
  | { kind: "unknown" };

export function parseAppServerMessage(line: string): ParsedAppServerMessage {
  const message = JSON.parse(line) as {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { message?: string };
  };

  if (typeof message.id === "number" && typeof message.method === "string") {
    return {
      kind: "serverRequest",
      message: {
        id: message.id,
        method: message.method,
        params: message.params
      }
    };
  }

  if (typeof message.method === "string") {
    return {
      kind: "notification",
      message: {
        method: message.method,
        params: message.params
      }
    };
  }

  if (typeof message.id === "number") {
    return {
      kind: "response",
      message: {
        id: message.id,
        result: message.result,
        error: message.error
      }
    };
  }

  return { kind: "unknown" };
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stderr = "";
  private notificationListeners = new Set<(message: AppServerNotification) => void>();
  private serverRequestListeners = new Set<(message: AppServerServerRequest) => void>();

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.on("error", (error) => {
      for (const pending of this.pending.values()) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.pending.clear();
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
    const { child } = await spawnCodexProcess(["app-server"]);
    const client = new CodexAppServerClient(child);
    await client.request("initialize", {
      clientInfo: {
        name: "codex_agents_office",
        title: "Codex Agents Office",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
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

      const parsed = parseAppServerMessage(line);
      if (parsed.kind === "notification") {
        for (const listener of this.notificationListeners) {
          listener(parsed.message);
        }
        continue;
      }

      if (parsed.kind === "serverRequest") {
        for (const listener of this.serverRequestListeners) {
          listener(parsed.message);
        }
        continue;
      }

      if (parsed.kind !== "response") {
        continue;
      }

      const pending = this.pending.get(parsed.message.id);
      if (!pending) {
        continue;
      }

      this.pending.delete(parsed.message.id);
      if (parsed.message.error) {
        pending.reject(new Error(parsed.message.error.message ?? "app-server request failed"));
      } else {
        pending.resolve(parsed.message.result);
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

  onServerRequest(listener: (message: AppServerServerRequest) => void): () => void {
    this.serverRequestListeners.add(listener);
    return () => {
      this.serverRequestListeners.delete(listener);
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

  async resumeThread(threadId: string): Promise<CodexThread> {
    const result = await this.request<{ thread: CodexThread }>("thread/resume", {
      threadId
    });
    return result.thread;
  }

  async unsubscribeThread(threadId: string): Promise<"unsubscribed" | "notSubscribed" | "notLoaded"> {
    const result = await this.request<{ status: "unsubscribed" | "notSubscribed" | "notLoaded" }>("thread/unsubscribe", {
      threadId
    });
    return result.status;
  }

  async listLoadedThreads(): Promise<string[]> {
    const result = await this.request<{ data: string[] }>("thread/loaded/list", {});
    return Array.isArray(result.data) ? result.data : [];
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
