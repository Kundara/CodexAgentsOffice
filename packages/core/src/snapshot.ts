import { basename } from "node:path";

import { ensureAgentAppearance } from "./appearance";
import { withAppServerClient } from "./app-server";
import { loadClaudeAgents } from "./claude";
import { listCloudTasks } from "./cloud";
import { loadCursorAgents } from "./cursor";
import { loadFreshPresenceAgents } from "./presence";
import { findRoomForPaths, loadRoomConfig } from "./room-config";
import { isCurrentWorkloadAgent } from "./workload";
import { summarizeWebSearch } from "./web-search";
import type {
  AgentActivityEvent,
  ActivityState,
  CloudTask,
  CodexThread,
  CodexTurn,
  DashboardAgent,
  DashboardEvent,
  DashboardSnapshot,
  NeedsUserState,
  SnapshotOptions,
  ThreadItem
} from "./types";

const DONE_WINDOW_MS = 15 * 60 * 1000;
const USER_PROMPT_ACTIVE_WINDOW_MS = 30 * 1000;
const EVENT_ACTIVITY_WINDOW_MS = 90 * 1000;
const SNAPSHOT_EVENT_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_LOCAL_THREAD_LIMIT = 24;

function shorten(text: string, maxLength: number): string {
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

function threadTurns(thread: CodexThread): CodexTurn[] {
  return Array.isArray(thread.turns) ? thread.turns : [];
}

export function pickThreadLabel(thread: CodexThread): string {
  return (
    thread.name ??
    thread.agentNickname ??
    shorten(thread.preview || thread.id, 42)
  );
}

function looksLikeValidationCommand(command: string): boolean {
  return /\b(test|tests|lint|build|check|verify|pytest|cargo test|go test|npm test|pnpm test|vitest|jest)\b/i.test(
    command
  );
}

function extractStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "object" && entry && typeof (entry as Record<string, unknown>)[key] === "string"
      ? ((entry as Record<string, unknown>)[key] as string)
      : null))
    .filter((entry): entry is string => Boolean(entry));
}

