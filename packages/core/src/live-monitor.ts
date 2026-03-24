import { EventEmitter } from "node:events";
import { watch, watchFile, unwatchFile, type FSWatcher } from "node:fs";
import { open } from "node:fs/promises";

import {
  type AppServerNotification,
  type AppServerServerRequest,
  CodexAppServerClient
} from "./app-server";
import { listCloudTasks } from "./cloud";
import { canonicalizeProjectPath, filterThreadsForProject } from "./project-paths";
import { getRoomsFilePath } from "./room-config";
import {
  buildDashboardSnapshotFromState,
  filterProjectCloudTasks,
  isOngoingThread,
  parentThreadIdForThread
} from "./snapshot";
import type {
  CloudTask,
  CodexThread,
  DashboardEvent,
  DashboardSnapshot,
  NeedsUserState
} from "./types";
import { summarizeWebSearch } from "./web-search";
import { RECENT_DONE_GRACE_MS } from "./workload";

const DISCOVERY_INTERVAL_MS = 4000;
const CLOUD_REFRESH_INTERVAL_MS = 30000;
const FILE_WATCH_INTERVAL_MS = 250;
const SNAPSHOT_DEBOUNCE_MS = 60;
const THREAD_READ_DEBOUNCE_MS = 80;
const ACTIVE_SUBSCRIPTION_WINDOW_MS = 10 * 60 * 1000;
const MAX_SUBSCRIBED_THREADS = 8;
const MAX_RECENT_EVENTS = 64;
// Desktop-backed threads can take noticeably longer to resume than simple CLI
// sessions, and a too-short timeout drops the live item stream we need for
// `item/agentMessage/*` notifications.
const APP_SERVER_SUBSCRIPTION_TIMEOUT_MS = 25000;
const ROLLOUT_TAIL_BYTES = 512 * 1024;
const STOPPED_THREAD_REMOVAL_BUFFER_MS = 1000;
const DEFAULT_LOCAL_THREAD_LIMIT = 24;

interface PendingUserRequest extends NeedsUserState {
  threadId: string;
  createdAt: string;
  availableDecisions?: string[];
  networkApprovalContext?: Record<string, unknown> | null;
}

