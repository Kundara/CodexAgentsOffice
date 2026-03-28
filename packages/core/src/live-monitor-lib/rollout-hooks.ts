import { open } from "node:fs/promises";

import { canonicalizeProjectPath } from "../project-paths";
import type { DashboardEvent } from "../types";
import { asRecord, asString } from "./events";

const ROLLOUT_TAIL_BYTES = 512 * 1024;

function parseJsonLine(rawLine: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawLine);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function buildEventId(input: {
  projectRoot: string;
  method: string;
  threadId?: string | null;
  itemId?: string;
  path?: string | null;
}): string {
  return [
    input.projectRoot,
    input.method,
    input.threadId ?? "",
    input.itemId ?? "",
    input.path ?? ""
  ].join("::");
}

export function parseApplyPatchInput(input: string): {
  path: string | null;
  action: DashboardEvent["action"];
  title: string;
  linesAdded?: number;
  linesRemoved?: number;
} | null {
  const lines = input.split(/\r?\n/);
  let path: string | null = null;
  let action: DashboardEvent["action"] = "edited";
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const line of lines) {
    if (line.startsWith("*** Update File: ")) {
      path = canonicalizeProjectPath(line.slice("*** Update File: ".length).trim()) ?? line.slice("*** Update File: ".length).trim();
      action = "edited";
      continue;
    }
    if (line.startsWith("*** Add File: ")) {
      path = canonicalizeProjectPath(line.slice("*** Add File: ".length).trim()) ?? line.slice("*** Add File: ".length).trim();
      action = "created";
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      path = canonicalizeProjectPath(line.slice("*** Delete File: ".length).trim()) ?? line.slice("*** Delete File: ".length).trim();
      action = "deleted";
      continue;
    }
    if (line.startsWith("*** Move to: ")) {
      path = canonicalizeProjectPath(line.slice("*** Move to: ".length).trim()) ?? line.slice("*** Move to: ".length).trim();
      action = "moved";
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      linesAdded += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      linesRemoved += 1;
    }
  }

  if (!path) {
    return null;
  }

  return {
    path,
    action,
    title:
      action === "created" ? "File created"
      : action === "deleted" ? "File deleted"
      : action === "moved" ? "File moved"
      : "File edited",
    linesAdded: linesAdded > 0 ? linesAdded : undefined,
    linesRemoved: linesRemoved > 0 ? linesRemoved : undefined
  };
}

function parseExecCommandArguments(argumentsText: string): {
  command: string;
  cwd?: string;
} | null {
  try {
    const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
    const command = asString(parsed.cmd);
    if (!command) {
      return null;
    }
    return {
      command,
      cwd: asString(parsed.workdir)
    };
  } catch {
    return null;
  }
}

function parseFunctionCallOutputMetadata(output: string): {
  command?: string;
  phase: DashboardEvent["phase"];
} {
  const commandMatch = output.match(/Command:\s+([^\n]+)/);
  const exitMatch = output.match(/Process exited with code\s+(\d+)/);
  const runningMatch = output.match(/Process running with session ID\s+\d+/);
  return {
    command: commandMatch?.[1]?.trim(),
    phase:
      exitMatch
        ? (exitMatch[1] === "0" ? "completed" : "failed")
        : runningMatch
          ? "started"
          : "updated"
  };
}