function extractNumberValue(value: unknown, ...keys: string[]): number | undefined {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function summarizeFileChange(item: ThreadItem): {
  action: AgentActivityEvent["action"];
  path: string | null;
  title: string;
  isImage: boolean;
  linesAdded?: number;
  linesRemoved?: number;
  paths: string[];
} {
  const primaryChange = Array.isArray(item.changes)
    ? item.changes.find((entry) => typeof entry === "object" && entry && typeof (entry as Record<string, unknown>).path === "string") as Record<string, unknown> | undefined
    : undefined;
  const paths = extractStringArray(item.changes, "path");
  const primaryPath = paths[0] ?? null;
  const changeKind = typeof primaryChange?.kind === "string" ? primaryChange.kind : "edit";
  const action =
    changeKind === "create" ? "created"
    : changeKind === "delete" ? "deleted"
    : changeKind === "move" || changeKind === "rename" ? "moved"
    : "edited";

  return {
    action,
    path: primaryPath,
    title: primaryPath ? `${changeKind} ${primaryPath}` : "Editing files",
    isImage: Boolean(primaryPath && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(primaryPath)),
    linesAdded: extractNumberValue(primaryChange, "linesAdded", "lines_added", "added") ?? extractNumberValue(item, "linesAdded", "lines_added"),
    linesRemoved: extractNumberValue(primaryChange, "linesRemoved", "lines_removed", "removed") ?? extractNumberValue(item, "linesRemoved", "lines_removed"),
    paths
  };
}

function extractTextContent(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (
        typeof entry === "object"
        && entry
        && typeof (entry as Record<string, unknown>).text === "string"
      ) {
        return (entry as Record<string, unknown>).text as string;
      }
      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function extractPathsFromText(text: string): string[] {
  const matches = text.match(/(?:[A-Za-z]:[\\/][^\s`'"]+|\/[^\s`'"]+)/g) ?? [];
  return Array.from(new Set(matches));
}

function describeAgentMessage(item: ThreadItem): { detail: string; paths: string[] } {
  const candidateText = typeof item.text === "string" ? item.text : null;
  const text = isMeaningfulAgentText(candidateText)
    ? candidateText
    : "Responding";
  return {
    detail: shorten(text, 88),
    paths: extractPathsFromText(text)
  };
}

function latestAgentMessageForThread(thread: CodexThread): string | null {
  const turns = threadTurns(thread);
  for (const turn of [...turns].reverse()) {
    for (const item of [...turn.items].reverse()) {
      if (item.type !== "agentMessage" || typeof item.text !== "string") {
        continue;
      }
      const text = shorten(item.text, 240);
      if (isMeaningfulAgentText(text)) {
        return text;
      }
    }
  }
  if (turns.length === 0) {
    const preview = shorten(thread.preview || "", 240);
    return isMeaningfulAgentText(preview) ? preview : null;
  }
  return null;
}

function extractPromptRole(text: string | null | undefined): string | null {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  const explicitRoleMatch = text.match(/(?:^|\n)\s*Role:\s*([A-Za-z][A-Za-z0-9_-]*)/i);
  if (explicitRoleMatch) {
    return explicitRoleMatch[1].trim().toLowerCase();
  }
  const impliedRoleMatch = text.match(/\bAct as (?:an?|the)?\s*([A-Za-z][A-Za-z0-9_-]*)\s+subagent\b/i);
  return impliedRoleMatch ? impliedRoleMatch[1].trim().toLowerCase() : null;
}

function parseThreadSourceMeta(thread: CodexThread): {
  sourceKind: string;
  parentThreadId: string | null;
  depth: number;
} {
  if (typeof thread.source === "string") {
    return {
      sourceKind: thread.source,
      parentThreadId: null,
      depth: 0
    };
  }

  const subAgentSource =
    typeof thread.source === "object"
      ? (thread.source as Record<string, unknown>).subAgent
      : null;
  const threadSpawn =
    typeof subAgentSource === "object" && subAgentSource
      ? (subAgentSource as Record<string, unknown>).thread_spawn
      : null;

  if (typeof threadSpawn === "object" && threadSpawn) {
    return {
      sourceKind: "subAgent",
      parentThreadId:
        typeof (threadSpawn as Record<string, unknown>).parent_thread_id === "string"
          ? ((threadSpawn as Record<string, unknown>).parent_thread_id as string)
          : null,
      depth:
        typeof (threadSpawn as Record<string, unknown>).depth === "number"
          ? ((threadSpawn as Record<string, unknown>).depth as number)
          : 1
    };
  }

  return {
    sourceKind: "unknown",
    parentThreadId: null,
    depth: 0
  };
}

export function parentThreadIdForThread(thread: CodexThread): string | null {
  return parseThreadSourceMeta(thread).parentThreadId;
}

function inferThreadAgentRole(thread: CodexThread, sourceKind: string): string | null {
  if (sourceKind === "subAgent") {
    const previewRole = extractPromptRole(thread.preview);
    if (previewRole && previewRole !== "default") {
      return previewRole;
    }

    const userMessageRole = [...threadTurns(thread)]
      .reverse()
      .flatMap((turn) => [...turn.items].reverse())
      .find((item) => item.type === "userMessage");
    const extractedUserRole = userMessageRole
      ? extractPromptRole(
        extractTextContent((userMessageRole as ThreadItem & { content?: unknown }).content)[0] ?? null
      )
      : null;
    if (extractedUserRole && extractedUserRole !== "default") {
      return extractedUserRole;
    }
  }

  return thread.agentRole;
}

function turnHasFinalAnswer(turn: CodexTurn): boolean {
  return turn.items.some((item) => item.type === "agentMessage" && item.phase === "final_answer");
}

export function isOngoingThread(thread: CodexThread): boolean {
  if (thread.status.type === "active") {
    return true;
  }
  const lastTurn = threadTurns(thread).at(-1);
  return lastTurn?.status === "inProgress";
}

function selectRelevantItem(items: ThreadItem[]): ThreadItem | null {
  const priority = [
    "fileChange",
    "commandExecution",
    "dynamicToolCall",
    "mcpToolCall",
    "webSearch",
    "imageView",
    "collabToolCall",
    "collabAgentToolCall",
    "enteredReviewMode",
    "exitedReviewMode",
    "plan",
    "reasoning",
    "contextCompaction",
    "agentMessage",
    "userMessage"
  ];

  for (const type of priority) {
    const match = [...items].reverse().find((item) => item.type === type);
    if (match) {
      return match;
    }
  }

  return items.at(-1) ?? null;
}

export function summariseThread(thread: CodexThread): {
  state: ActivityState;
  detail: string;
  paths: string[];
  activityEvent: AgentActivityEvent | null;
} {
  if (thread.status.type === "systemError") {
    return {
      state: "blocked",
      detail: "System error",
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  if (thread.status.type === "active" && thread.status.activeFlags?.includes("waitingOnApproval")) {
    return {
      state: "blocked",
      detail: "Waiting on approval",
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  if (thread.status.type === "active" && thread.status.activeFlags?.includes("waitingOnUserInput")) {
    return {
      state: "waiting",
      detail: "Waiting on user input",
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  const turns = threadTurns(thread);
  const lastTurn = turns.at(-1);
  if (!lastTurn) {
    const ageMs = Date.now() - thread.updatedAt * 1000;
    const preview = shorten(thread.preview || "", 88);
    const recentState = ageMs <= DONE_WINDOW_MS ? "done" : "idle";
    return {
      state:
        thread.status.type === "active" ? "thinking"
        : recentState,
      detail:
        preview
        || (thread.status.type === "active"
          ? "Thinking"
          : recentState === "done"
            ? "Finished recently"
            : "Idle"),
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  const treatAsInProgress = lastTurn.status === "inProgress";
  const interruptedWithoutFinalAnswer =
    lastTurn.status === "interrupted" && !turnHasFinalAnswer(lastTurn);

  if (lastTurn.status === "failed") {
    return {
      state: "blocked",
      detail: lastTurn.error?.message ?? "Turn failed",
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  const item = selectRelevantItem(lastTurn.items);
  if (!item) {
    const ageMs = Date.now() - thread.updatedAt * 1000;
    return {
      state:
        treatAsInProgress ? "thinking"
        : interruptedWithoutFinalAnswer ? (ageMs <= DONE_WINDOW_MS ? "done" : "idle")
        : "idle",
      detail:
        treatAsInProgress ? "Thinking"
        : interruptedWithoutFinalAnswer ? (ageMs <= DONE_WINDOW_MS ? "Interrupted" : "Idle")
        : "Idle",
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  switch (item.type) {
    case "fileChange": {
      const change = summarizeFileChange(item);
      const status = typeof item.status === "string" ? item.status : "inProgress";
      const state = status === "failed" || status === "declined" ? "blocked" : "editing";
      return {
        state,
        detail: change.path ? `Editing ${change.path}` : "Editing files",
        paths: change.paths.length > 0 ? change.paths : [thread.cwd],
        activityEvent: {
          type: "fileChange",
          action: change.action,
          path: change.path,
          title: change.title,
          isImage: change.isImage,
          linesAdded: change.linesAdded,
          linesRemoved: change.linesRemoved
        }
      };
    }
    case "commandExecution": {
      const command = typeof item.command === "string" ? item.command : "Command";
      const cwd = typeof item.cwd === "string" ? item.cwd : thread.cwd;
      const status = typeof item.status === "string" ? item.status : "inProgress";
      if (status === "failed" || status === "declined") {
        return {
          state: "blocked",
          detail: command,
          paths: [cwd],
          activityEvent: {
            type: "commandExecution",
            action: "ran",
            path: cwd,
            title: command,
            isImage: false
          }
        };
      }
      return {
        state: looksLikeValidationCommand(command) ? "validating" : "running",
        detail: command,
        paths: [cwd],
        activityEvent: {
          type: "commandExecution",
          action: "ran",
          path: cwd,
          title: command,
          isImage: false
        }
      };
    }
    case "webSearch": {
      const query = summarizeWebSearch(item);
      return {
        state: "scanning",
        detail: query,
        paths: [thread.cwd],
        activityEvent: {
          type: "webSearch",
          action: "updated",
          path: thread.cwd,
          title: query,
          isImage: false
        }
      };
    }
    case "dynamicToolCall":
    case "mcpToolCall": {
      const server = typeof item.server === "string" ? item.server : "mcp";
      const tool =
        typeof item.tool === "string" ? item.tool
        : typeof item.name === "string" ? item.name
        : "tool";
      const status = typeof item.status === "string" ? item.status : "inProgress";
      return {
        state: status === "failed" ? "blocked" : "scanning",
        detail: item.type === "dynamicToolCall" ? tool : `${server}.${tool}`,
        paths: [thread.cwd],
        activityEvent: {
          type: item.type,
          action: "updated",
          path: thread.cwd,
          title: item.type === "dynamicToolCall" ? tool : `${server}.${tool}`,
          isImage: false
        }
      };
    }
    case "collabAgentToolCall":
      return {
        state: "delegating",
        detail: "Delegating to another agent",
        paths: [thread.cwd],
        activityEvent: {
          type: "collabAgentToolCall",
          action: "updated",
          path: thread.cwd,
          title: "Delegating to another agent",
          isImage: false
        }
      };
    case "collabToolCall": {
      const tool = typeof item.tool === "string" ? item.tool : "subagents";
      const receiverThreadIds = [
        ...(Array.isArray(item.receiverThreadIds)
          ? item.receiverThreadIds.filter((entry): entry is string => typeof entry === "string")
          : []),
        ...(typeof item.receiverThreadId === "string" ? [item.receiverThreadId] : []),
        ...(typeof item.newThreadId === "string" ? [item.newThreadId] : [])
      ];
      const agentsStates =
        typeof item.agentsStates === "object" && item.agentsStates
          ? Object.values(item.agentsStates as Record<string, unknown>)
          : typeof item.agentStatus === "object" && item.agentStatus
          ? [item.agentStatus]
          : [];
      const activeAgents = agentsStates.filter((entry) => {
        return typeof entry === "object"
          && entry
          && typeof (entry as Record<string, unknown>).status === "string"
          && (entry as Record<string, unknown>).status !== "completed";
      }).length;
      const receiverCount = Math.max(receiverThreadIds.length, activeAgents);
      const label =
        tool === "wait"
          ? `Waiting on ${receiverCount || "subagent"} subagent${receiverCount === 1 ? "" : "s"}`
          : `Spawning ${receiverCount || "new"} subagent${receiverCount === 1 ? "" : "s"}`;
      return {
        state: "delegating",
        detail: label,
        paths: [thread.cwd],
        activityEvent: {
          type: "collabToolCall",
          action: "updated",
          path: thread.cwd,
          title: label,
          isImage: false
        }
      };
    }
    case "plan":
      return {
        state: "planning",
        detail: "Updating plan",
        paths: [thread.cwd],
        activityEvent: {
          type: "plan",
          action: "updated",
          path: thread.cwd,
          title: "Updating plan",
          isImage: false
        }
      };
    case "reasoning":
      return {
        state: "thinking",
        detail: "Reasoning",
        paths: [thread.cwd],
        activityEvent: {
          type: "reasoning",
          action: "updated",
          path: thread.cwd,
          title: "Reasoning",
          isImage: false
        }
      };
    case "imageView": {
      const imagePath = typeof item.path === "string" ? item.path : thread.cwd;
      return {
        state: "scanning",
        detail: imagePath ? `Viewing ${imagePath}` : "Viewing image",
        paths: [imagePath],
        activityEvent: {
          type: "imageView",
          action: "updated",
          path: imagePath,
          title: imagePath ? `Viewing ${imagePath}` : "Viewing image",
          isImage: true
        }
      };
    }
    case "enteredReviewMode": {
      const review = typeof item.review === "string" ? item.review : "Review";
      return {
        state: "validating",
        detail: shorten(review, 88),
        paths: [thread.cwd],
        activityEvent: {
          type: "enteredReviewMode",
          action: "updated",
          path: thread.cwd,
          title: "Review started",
          isImage: false
        }
      };
    }
    case "exitedReviewMode": {
      const review = typeof item.review === "string" ? item.review : "Review";
      return {
        state: treatAsInProgress ? "thinking" : "done",
        detail: shorten(review, 88),
        paths: [thread.cwd],
        activityEvent: {
          type: "exitedReviewMode",
          action: "updated",
          path: thread.cwd,
          title: "Review finished",
          isImage: false
        }
      };
    }
    case "contextCompaction":
      return {
        state: "thinking",
        detail: "Compacting context",
        paths: [thread.cwd],
        activityEvent: {
          type: "contextCompaction",
          action: "updated",
          path: thread.cwd,
          title: "Compacting context",
          isImage: false
        }
      };
    case "agentMessage":
      {
        const message = describeAgentMessage(item);
        const messagePhase = typeof item.phase === "string" ? item.phase : null;
        const isProvisionalReply =
          lastTurn.status !== "completed"
          && messagePhase !== "final_answer";
        return {
          state: treatAsInProgress || isProvisionalReply ? "thinking" : "done",
          detail: message.detail,
          paths: message.paths.length > 0 ? message.paths : [thread.cwd],
          activityEvent: {
            type: "agentMessage",
            action: "said",
            path: message.paths[0] ?? null,
            title: message.detail,
            isImage: false
          }
        };
      }
    case "userMessage": {
      const text = extractTextContent(item.content)[0] ?? "Assigned work";
      const paths = extractPathsFromText(text);
      const ageMs = Date.now() - thread.updatedAt * 1000;
      const promptIsFresh = ageMs <= USER_PROMPT_ACTIVE_WINDOW_MS;
      return {
        state: treatAsInProgress || promptIsFresh ? "planning" : "idle",
        detail: shorten(text, 88),
        paths: paths.length > 0 ? paths : [thread.cwd],
        activityEvent: {
          type: "userMessage",
          action: "updated",
          path: paths[0] ?? thread.cwd,
          title: shorten(text, 88),
          isImage: false
        }
      };
    }
    default:
      break;
  }

  const ageMs = Date.now() - thread.updatedAt * 1000;
  return {
    state:
      treatAsInProgress ? "thinking"
      : interruptedWithoutFinalAnswer ? (ageMs <= DONE_WINDOW_MS ? "done" : "idle")
      : ageMs <= DONE_WINDOW_MS ? "done"
      : "idle",
    detail:
      treatAsInProgress ? "Thinking"
      : interruptedWithoutFinalAnswer ? (ageMs <= DONE_WINDOW_MS ? "Interrupted" : "Idle")
      : ageMs <= DONE_WINDOW_MS ? "Finished recently"
      : "Idle",
    paths: [thread.cwd],
    activityEvent: null
  };
}

function buildActivityEventFromDashboardEvent(event: DashboardEvent): AgentActivityEvent | null {
  switch (event.kind) {
    case "fileChange":
      return {
        type: "fileChange",
        action: event.action ?? "edited",
        path: event.path,
        title: event.title,
        isImage: Boolean(event.isImage),
        linesAdded: event.linesAdded,
        linesRemoved: event.linesRemoved
      };
    case "command":
      return {
        type: "commandExecution",
        action: "ran",
        path: event.path,
        title: event.command ?? event.detail ?? event.title,
        isImage: false
      };
    case "message":
      return {
        type: "agentMessage",
        action: "said",
        path: event.path,
        title: event.detail || event.title,
        isImage: false
      };
    default:
      return null;
  }
}

function applyRecentActivityEvent(
  thread: CodexThread,
  summary: ReturnType<typeof summariseThread>,
  recentEvents: DashboardEvent[]
): ReturnType<typeof summariseThread> {
  if (recentEvents.length === 0) {
    return summary;
  }

  const updatedAtMs = thread.updatedAt * 1000;
  const preferredEvent = recentEvents
    .filter((event) => {
      if (event.threadId !== thread.id) {
        return false;
      }
      if (!["fileChange", "command", "message"].includes(event.kind)) {
        return false;
      }
      const createdAtMs = Date.parse(event.createdAt);
      return Number.isFinite(createdAtMs) && createdAtMs >= updatedAtMs - EVENT_ACTIVITY_WINDOW_MS;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .find((event) => event.kind === "fileChange" || event.kind === "command" || event.kind === "message");

  if (!preferredEvent) {
    return summary;
  }

  if (summary.state === "waiting" || summary.state === "blocked") {
    return summary;
  }

  const activityEvent = buildActivityEventFromDashboardEvent(preferredEvent);
  if (!activityEvent) {
    return summary;
  }

  const nextPaths = preferredEvent.path
    ? Array.from(new Set([preferredEvent.path, ...summary.paths.filter(Boolean)]))
    : summary.paths;

  if (preferredEvent.kind === "message") {
    return {
      state: summary.state,
      detail: preferredEvent.detail || summary.detail,
      paths: nextPaths,
      activityEvent
    };
  }
  const commandText = preferredEvent.command ?? preferredEvent.detail ?? preferredEvent.title;
  const nextState =
    preferredEvent.kind === "fileChange"
      ? (
        preferredEvent.phase === "failed" ? "blocked"
        : preferredEvent.phase === "started" || preferredEvent.phase === "updated" ? "editing"
        : summary.state
      )
      : preferredEvent.kind === "command"
        ? (
          preferredEvent.phase === "failed" ? "blocked"
          : preferredEvent.phase === "started" || preferredEvent.phase === "updated"
            ? (looksLikeValidationCommand(commandText) ? "validating" : "running")
            : summary.state
        )
        : summary.state;

  return {
    state: nextState,
    detail:
      preferredEvent.kind === "fileChange"
        ? preferredEvent.path ? `Edited ${preferredEvent.path}` : preferredEvent.title
        : commandText,
    paths: nextPaths,
    activityEvent
  };
}

export function filterProjectCloudTasks(tasks: CloudTask[], projectRoot: string): CloudTask[] {
  return tasks.filter((task) => {
    const label = task.environmentLabel?.toLowerCase();
    if (!label) {
      return false;
    }
    return label.includes(basename(projectRoot).toLowerCase());
  });
}

function matchesProjectCloudTask(task: CloudTask, projectRoot: string): boolean {
  const label = task.environmentLabel?.toLowerCase();
  if (!label) {
    return false;
  }
  return label.includes(basename(projectRoot).toLowerCase());
}

async function buildLocalAgents(
  projectRoot: string,
  localLimit: number,
  notes: string[],
  readThreads = true
): Promise<CodexThread[]> {
  try {
    return await withAppServerClient(async (client) => {
      const allThreads = await client.listThreads({
        cwd: projectRoot,
        limit: Math.max(localLimit * 4, 40)
      });
      const availableThreadsById = new Map(allThreads.map((thread) => [thread.id, thread]));
      const trackedThreads = new Map(allThreads.slice(0, localLimit).map((thread) => [thread.id, thread]));
      const pendingParents = [...trackedThreads.values()];
      while (pendingParents.length > 0) {
        const thread = pendingParents.shift();
        if (!thread) {
          continue;
        }
        const parentThreadId = parentThreadIdForThread(thread);
        if (!parentThreadId || trackedThreads.has(parentThreadId)) {
          continue;
        }
        const parentThread = availableThreadsById.get(parentThreadId);
        if (!parentThread) {
          continue;
        }
        trackedThreads.set(parentThread.id, parentThread);
        pendingParents.push(parentThread);
      }
      const threads = [...trackedThreads.values()];
      if (!readThreads) {
        return threads;
      }
      return Promise.all(threads.map((thread) => client.readThread(thread.id)));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(`Local Codex app-server unavailable: ${message}`);
    return [];
  }
}

export async function buildDashboardSnapshotFromState(input: {
  projectRoot: string;
  threads: CodexThread[];
  cloudTasks?: CloudTask[];
  events?: DashboardEvent[];
  notes?: string[];
  needsUserByThreadId?: Map<string, NeedsUserState>;
  subscribedThreadIds?: Set<string>;
  stoppedAtByThreadId?: Map<string, number>;
  ongoingThreadIds?: Set<string>;
}): Promise<DashboardSnapshot> {
  const projectRoot = input.projectRoot;
  const roomConfig = await loadRoomConfig(projectRoot);
  const notes = [...(input.notes ?? [])];
  const agents: DashboardAgent[] = [];
  const recentEventsByThreadId = new Map<string, DashboardEvent[]>();

  for (const event of input.events ?? []) {
    if (!event.threadId) {
      continue;
    }
    const existing = recentEventsByThreadId.get(event.threadId) ?? [];
    existing.push(event);
    recentEventsByThreadId.set(event.threadId, existing);
  }

  const threads = [...input.threads].sort((left, right) => right.updatedAt - left.updatedAt);

  for (const thread of threads) {
    const inferredOngoing =
      (input.ongoingThreadIds?.has(thread.id) ?? false)
      || isOngoingThread(thread);
    const summary = applyRecentActivityEvent(
      thread,
      summariseThread(thread),
      recentEventsByThreadId.get(thread.id) ?? []
    );
    const stoppedAtMs =
      inferredOngoing ? null
      : input.stoppedAtByThreadId
        ? (input.stoppedAtByThreadId.get(thread.id) ?? null)
        : !input.ongoingThreadIds && thread.status.type !== "active" && (summary.state === "done" || summary.state === "idle")
          ? thread.updatedAt * 1000
          : null;
    const latestMessage = latestAgentMessageForThread(thread);
    const appearance = await ensureAgentAppearance(projectRoot, thread.id);
    const sourceMeta = parseThreadSourceMeta(thread);
    const resolvedRole = inferThreadAgentRole(thread, sourceMeta.sourceKind);
    agents.push({
      id: thread.id,
      label: pickThreadLabel(thread),
      source: "local",
      sourceKind: sourceMeta.sourceKind,
      parentThreadId: sourceMeta.parentThreadId,
      depth: sourceMeta.depth,
      isCurrent: false,
      isOngoing: inferredOngoing,
      statusText: thread.status.type,
      role: resolvedRole,
      nickname: thread.agentNickname,
      isSubagent: Boolean(resolvedRole),
      state: summary.state,
      detail: summary.detail,
      cwd: thread.cwd,
      roomId: findRoomForPaths(roomConfig, projectRoot, summary.paths),
      appearance,
      updatedAt: new Date(thread.updatedAt * 1000).toISOString(),
      stoppedAt: stoppedAtMs ? new Date(stoppedAtMs).toISOString() : null,
      paths: summary.paths,
      activityEvent: summary.activityEvent,
      latestMessage,
      threadId: thread.id,
      taskId: null,
      resumeCommand: `codex resume ${thread.id}`,
      url: null,
      git: thread.gitInfo,
      provenance: "codex",
      confidence: "typed",
      needsUser: input.needsUserByThreadId?.get(thread.id) ?? null,
      liveSubscription: input.subscribedThreadIds?.has(thread.id) ? "subscribed" : "readOnly"
    });
  }

  const cloudTasks = input.cloudTasks ?? [];
  for (const task of cloudTasks) {
    const appearance = await ensureAgentAppearance(projectRoot, task.id);
    agents.push({
      id: task.id,
      label: task.title,
      source: "cloud",
      sourceKind: "cloud",
      parentThreadId: null,
      depth: 0,
      isCurrent: false,
      isOngoing: false,
      statusText: task.status,
      role: null,
      nickname: null,
      isSubagent: false,
      state: "cloud",
      detail: `${task.status} · ${task.summary.filesChanged} files`,
      cwd: null,
      roomId: null,
      appearance,
      updatedAt: task.updatedAt,
      stoppedAt: null,
      paths: [],
      activityEvent: null,
      latestMessage: null,
      threadId: null,
      taskId: task.id,
      resumeCommand: null,
      url: task.url,
      git: null,
      provenance: "cloud",
      confidence: "typed",
      needsUser: null,
      liveSubscription: "readOnly"
    });
  }

  const presenceAgents = await loadFreshPresenceAgents(projectRoot);
  for (const presenceAgent of presenceAgents) {
    agents.push({
      ...presenceAgent,
      roomId: findRoomForPaths(roomConfig, projectRoot, presenceAgent.paths),
      isOngoing: false,
      stoppedAt: null,
      activityEvent: null,
      latestMessage: null,
      provenance: "presence",
      confidence: "typed",
      needsUser: null,
      liveSubscription: "readOnly"
    });
  }

  const claudeAgents = await loadClaudeAgents(projectRoot);
  for (const claudeAgent of claudeAgents) {
    agents.push({
      ...claudeAgent,
      roomId: findRoomForPaths(roomConfig, projectRoot, claudeAgent.paths)
    });
  }

  try {
    const cursorAgents = await loadCursorAgents(projectRoot);
    for (const cursorAgent of cursorAgents) {
      agents.push({
        ...cursorAgent,
        roomId: findRoomForPaths(roomConfig, projectRoot, cursorAgent.paths)
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(`Cursor background agents unavailable: ${message}`);
  }

  for (const agent of agents) {
    agent.isCurrent = isCurrentWorkloadAgent(agent);
  }

  return {
    projectRoot,
    generatedAt: new Date().toISOString(),
    rooms: roomConfig,
    agents,
    cloudTasks,
    events: [...(input.events ?? [])]
      .filter((event) => {
        const createdAtMs = Date.parse(event.createdAt);
        return Number.isFinite(createdAtMs) && Date.now() - createdAtMs <= SNAPSHOT_EVENT_WINDOW_MS;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    notes
  };
}

export async function buildDashboardSnapshot(
  options: SnapshotOptions
): Promise<DashboardSnapshot> {
  const projectRoot = options.projectRoot;
  const notes: string[] = [];

  const threads = await buildLocalAgents(
    projectRoot,
    options.localLimit ?? DEFAULT_LOCAL_THREAD_LIMIT,
    notes,
    options.readThreads !== false
  );
  let cloudTasks: CloudTask[] = [];
  if (options.includeCloud !== false) {
    try {
      const listedCloudTasks = await listCloudTasks(10);
      cloudTasks = filterProjectCloudTasks(listedCloudTasks, projectRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notes.push(`Codex cloud list unavailable: ${message}`);
    }
  }

  return buildDashboardSnapshotFromState({
    projectRoot,
    threads,
    cloudTasks,
    notes
  });
}