interface DashboardEventContext {
  projectRoot: string;
  createdAt?: string;
  pendingRequest?: PendingUserRequest | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function shorten(text: string, maxLength = 88): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function isMeaningfulAgentText(text: string | null | undefined): text is string {
  if (typeof text !== "string") {
    return false;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  return !/^[.\-_~`"'!,;:|/\\()[\]{}]+$/.test(normalized);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      promise.finally(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
    })
  ]);
}

function extractNumberValue(value: unknown, ...keys: string[]): number | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function extractThreadId(value: unknown): string | null {
  const record = asRecord(value);
  const direct = record ? asString(record.threadId ?? record.thread_id) : undefined;
  return direct ?? null;
}

function extractTurnId(value: unknown): string | undefined {
  const record = asRecord(value);
  return record ? asString(record.turnId ?? record.turn_id) : undefined;
}

function extractItemId(value: unknown): string | undefined {
  const record = asRecord(value);
  return record ? asString(record.itemId ?? record.item_id ?? record.id) : undefined;
}

function collectPaths(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const normalized = canonicalizeProjectPath(value);
    if (normalized) {
      output.add(normalized);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPaths(entry, output));
    return output;
  }
  const record = asRecord(value);
  if (!record) {
    return output;
  }
  for (const [key, entry] of Object.entries(record)) {
    if (/(path|cwd|file|grantRoot)/i.test(key)) {
      collectPaths(entry, output);
      continue;
    }
    if (typeof entry === "object" && entry) {
      collectPaths(entry, output);
    }
  }
  return output;
}

function primaryPath(value: unknown): string | null {
  return [...collectPaths(value)][0] ?? null;
}

function latestThreadAgentMessage(thread: CodexThread): {
  turnId?: string;
  itemId?: string;
  text: string;
} | null {
  for (const turn of [...thread.turns].reverse()) {
    for (const item of [...turn.items].reverse()) {
      const record = asRecord(item);
      if (!record || asString(record.type) !== "agentMessage") {
        continue;
      }
      const text = asString(record.text);
      if (!isMeaningfulAgentText(text)) {
        continue;
      }
      return {
        turnId: asString(record.turnId ?? record.turn_id) ?? turn.id,
        itemId: extractItemId(record),
        text
      };
    }
  }
  return null;
}

function isLiveAppServerMethod(method: string): boolean {
  return (
    method === "thread/started"
    || method === "thread/unarchived"
    || method === "turn/started"
    || method === "item/started"
    || method === "item/agentMessage/delta"
    || method === "item/plan/delta"
    || method === "item/reasoning/summaryTextDelta"
    || method === "item/reasoning/summaryPartAdded"
    || method === "item/reasoning/textDelta"
    || method === "item/commandExecution/outputDelta"
    || method === "item/fileChange/outputDelta"
    || method === "item/commandExecution/requestApproval"
    || method === "item/fileChange/requestApproval"
    || method === "item/tool/requestUserInput"
    || method === "item/tool/call"
    || method === "turn/plan/updated"
    || method === "turn/diff/updated"
  );
}

function isTurnTerminalAppServerMethod(method: string): boolean {
  return (
    method === "turn/completed"
    || method === "turn/interrupted"
    || method === "turn/failed"
  );
}

export function shouldMarkThreadLiveFromAppServerNotification(
  method: string,
  statusType?: string | null
): boolean {
  return isLiveAppServerMethod(method) || (method === "thread/status/changed" && statusType === "active");
}

export function shouldMarkThreadStoppedFromAppServerNotification(
  method: string,
  statusType?: string | null
): boolean {
  return (
    method === "thread/archived"
    || isTurnTerminalAppServerMethod(method)
    || (method === "thread/status/changed" && statusType === "systemError")
  );
}

function hasEquivalentRecentMessageEvent(
  recentEvents: DashboardEvent[],
  candidate: DashboardEvent
): boolean {
  if (candidate.kind !== "message") {
    return false;
  }
  return recentEvents.some((event) => {
    if (event.kind !== "message") {
      return false;
    }
    if (event.threadId !== candidate.threadId) {
      return false;
    }
    if (event.itemId && candidate.itemId && event.itemId === candidate.itemId) {
      return true;
    }
    const left = event.detail.trim();
    const right = candidate.detail.trim();
    return left === right || left.startsWith(right) || right.startsWith(left);
  });
}

function buildEventId(input: {
  projectRoot: string;
  method: string;
  threadId?: string | null;
  turnId?: string;
  itemId?: string;
  requestId?: string;
  path?: string | null;
}): string {
  return [
    input.projectRoot,
    input.method,
    input.threadId ?? "",
    input.turnId ?? "",
    input.itemId ?? "",
    input.requestId ?? "",
    input.path ?? ""
  ].join("::");
}

function summarizeFileChange(item: Record<string, unknown>, fallbackPath: string | null) {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const primaryChange = changes.find((entry) => {
    const record = asRecord(entry);
    return Boolean(record && typeof record.path === "string");
  });
  const changeRecord = asRecord(primaryChange);
  const rawPath = asString(changeRecord?.path) ?? fallbackPath ?? null;
  const path = rawPath ? canonicalizeProjectPath(rawPath) ?? rawPath : null;
  const changeKind = asString(changeRecord?.kind) ?? "edit";
  const action: DashboardEvent["action"] =
    changeKind === "create" ? "created"
    : changeKind === "delete" ? "deleted"
    : changeKind === "move" || changeKind === "rename" ? "moved"
    : "edited";

  return {
    path,
    action,
    title:
      action === "created" ? "File created"
      : action === "deleted" ? "File deleted"
      : action === "moved" ? "File moved"
      : "File edited",
    detail: path ?? "Files",
    isImage: Boolean(path && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path)),
    linesAdded:
      extractNumberValue(changeRecord, "linesAdded", "lines_added", "added")
      ?? extractNumberValue(item, "linesAdded", "lines_added"),
    linesRemoved:
      extractNumberValue(changeRecord, "linesRemoved", "lines_removed", "removed")
      ?? extractNumberValue(item, "linesRemoved", "lines_removed")
  };
}

function summarizeCommand(item: Record<string, unknown>, method: string) {
  const command = asString(item.command) ?? method;
  const cwd = asString(item.cwd) ?? null;
  const status = asString(item.status) ?? "inProgress";
  const phase =
    status === "failed" || status === "declined" ? "failed"
    : status === "completed" || status === "success" ? "completed"
    : "started";
  return { command, cwd, phase };
}

function summarizeTool(item: Record<string, unknown>, fallbackLabel = "MCP tool") {
  const tool =
    asString(item.tool)
    ?? asString(item.name)
    ?? asString(item.server)
    ?? fallbackLabel;
  const status = asString(item.status) ?? "inProgress";
  const phase =
    status === "failed" || status === "declined" ? "failed"
    : status === "completed" || status === "success" ? "completed"
    : "started";
  return {
    tool,
    phase,
    detail: shorten(tool)
  };
}

function eventBase(
  context: DashboardEventContext,
  method: string,
  params: Record<string, unknown>,
  overrides: Partial<DashboardEvent>
): DashboardEvent {
  const threadId = overrides.threadId ?? extractThreadId(params) ?? null;
  const turnId = overrides.turnId ?? extractTurnId(params);
  const itemId = overrides.itemId ?? extractItemId(params.item ?? params);
  const requestId = overrides.requestId;
  const path = overrides.path ?? primaryPath(params);
  return {
    id: buildEventId({
      projectRoot: context.projectRoot,
      method,
      threadId,
      turnId,
      itemId,
      requestId,
      path
    }),
    source: "codex",
    confidence: "typed",
    threadId,
    createdAt: context.createdAt ?? new Date().toISOString(),
    method,
    turnId,
    itemId,
    itemType: overrides.itemType,
    requestId,
    kind: "other",
    phase: "updated",
    title: method,
    detail: method,
    path,
    ...overrides
  };
}

export function buildThreadReadAgentMessageEvent(
  context: DashboardEventContext,
  thread: CodexThread
): DashboardEvent | null {
  const latestMessage = latestThreadAgentMessage(thread);
  if (!latestMessage) {
    return null;
  }

  const path = canonicalizeProjectPath(thread.cwd) ?? thread.cwd;
  return {
    id: buildEventId({
      projectRoot: context.projectRoot,
      method: "thread/read/agentMessage",
      threadId: thread.id,
      turnId: latestMessage.turnId,
      itemId: latestMessage.itemId,
      path
    }),
    source: "codex",
    confidence: "typed",
    threadId: thread.id,
    createdAt: context.createdAt ?? new Date().toISOString(),
    method: "thread/read/agentMessage",
    turnId: latestMessage.turnId,
    itemId: latestMessage.itemId,
    kind: "message",
    phase: "completed",
    title: "Reply completed",
    detail: shorten(latestMessage.text),
    path
  };
}

function buildEventFromItem(
  context: DashboardEventContext,
  method: string,
  params: Record<string, unknown>
): DashboardEvent | null {
  const item = asRecord(params.item);
  if (!item) {
    return eventBase(context, method, params, {
      kind: "item",
      title: "Item updated",
      detail: method
    });
  }

  const itemType = asString(item.type) ?? "item";
  const itemId = extractItemId(item);
  const phase =
    method === "item/started" ? "started"
    : method === "item/completed"
      ? (asString(item.status) === "failed" || asString(item.status) === "declined" ? "failed" : "completed")
      : "updated";

  if (itemType === "fileChange") {
    const change = summarizeFileChange(item, primaryPath(params));
    return eventBase(context, method, params, {
      itemId,
      kind: "fileChange",
      phase,
      title: change.title,
      detail: change.detail,
      path: change.path,
      action: change.action,
      isImage: change.isImage,
      linesAdded: change.linesAdded,
      linesRemoved: change.linesRemoved
    });
  }

  if (itemType === "commandExecution") {
    const summary = summarizeCommand(item, method);
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "command",
      phase,
      title:
        phase === "failed" ? "Command failed"
        : phase === "completed" ? "Command completed"
        : "Command started",
      detail: summary.command,
      command: summary.command,
      cwd: summary.cwd ?? undefined,
      path: summary.cwd
    });
  }

  if (itemType === "enteredReviewMode" || itemType === "exitedReviewMode") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "item",
      phase,
      title: itemType === "enteredReviewMode" ? "Review started" : "Review finished",
      detail: shorten(asString(item.review) ?? itemType)
    });
  }

  if (itemType === "collabToolCall" || itemType === "collabAgentToolCall") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "subagent",
      phase,
      title: phase === "completed" ? "Subagent updated" : "Subagent started",
      detail: shorten(asString(item.tool) ?? itemType)
    });
  }

  if (itemType === "agentMessage") {
    const messageText = asString(item.text);
    if (!isMeaningfulAgentText(messageText)) {
      return null;
    }
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "message",
      phase,
      title: phase === "completed" ? "Reply completed" : "Reply updated",
      detail: shorten(messageText)
    });
  }

  if (itemType === "plan") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "turn",
      phase: "updated",
      title: "Plan updated",
      detail: shorten(asString(item.text) ?? "Plan")
    });
  }

  if (itemType === "dynamicToolCall" || itemType === "mcpToolCall") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "tool",
      phase,
      title:
        itemType === "dynamicToolCall"
          ? (phase === "failed" ? "Tool failed" : phase === "completed" ? "Tool completed" : "Tool started")
          : (phase === "failed" ? "MCP tool failed" : phase === "completed" ? "MCP tool completed" : "MCP tool started"),
      detail: summarizeTool(item).detail
    });
  }

  if (itemType === "webSearch") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "tool",
      phase,
      title:
        phase === "failed" ? "Web search failed"
        : phase === "completed" ? "Web search completed"
        : "Web search started",
      detail: shorten(summarizeWebSearch(item))
    });
  }

  if (itemType === "imageView") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "item",
      phase,
      title: phase === "completed" ? "Image viewed" : "Viewing image",
      detail: shorten(asString(item.path) ?? "Image")
    });
  }

  if (itemType === "reasoning") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "item",
      phase,
      title: "Reasoning updated",
      detail: shorten(asString(item.text) ?? asString(item.summary) ?? "Reasoning")
    });
  }

  if (itemType === "contextCompaction") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "item",
      phase,
      title: "Context compacted",
      detail: "Conversation history compacted"
    });
  }

  return eventBase(context, method, params, {
    itemId,
    itemType,
    kind: "item",
    phase,
    title: `Item ${phase}`,
    detail: itemType
  });
}

export function buildDashboardEventFromAppServerMessage(
  context: DashboardEventContext,
  message: AppServerNotification | AppServerServerRequest
): DashboardEvent | null {
  const method = message.method;
  const params = asRecord(message.params) ?? {};
  const requestId = "id" in message ? String(message.id) : undefined;

  switch (method) {
    case "thread/status/changed": {
      const status = asRecord(params.status);
      const type = asString(status?.type) ?? "unknown";
      const activeFlags = asStringArray(status?.activeFlags);
      return eventBase(context, method, params, {
        kind: "status",
        phase:
          activeFlags.includes("waitingOnApproval") || activeFlags.includes("waitingOnUserInput")
            ? "waiting"
            : "updated",
        title:
          activeFlags.includes("waitingOnApproval") ? "Waiting on approval"
          : activeFlags.includes("waitingOnUserInput") ? "Waiting on input"
          : `Thread ${type}`,
        detail: activeFlags.length > 0 ? activeFlags.join(", ") : type
      });
    }
    case "turn/started": {
      const turn = asRecord(params.turn);
      const turnId = extractTurnId(turn ?? params);
      return eventBase(context, method, params, {
        turnId,
        kind: "turn",
        phase: "started",
        title: "Turn started",
        detail: turnId ?? method
      });
    }
    case "turn/completed": {
      const turn = asRecord(params.turn);
      const turnId = extractTurnId(turn ?? params);
      const turnStatus = asString(turn?.status) ?? "completed";
      const phase =
        turnStatus === "failed" ? "failed"
        : turnStatus === "interrupted" ? "interrupted"
        : "completed";
      const error = asRecord(turn?.error);
      return eventBase(context, method, params, {
        turnId,
        kind: "turn",
        phase,
        title:
          phase === "failed" ? "Turn failed"
          : phase === "interrupted" ? "Turn interrupted"
          : "Turn completed",
        detail:
          phase === "failed"
            ? shorten(asString(error?.message) ?? turnId ?? method)
            : turnId ?? method
      });
    }
    case "turn/interrupted":
      return eventBase(context, method, params, {
        kind: "turn",
        phase: "interrupted",
        title: "Turn interrupted",
        detail: extractTurnId(params) ?? method
      });
    case "turn/failed":
      return eventBase(context, method, params, {
        kind: "turn",
        phase: "failed",
        title: "Turn failed",
        detail: shorten(asString(params.message) ?? extractTurnId(params) ?? method)
      });
    case "turn/plan/updated":
      return eventBase(context, method, params, {
        kind: "turn",
        phase: "updated",
        title: "Plan updated",
        detail: shorten(asString(params.text) ?? "Plan")
      });
    case "turn/diff/updated":
      return eventBase(context, method, params, {
        kind: "turn",
        phase: "updated",
        title: "Diff updated",
        detail: shorten(asString(params.text) ?? "Diff")
      });
    case "item/started":
    case "item/completed":
      return buildEventFromItem(context, method, params);
    case "item/agentMessage/delta":
      return null;
    case "item/plan/delta":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "turn",
        phase: "updated",
        title: "Plan streaming",
        detail: shorten(asString(params.delta) ?? asString(params.textDelta) ?? "Plan")
      });
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "message",
        phase: "updated",
        title: "Reasoning updated",
        detail: shorten(asString(params.delta) ?? asString(params.textDelta) ?? "Reasoning")
      });
    case "item/commandExecution/outputDelta":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "command",
        phase: "updated",
        title: "Command output",
        detail: shorten(asString(params.delta) ?? asString(params.textDelta) ?? "Command output")
      });
    case "item/fileChange/outputDelta":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "fileChange",
        phase: "updated",
        title: "Patch updated",
        detail: shorten(asString(params.delta) ?? asString(params.textDelta) ?? "Patch output")
      });
    case "item/commandExecution/requestApproval": {
      const networkApprovalContext = asRecord(params.networkApprovalContext) ?? null;
      return eventBase(context, method, params, {
        requestId,
        itemId: extractItemId(params),
        kind: "approval",
        phase: "waiting",
        title: networkApprovalContext ? "Network approval requested" : "Command approval requested",
        detail: shorten(asString(params.command) ?? asString(params.reason) ?? "Approval requested"),
        command: asString(params.command),
        cwd: asString(params.cwd),
        reason: asString(params.reason),
        availableDecisions: asStringArray(params.availableDecisions),
        networkApprovalContext
      });
    }
    case "item/fileChange/requestApproval":
      return eventBase(context, method, params, {
        requestId,
        itemId: extractItemId(params),
        kind: "approval",
        phase: "waiting",
        title: "File approval requested",
        detail: shorten(asString(params.reason) ?? primaryPath(params) ?? "Approval requested"),
        reason: asString(params.reason),
        grantRoot: asString(params.grantRoot),
        availableDecisions: asStringArray(params.availableDecisions)
      });
    case "item/tool/requestUserInput":
      return eventBase(context, method, params, {
        requestId,
        itemId: extractItemId(params),
        kind: "input",
        phase: "waiting",
        title: "User input requested",
        detail: shorten(asString(params.reason) ?? asString(params.prompt) ?? "Needs input"),
        reason: asString(params.reason),
        availableDecisions: asStringArray(params.availableDecisions)
      });
    case "item/tool/call":
      return eventBase(context, method, params, {
        requestId,
        itemId: extractItemId(params),
        kind: "tool",
        phase: "started",
        title: "MCP tool call",
        detail: shorten(asString(params.tool) ?? asString(params.name) ?? "MCP tool")
      });
    case "serverRequest/resolved": {
      const pending = context.pendingRequest ?? null;
      const resolvedRequestId = asString(params.requestId) ?? requestId;
      if (pending) {
        return eventBase(context, method, params, {
          requestId: resolvedRequestId ?? pending.requestId,
          threadId: pending.threadId,
          turnId: pending.turnId,
          itemId: pending.itemId,
          kind: pending.kind === "approval" ? "approval" : "input",
          phase: "completed",
          title: pending.kind === "approval" ? "Approval resolved" : "Input resolved",
          detail: pending.reason ?? pending.command ?? pending.kind
        });
      }
      return eventBase(context, method, params, {
        requestId: resolvedRequestId,
        kind: "other",
        phase: "completed",
        title: "Request resolved",
        detail: resolvedRequestId ?? method
      });
    }
    default:
      return null;
  }
}

function buildNeedsUserStateFromServerRequest(message: AppServerServerRequest): PendingUserRequest | null {
  const params = asRecord(message.params) ?? {};
  const threadId = extractThreadId(params);
  if (!threadId) {
    return null;
  }

  const requestId = String(message.id);
  if (message.method === "item/commandExecution/requestApproval") {
    return {
      kind: "approval",
      requestId,
      threadId,
      createdAt: new Date().toISOString(),
      turnId: extractTurnId(params),
      itemId: extractItemId(params),
      reason: asString(params.reason),
      command: asString(params.command),
      cwd: asString(params.cwd),
      availableDecisions: asStringArray(params.availableDecisions),
      networkApprovalContext: asRecord(params.networkApprovalContext) ?? null
    };
  }

  if (message.method === "item/fileChange/requestApproval") {
    return {
      kind: "approval",
      requestId,
      threadId,
      createdAt: new Date().toISOString(),
      turnId: extractTurnId(params),
      itemId: extractItemId(params),
      reason: asString(params.reason),
      grantRoot: asString(params.grantRoot),
      availableDecisions: asStringArray(params.availableDecisions)
    };
  }

  if (message.method === "item/tool/requestUserInput") {
    return {
      kind: "input",
      requestId,
      threadId,
      createdAt: new Date().toISOString(),
      turnId: extractTurnId(params),
      itemId: extractItemId(params),
      reason: asString(params.reason) ?? asString(params.prompt),
      availableDecisions: asStringArray(params.availableDecisions)
    };
  }

  return null;
}

function parseJsonLine(rawLine: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawLine);
    return asRecord(parsed);
  } catch {
    return null;
  }
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

async function readRecentRolloutHookEvents(
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

export interface ProjectLiveMonitorOptions {
  projectRoot: string;
  localLimit?: number;
  includeCloud?: boolean;
}

export class ProjectLiveMonitor extends EventEmitter {
  private readonly projectRoot: string;
  private readonly localLimit: number;
  private readonly includeCloud: boolean;
  private readonly threads = new Map<string, CodexThread>();
  private readonly threadWatchers = new Map<string, FSWatcher>();
  private readonly threadReadTimers = new Map<string, NodeJS.Timeout>();
  private readonly threadPaths = new Map<string, string>();
  private readonly notes = new Set<string>();
  private readonly roomConfigPath: string;
  private readonly pendingUserRequests = new Map<string, PendingUserRequest>();
  private readonly subscribedThreadIds = new Set<string>();
  private readonly ongoingThreadIds = new Set<string>();
  private readonly stoppedAtByThreadId = new Map<string, number>();
  private readonly threadRemovalTimers = new Map<string, NodeJS.Timeout>();
  private roomWatcher: FSWatcher | null = null;
  private snapshot: DashboardSnapshot | null = null;
  private cloudTasks: CloudTask[] = [];
  private client: CodexAppServerClient | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private cloudTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private recentEvents: DashboardEvent[] = [];
  private unsubscribeNotifications: (() => void) | null = null;
  private unsubscribeServerRequests: (() => void) | null = null;
  private subscriptionSyncPromise: Promise<void> | null = null;
  private subscriptionSyncQueued = false;

  constructor(options: ProjectLiveMonitorOptions) {
    super();
    this.projectRoot = options.projectRoot;
    this.localLimit = options.localLimit ?? DEFAULT_LOCAL_THREAD_LIMIT;
    this.includeCloud = options.includeCloud !== false;
    this.roomConfigPath = getRoomsFilePath(this.projectRoot);
  }

  getSnapshot(): DashboardSnapshot | null {
    return this.snapshot;
  }

  async start(): Promise<void> {
    await this.ensureClient();
    await this.discoverThreads();
    this.watchRoomsFile();
    this.discoveryTimer = setInterval(() => {
      void this.discoverThreads();
    }, DISCOVERY_INTERVAL_MS);

    if (this.includeCloud) {
      void this.refreshCloudTasks();
      this.cloudTimer = setInterval(() => {
        void this.refreshCloudTasks();
      }, CLOUD_REFRESH_INTERVAL_MS);
    }

    await this.rebuildSnapshot();
  }

  async refreshNow(): Promise<void> {
    await this.refreshCloudTasks();
    await this.discoverThreads();
    await this.rebuildSnapshot();
  }

  async stop(): Promise<void> {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }
    if (this.cloudTimer) {
      clearInterval(this.cloudTimer);
    }
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
    }
    if (this.roomWatcher) {
      this.roomWatcher.close();
    }
    unwatchFile(this.roomConfigPath);
    for (const timer of this.threadReadTimers.values()) {
      clearTimeout(timer);
    }
    this.threadReadTimers.clear();
    for (const timer of this.threadRemovalTimers.values()) {
      clearTimeout(timer);
    }
    this.threadRemovalTimers.clear();
    for (const [threadId, watcher] of this.threadWatchers.entries()) {
      watcher.close();
      const path = this.threadPaths.get(threadId);
      if (path) {
        unwatchFile(path);
      }
    }
    this.threadWatchers.clear();
    this.threadPaths.clear();
    this.unsubscribeNotifications?.();
    this.unsubscribeNotifications = null;
    this.unsubscribeServerRequests?.();
    this.unsubscribeServerRequests = null;
    this.client?.close();
    this.client = null;
    this.ongoingThreadIds.clear();
    this.subscribedThreadIds.clear();
  }

  private async ensureClient(): Promise<void> {
    if (this.client) {
      return;
    }

    try {
      this.client = await CodexAppServerClient.create();
      this.unsubscribeNotifications?.();
      this.unsubscribeServerRequests?.();
      this.unsubscribeNotifications = this.client.onNotification((notification) => {
        this.handleAppServerNotification(notification);
      });
      this.unsubscribeServerRequests = this.client.onServerRequest((request) => {
        this.handleAppServerServerRequest(request);
      });
      this.clearMatchingNote("Local Codex app-server unavailable:");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Local Codex app-server unavailable: ${message}`);
    }
  }