export function buildRolloutHookEvent(
  projectRoot: string,
  threadId: string,
  entry: Record<string, unknown>,
  pendingCommands = new Map<string, { command: string; cwd?: string }>()
): DashboardEvent | null {
  const payload = asRecord(entry.payload);
  const timestamp = asString(entry.timestamp) ?? new Date().toISOString();
  if (!payload) {
    return null;
  }

  if (payload.type === "custom_tool_call" && payload.name === "apply_patch" && payload.status === "completed") {
    const parsedPatch = parseApplyPatchInput(asString(payload.input) ?? "");
    if (!parsedPatch) {
      return null;
    }
    return {
      id: buildEventId({
        projectRoot,
        method: "rollout/apply_patch/completed",
        threadId,
        itemId: asString(payload.call_id),
        path: parsedPatch.path
      }),
      source: "codex",
      confidence: "typed",
      threadId,
      createdAt: timestamp,
      method: "rollout/apply_patch/completed",
      itemId: asString(payload.call_id),
      kind: "fileChange",
      phase: "completed",
      title: parsedPatch.title,
      detail: parsedPatch.path ?? parsedPatch.title,
      path: parsedPatch.path,
      action: parsedPatch.action,
      isImage: Boolean(parsedPatch.path && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(parsedPatch.path)),
      linesAdded: parsedPatch.linesAdded,
      linesRemoved: parsedPatch.linesRemoved
    };
  }

  if (payload.type === "function_call" && payload.name === "exec_command") {
    const callId = asString(payload.call_id);
    const parsedCommand = parseExecCommandArguments(asString(payload.arguments) ?? "");
    if (!callId || !parsedCommand) {
      return null;
    }
    pendingCommands.set(callId, parsedCommand);
    return {
      id: buildEventId({
        projectRoot,
        method: "rollout/exec_command/started",
        threadId,
        itemId: callId,
        path: parsedCommand.cwd ?? null
      }),
      source: "codex",
      confidence: "typed",
      threadId,
      createdAt: timestamp,
      method: "rollout/exec_command/started",
      itemId: callId,
      kind: "command",
      phase: "started",
      title: "Command started",
      detail: parsedCommand.command,
      path: parsedCommand.cwd ?? null,
      action: "ran",
      command: parsedCommand.command,
      cwd: parsedCommand.cwd
    };
  }

  if (payload.type === "function_call_output") {
    const callId = asString(payload.call_id);
    const rawOutput = asString(payload.output) ?? "";
    const startedCommand = callId ? pendingCommands.get(callId) : null;
    const parsedOutput = parseFunctionCallOutputMetadata(rawOutput);
    const command = startedCommand?.command ?? parsedOutput.command;
    if (!callId || !command) {
      return null;
    }
    return {
      id: buildEventId({
        projectRoot,
        method: `rollout/exec_command/${parsedOutput.phase}`,
        threadId,
        itemId: callId,
        path: startedCommand?.cwd ?? null
      }),
      source: "codex",
      confidence: "typed",
      threadId,
      createdAt: timestamp,
      method: `rollout/exec_command/${parsedOutput.phase}`,
      itemId: callId,
      kind: "command",
      phase: parsedOutput.phase,
      title:
        parsedOutput.phase === "failed" ? "Command failed"
        : parsedOutput.phase === "completed" ? "Command completed"
        : parsedOutput.phase === "started" ? "Command started"
        : "Command output",
      detail: command,
      path: startedCommand?.cwd ?? null,
      action: "ran",
      command,
      cwd: startedCommand?.cwd
    };
  }

  return null;
}

export async function readRecentRolloutHookEvents(
  projectRoot: string,
  threadId: string,
  rolloutPath: string | null,
  threadUpdatedAt: number
): Promise<DashboardEvent[]> {
  if (!rolloutPath) {
    return [];
  }

  try {
    const handle = await open(rolloutPath, "r");
    try {
      const stats = await handle.stat();
      const start = Math.max(0, stats.size - ROLLOUT_TAIL_BYTES);
      const length = stats.size - start;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      const raw = buffer.toString("utf8");
      const lines = raw.split(/\r?\n/);
      const relevantLines = start > 0 ? lines.slice(1) : lines;
      const events: DashboardEvent[] = [];
      const updatedAtMs = threadUpdatedAt * 1000;
      const pendingCommands = new Map<string, { command: string; cwd?: string }>();

      for (const rawLine of relevantLines) {
        const entry = parseJsonLine(rawLine);
        if (!entry) {
          continue;
        }
        const event = buildRolloutHookEvent(projectRoot, threadId, entry, pendingCommands);
        const createdAtMs = event ? Date.parse(event.createdAt) : Number.NaN;
        if (
          event
          && Number.isFinite(createdAtMs)
          && createdAtMs >= updatedAtMs - (2 * 60 * 1000)
          && createdAtMs <= updatedAtMs + 15 * 1000
        ) {
          events.push(event);
        }
      }

      return events.slice(-12);
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }
}
