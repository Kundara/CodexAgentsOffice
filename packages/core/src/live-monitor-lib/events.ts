import { canonicalizeProjectPath } from "../project-paths";
import { summarizeWebSearch } from "../web-search";
import type { AppServerNotification, AppServerServerRequest } from "../app-server";
import type {
  CodexThread,
  DashboardEvent,
  NeedsUserState
} from "../types";

export interface PendingUserRequest extends NeedsUserState {
  threadId: string;
  createdAt: string;
  availableDecisions?: string[];
  networkApprovalContext?: Record<string, unknown> | null;
}

export interface DashboardEventContext {
  projectRoot: string;
  createdAt?: string;
  pendingRequest?: PendingUserRequest | null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : null;
}

export function asString(value: unknown): string | undefined {
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

function summarizePlanUpdate(params: Record<string, unknown>): string {
  const explanation = asString(params.explanation);
  if (explanation) {
    return shorten(explanation);
  }

  const plan = Array.isArray(params.plan) ? params.plan : [];
  const entries = plan
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      step: asString(entry.step),
      status: asString(entry.status)
    }))
    .filter((entry) => entry.step);

  if (entries.length === 0) {
    return "Plan";
  }

  const current =
    entries.find((entry) => entry.status === "inProgress")
    ?? entries.find((entry) => entry.status === "pending")
    ?? entries.at(-1)
    ?? null;

  if (!current?.step) {
    return "Plan";
  }

  const statusLabel =
    current.status === "inProgress" ? "In progress"
    : current.status === "pending" ? "Pending"
    : current.status === "completed" ? "Completed"
    : null;

  return shorten(statusLabel ? `${statusLabel}: ${current.step}` : current.step);
}

function summarizeDiffUpdate(params: Record<string, unknown>): string {
  const diff = asString(params.diff);
  if (!diff) {
    return "Diff";
  }

  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitMatch) {
      files.add(gitMatch[2] || gitMatch[1]);
      continue;
    }
    const plusMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (plusMatch && plusMatch[1] !== "/dev/null") {
      files.add(plusMatch[1]);
    }
  }

  if (files.size === 1) {
    return shorten(Array.from(files)[0] || "Diff");
  }
  if (files.size > 1) {
    return `${files.size} files changed`;
  }
  return shorten(diff);
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

export function extractThreadId(value: unknown): string | null {
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

export function collectPaths(value: unknown, output = new Set<string>()): Set<string> {
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

export function latestThreadAgentMessage(thread: CodexThread): {
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

function shouldStopDormantThreadAfterNotification(input: {
  method: string;
  statusType?: string | null;
  wasOngoing: boolean;
}): boolean {
  if (!input.wasOngoing) {
    return false;
  }
  return (
    input.method === "thread/closed"
    || (input.method === "thread/status/changed" && input.statusType === "notLoaded")
  );
}

export function hasEquivalentRecentMessageEvent(
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
        detail: summarizePlanUpdate(params)
      });
    case "turn/diff/updated":
      return eventBase(context, method, params, {
        kind: "turn",
        phase: "updated",
        title: "Diff updated",
        detail: summarizeDiffUpdate(params)
      });
    case "item/started":
    case "item/completed":
      return buildEventFromItem(context, method, params);
    case "item/agentMessage/delta":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "message",
        phase: "updated",
        title: "Reply updated",
        detail: shorten(asString(params.delta) ?? asString(params.textDelta) ?? "Reply")
      });
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
        title: "Tool call requested",
        detail: shorten(asString(params.tool) ?? asString(params.name) ?? "Tool")
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

export function buildNeedsUserStateFromServerRequest(message: AppServerServerRequest): PendingUserRequest | null {
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

export function shouldStopDormantThreadAfterAppServerNotification(input: {
  method: string;
  statusType?: string | null;
  wasOngoing: boolean;
}): boolean {
  return shouldStopDormantThreadAfterNotification(input);
}