  private addNote(note: string): void {
    this.notes.add(note);
  }

  private clearMatchingNote(prefix: string): void {
    for (const note of this.notes) {
      if (note.startsWith(prefix)) {
        this.notes.delete(note);
      }
    }
  }

  private async discoverThreads(): Promise<void> {
    await this.ensureClient();
    if (!this.client) {
      return;
    }

    try {
      const allThreads = await this.client.listThreads({
        limit: Math.max(this.localLimit * 4, 40)
      });
      const projectThreads = filterThreadsForProject(this.projectRoot, allThreads);
      const projectThreadsById = new Map(projectThreads.map((thread) => [thread.id, thread]));
      const trackedThreads = new Map(
        projectThreads.slice(0, this.localLimit).map((thread) => [thread.id, thread])
      );
      const pendingAncestors = [...trackedThreads.values()];
      while (pendingAncestors.length > 0) {
        const thread = pendingAncestors.shift();
        if (!thread) {
          continue;
        }
        const parentThreadId = parentThreadIdForThread(thread);
        if (!parentThreadId || trackedThreads.has(parentThreadId)) {
          continue;
        }
        let parentThread = projectThreadsById.get(parentThreadId) ?? this.threads.get(parentThreadId) ?? null;
        if (!parentThread) {
          try {
            parentThread = await this.client.readThread(parentThreadId);
          } catch {
            parentThread = null;
          }
        }
        if (!parentThread) {
          continue;
        }
        projectThreadsById.set(parentThread.id, parentThread);
        trackedThreads.set(parentThread.id, parentThread);
        pendingAncestors.push(parentThread);
      }
      for (const threadId of Array.from(this.threads.keys())) {
        if (trackedThreads.has(threadId)) {
          continue;
        }
        const knownThread = projectThreadsById.get(threadId);
        if (knownThread) {
          trackedThreads.set(threadId, knownThread);
        }
      }
      this.clearMatchingNote("Local Codex app-server unavailable:");
      const listedIds = new Set(trackedThreads.keys());

      await Promise.all(
        [...trackedThreads.values()].map(async (listedThread) => {
          const known = this.threads.get(listedThread.id);
          if (!known || known.updatedAt !== listedThread.updatedAt || known.path !== listedThread.path) {
            await this.refreshThread(listedThread.id);
            return;
          }

          if (listedThread.status.type === "active") {
            this.markThreadLive(listedThread.id);
          }
          this.threads.set(listedThread.id, {
            ...known,
            status: listedThread.status,
            updatedAt: listedThread.updatedAt,
            path: listedThread.path ?? known.path
          });
          this.ensureThreadWatcher(listedThread.id, listedThread.path ?? known.path);
        })
      );

      for (const threadId of Array.from(this.threads.keys())) {
        if (!projectThreadsById.has(threadId)) {
          this.markThreadStopped(threadId);
        }
      }

      this.scheduleThreadSubscriptions();
      this.scheduleSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Local Codex app-server unavailable: ${message}`);
      this.client?.close();
      this.client = null;
      this.subscribedThreadIds.clear();
      this.scheduleSnapshot();
    }
  }

  private scheduleThreadSubscriptions(): void {
    if (this.subscriptionSyncPromise) {
      this.subscriptionSyncQueued = true;
      return;
    }

    this.subscriptionSyncPromise = this.syncThreadSubscriptions()
      .catch(() => {
        /* notes are handled inside syncThreadSubscriptions */
      })
      .finally(() => {
        this.subscriptionSyncPromise = null;
        if (this.subscriptionSyncQueued) {
          this.subscriptionSyncQueued = false;
          this.scheduleThreadSubscriptions();
        }
      });
  }

  private async syncThreadSubscriptions(): Promise<void> {
    if (!this.client) {
      return;
    }

    this.clearMatchingNote("Live subscription sync degraded:");
    this.clearMatchingNote("Thread subscribe failed (");

    const now = Date.now();
    const candidates = [...this.threads.values()]
      .filter((thread) => (
        !this.stoppedAtByThreadId.has(thread.id)
        && (
        thread.status.type === "active"
        || (now - thread.updatedAt * 1000) <= ACTIVE_SUBSCRIPTION_WINDOW_MS
        )
      ))
      .sort((left, right) => {
        const leftActive = left.status.type === "active" ? 1 : 0;
        const rightActive = right.status.type === "active" ? 1 : 0;
        return rightActive - leftActive || right.updatedAt - left.updatedAt;
      })
      .slice(0, MAX_SUBSCRIBED_THREADS);

    const targetIds = new Set(candidates.map((thread) => thread.id));
    const loadedThreadIds = new Set(
      await withTimeout(
        this.client.listLoadedThreads().catch(() => []),
        APP_SERVER_SUBSCRIPTION_TIMEOUT_MS,
        "thread/loaded/list"
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.addNote(`Live subscription sync degraded: ${message}`);
        return [];
      })
    );

    await Promise.all(
      [...targetIds]
        .filter((threadId) => !this.subscribedThreadIds.has(threadId))
        .map(async (threadId) => {
          try {
            await withTimeout(
              this.client?.resumeThread(threadId) ?? Promise.reject(new Error("client unavailable")),
              APP_SERVER_SUBSCRIPTION_TIMEOUT_MS,
              `thread/resume ${threadId.slice(0, 8)}`
            );
            this.subscribedThreadIds.add(threadId);
            loadedThreadIds.add(threadId);
            this.scheduleThreadRefresh(threadId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.addNote(`Thread subscribe failed (${threadId.slice(0, 8)}): ${message}`);
          }
        })
    );

    await Promise.all(
      [...this.subscribedThreadIds]
        .filter((threadId) => !targetIds.has(threadId))
        .map(async (threadId) => {
          try {
            await withTimeout(
              this.client?.unsubscribeThread(threadId) ?? Promise.reject(new Error("client unavailable")),
              APP_SERVER_SUBSCRIPTION_TIMEOUT_MS,
              `thread/unsubscribe ${threadId.slice(0, 8)}`
            );
          } catch {
            /* ignore unsubscribe failures */
          }
          this.subscribedThreadIds.delete(threadId);
        })
    );

    for (const threadId of [...this.subscribedThreadIds]) {
      if (!loadedThreadIds.has(threadId)) {
        this.scheduleThreadRefresh(threadId);
      }
    }

    this.scheduleSnapshot();
  }

  private scheduleThreadRefresh(threadId: string): void {
    const existing = this.threadReadTimers.get(threadId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.threadReadTimers.delete(threadId);
      void this.refreshThread(threadId);
    }, THREAD_READ_DEBOUNCE_MS);
    this.threadReadTimers.set(threadId, timer);
  }

  private ensureThreadWatcher(threadId: string, path: string | null): void {
    if (!path) {
      return;
    }

    const currentPath = this.threadPaths.get(threadId);
    if (currentPath === path) {
      return;
    }

    if (currentPath) {
      this.threadWatchers.get(threadId)?.close();
      unwatchFile(currentPath);
    }

    this.threadPaths.set(threadId, path);
    try {
      const watcher = watch(path, () => {
        this.scheduleThreadRefresh(threadId);
      });
      this.threadWatchers.set(threadId, watcher);
    } catch {
      /* ignore and rely on watchFile below */
    }

    watchFile(
      path,
      { interval: FILE_WATCH_INTERVAL_MS },
      () => {
        this.scheduleThreadRefresh(threadId);
      }
    );
  }

  private removeThread(threadId: string): void {
    this.threads.delete(threadId);
    const watcher = this.threadWatchers.get(threadId);
    watcher?.close();
    this.threadWatchers.delete(threadId);

    const timer = this.threadReadTimers.get(threadId);
    if (timer) {
      clearTimeout(timer);
      this.threadReadTimers.delete(threadId);
    }

    const path = this.threadPaths.get(threadId);
    if (path) {
      unwatchFile(path);
      this.threadPaths.delete(threadId);
    }

    for (const [requestId, request] of this.pendingUserRequests.entries()) {
      if (request.threadId === threadId) {
        this.pendingUserRequests.delete(requestId);
      }
    }
    const removalTimer = this.threadRemovalTimers.get(threadId);
    if (removalTimer) {
      clearTimeout(removalTimer);
      this.threadRemovalTimers.delete(threadId);
    }
    this.ongoingThreadIds.delete(threadId);
    this.stoppedAtByThreadId.delete(threadId);
    this.subscribedThreadIds.delete(threadId);
  }

  private belongsToProject(message: AppServerNotification | AppServerServerRequest): boolean {
    const threadId = extractThreadId(message.params);
    if (threadId && this.threads.has(threadId)) {
      return true;
    }

    const projectPaths = [...collectPaths(message.params)];
    return projectPaths.some((path) => path === this.projectRoot || path.startsWith(`${this.projectRoot}/`));
  }

  private pushRecentEvent(event: DashboardEvent): void {
    this.recentEvents.unshift(event);
    const seen = new Set<string>();
    this.recentEvents = this.recentEvents.filter((entry) => {
      if (seen.has(entry.id)) {
        return false;
      }
      seen.add(entry.id);
      return true;
    }).slice(0, MAX_RECENT_EVENTS);
  }

  private handleAppServerNotification(notification: AppServerNotification): void {
    if (!this.belongsToProject(notification)) {
      return;
    }

    const threadId = extractThreadId(notification.params);
    if (threadId) {
      const status = notification.method === "thread/status/changed"
        ? asRecord(asRecord(notification.params)?.status)
        : null;
      const statusType = asString(status?.type);
      if (shouldMarkThreadLiveFromAppServerNotification(notification.method, statusType)) {
        this.markThreadLive(threadId);
      } else if (shouldMarkThreadStoppedFromAppServerNotification(notification.method, statusType)) {
        this.markThreadStopped(threadId);
      }
      if (
        notification.method === "thread/closed"
        || (notification.method === "thread/status/changed" && statusType === "notLoaded")
      ) {
        this.scheduleThreadSubscriptions();
      }
    }

    if (notification.method === "serverRequest/resolved") {
      const params = asRecord(notification.params) ?? {};
      const requestId = asString(params.requestId);
      const pendingRequest = requestId ? this.pendingUserRequests.get(requestId) ?? null : null;
      if (requestId) {
        this.pendingUserRequests.delete(requestId);
      }
      const event = buildDashboardEventFromAppServerMessage(
        { projectRoot: this.projectRoot, pendingRequest },
        notification
      );
      if (event) {
        this.pushRecentEvent(event);
      }
    } else {
      const event = buildDashboardEventFromAppServerMessage({ projectRoot: this.projectRoot }, notification);
      if (event) {
        this.pushRecentEvent(event);
      }
    }

    if (threadId) {
      this.scheduleThreadRefresh(threadId);
    } else {
      void this.discoverThreads();
    }
    this.scheduleSnapshot();
  }

  private handleAppServerServerRequest(request: AppServerServerRequest): void {
    if (!this.belongsToProject(request)) {
      return;
    }

    const needsUser = buildNeedsUserStateFromServerRequest(request);
    if (needsUser) {
      this.pendingUserRequests.set(needsUser.requestId, needsUser);
    }

    const event = buildDashboardEventFromAppServerMessage(
      { projectRoot: this.projectRoot, pendingRequest: needsUser },
      request
    );
    if (event) {
      this.pushRecentEvent(event);
    }

    const threadId = extractThreadId(request.params);
    if (threadId) {
      this.markThreadLive(threadId);
      this.scheduleThreadRefresh(threadId);
    } else {
      void this.discoverThreads();
    }
    this.scheduleSnapshot();
  }

  private async refreshThread(threadId: string): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const previousThread = this.threads.get(threadId) ?? null;
      const thread = await this.client.readThread(threadId);
      this.clearMatchingNote(`Thread refresh failed (${threadId.slice(0, 8)}):`);
      this.threads.set(threadId, thread);
      if (isOngoingThread(thread)) {
        this.markThreadLive(threadId);
      } else if (previousThread && isOngoingThread(previousThread)) {
        this.markThreadStopped(threadId);
      }
      const previousMessage = previousThread ? latestThreadAgentMessage(previousThread) : null;
      const nextMessage = latestThreadAgentMessage(thread);
      if (
        previousThread
        && nextMessage
        && (
          nextMessage.itemId !== previousMessage?.itemId
          || nextMessage.text !== previousMessage?.text
        )
      ) {
        const messageEvent = buildThreadReadAgentMessageEvent({ projectRoot: this.projectRoot }, thread);
        if (messageEvent && !hasEquivalentRecentMessageEvent(this.recentEvents, messageEvent)) {
          this.pushRecentEvent(messageEvent);
        }
      }
      this.ensureThreadWatcher(threadId, thread.path);
      const rolloutEvents = await readRecentRolloutHookEvents(this.projectRoot, threadId, thread.path, thread.updatedAt);
      for (const event of rolloutEvents) {
        this.pushRecentEvent(event);
      }
      this.scheduleSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Thread refresh failed (${threadId.slice(0, 8)}): ${message}`);
      this.scheduleSnapshot();
    }
  }

  private watchRoomsFile(): void {
    try {
      this.roomWatcher = watch(this.roomConfigPath, () => {
        this.scheduleSnapshot();
      });
    } catch {
      this.roomWatcher = null;
    }

    watchFile(
      this.roomConfigPath,
      { interval: FILE_WATCH_INTERVAL_MS },
      () => {
        this.scheduleSnapshot();
      }
    );
  }

  private async refreshCloudTasks(): Promise<void> {
    if (!this.includeCloud) {
      this.cloudTasks = [];
      return;
    }

    try {
      const listed = await listCloudTasks(10);
      this.cloudTasks = filterProjectCloudTasks(listed, this.projectRoot);
      this.clearMatchingNote("Codex cloud list unavailable:");
      this.scheduleSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Codex cloud list unavailable: ${message}`);
      this.scheduleSnapshot();
    }
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
    }

    this.snapshotTimer = setTimeout(() => {
      void this.rebuildSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  private async rebuildSnapshot(): Promise<void> {
    this.snapshotTimer = null;
    const needsUserByThreadId = new Map<string, NeedsUserState>();
    for (const pending of this.pendingUserRequests.values()) {
      needsUserByThreadId.set(pending.threadId, pending);
    }

    this.snapshot = await buildDashboardSnapshotFromState({
      projectRoot: this.projectRoot,
      threads: Array.from(this.threads.values()),
      cloudTasks: this.cloudTasks,
      events: this.recentEvents,
      notes: Array.from(this.notes),
      needsUserByThreadId,
      subscribedThreadIds: this.subscribedThreadIds,
      stoppedAtByThreadId: this.stoppedAtByThreadId,
      ongoingThreadIds: this.ongoingThreadIds
    });
    this.emit("snapshot", this.snapshot);
  }

  private markThreadLive(threadId: string): void {
    this.ongoingThreadIds.add(threadId);
    this.stoppedAtByThreadId.delete(threadId);
    const removalTimer = this.threadRemovalTimers.get(threadId);
    if (removalTimer) {
      clearTimeout(removalTimer);
      this.threadRemovalTimers.delete(threadId);
    }
  }

  private markThreadStopped(threadId: string): void {
    if (!this.threads.has(threadId)) {
      return;
    }
    if (this.stoppedAtByThreadId.has(threadId)) {
      return;
    }

    this.ongoingThreadIds.delete(threadId);
    this.stoppedAtByThreadId.set(threadId, Date.now());
    const removalTimer = this.threadRemovalTimers.get(threadId);
    if (removalTimer) {
      clearTimeout(removalTimer);
    }
    this.threadRemovalTimers.set(threadId, setTimeout(() => {
      this.threadRemovalTimers.delete(threadId);
      this.removeThread(threadId);
      this.scheduleSnapshot();
    }, RECENT_DONE_GRACE_MS + STOPPED_THREAD_REMOVAL_BUFFER_MS));
  }
}
