import { basename } from "node:path";

import { ensureAgentAppearance } from "./appearance";
import { withAppServerClient } from "./app-server";
import { listCloudTasks } from "./cloud";
import { loadFreshPresenceAgents } from "./presence";
import { findRoomForPaths, loadRoomConfig } from "./room-config";
import { isCurrentWorkloadAgent } from "./workload";
import type {
  ActivityState,
  CloudTask,
  CodexThread,
  CodexTurn,
  DashboardAgent,
  DashboardSnapshot,
  SnapshotOptions,
  ThreadItem
} from "./types";

const DONE_WINDOW_MS = 15 * 60 * 1000;

function shorten(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
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
  const text = typeof item.text === "string" ? item.text : "Responding";
  return {
    detail: shorten(text, 88),
    paths: extractPathsFromText(text)
  };
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

function inferThreadAgentRole(thread: CodexThread, sourceKind: string): string | null {
  if (sourceKind === "subAgent") {
    const previewRole = extractPromptRole(thread.preview);
    if (previewRole && previewRole !== "default") {
      return previewRole;
    }

    const userMessageRole = [...thread.turns]
      .reverse()
      .flatMap((turn) => [...turn.items].reverse())
      .find((item) => item.type === "userMessage");
    const extractedUserRole = userMessageRole
      ? extractPromptRole(extractTextContent(userMessageRole.content)[0] ?? null)
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

function selectRelevantItem(items: ThreadItem[]): ThreadItem | null {
  const priority = [
    "fileChange",
    "commandExecution",
    "mcpToolCall",
    "webSearch",
    "collabToolCall",
    "collabAgentToolCall",
    "plan",
    "reasoning",
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
} {
  if (thread.status.type === "systemError") {
    return {
      state: "blocked",
      detail: "System error",
      paths: [thread.cwd]
    };
  }

  if (thread.status.type === "active" && thread.status.activeFlags?.includes("waitingOnApproval")) {
    return {
      state: "blocked",
      detail: "Waiting on approval",
      paths: [thread.cwd]
    };
  }

  if (thread.status.type === "active" && thread.status.activeFlags?.includes("waitingOnUserInput")) {
    return {
      state: "waiting",
      detail: "Waiting on user input",
      paths: [thread.cwd]
    };
  }

  const lastTurn = thread.turns.at(-1);
  if (!lastTurn) {
    return {
      state: "idle",
      detail: "No turns yet",
      paths: [thread.cwd]
    };
  }

  const treatAsInProgress =
    lastTurn.status === "inProgress"
    || (lastTurn.status === "interrupted" && !turnHasFinalAnswer(lastTurn));

  if (lastTurn.status === "failed") {
    return {
      state: "blocked",
      detail: lastTurn.error?.message ?? "Turn failed",
      paths: [thread.cwd]
    };
  }

  const item = selectRelevantItem(lastTurn.items);
  if (!item) {
    return {
      state: treatAsInProgress ? "thinking" : "idle",
      detail: treatAsInProgress ? "Thinking" : "Idle",
      paths: [thread.cwd]
    };
  }

  switch (item.type) {
    case "fileChange": {
      const paths = extractStringArray(item.changes, "path");
      const primaryPath = paths[0];
      const status = typeof item.status === "string" ? item.status : "inProgress";
      const state = status === "failed" || status === "declined" ? "blocked" : "editing";
      return {
        state,
        detail: primaryPath ? `Editing ${primaryPath}` : "Editing files",
        paths: paths.length > 0 ? paths : [thread.cwd]
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
          paths: [cwd]
        };
      }
      return {
        state: looksLikeValidationCommand(command) ? "validating" : "running",
        detail: command,
        paths: [cwd]
      };
    }
    case "webSearch": {
      const query = typeof item.query === "string" ? item.query : "Web search";
      return {
        state: "scanning",
        detail: query,
        paths: [thread.cwd]
      };
    }
    case "mcpToolCall": {
      const server = typeof item.server === "string" ? item.server : "mcp";
      const tool = typeof item.tool === "string" ? item.tool : "tool";
      const status = typeof item.status === "string" ? item.status : "inProgress";
      return {
        state: status === "failed" ? "blocked" : "scanning",
        detail: `${server}.${tool}`,
        paths: [thread.cwd]
      };
    }
    case "collabAgentToolCall":
      return {
        state: "delegating",
        detail: "Delegating to another agent",
        paths: [thread.cwd]
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
        paths: [thread.cwd]
      };
    }
    case "plan":
      return {
        state: "planning",
        detail: "Updating plan",
        paths: [thread.cwd]
      };
    case "reasoning":
      return {
        state: "thinking",
        detail: "Reasoning",
        paths: [thread.cwd]
      };
    case "agentMessage":
      {
        const message = describeAgentMessage(item);
        return {
          state: treatAsInProgress ? "thinking" : "done",
          detail: message.detail,
          paths: message.paths.length > 0 ? message.paths : [thread.cwd]
        };
      }
    case "userMessage": {
      const text = extractTextContent(item.content)[0] ?? "Assigned work";
      const paths = extractPathsFromText(text);
      return {
        state: treatAsInProgress ? "planning" : "idle",
        detail: shorten(text, 88),
        paths: paths.length > 0 ? paths : [thread.cwd]
      };
    }
    default:
      break;
  }

  const ageMs = Date.now() - thread.updatedAt * 1000;
  return {
    state: treatAsInProgress ? "thinking" : ageMs <= DONE_WINDOW_MS ? "done" : "idle",
    detail: treatAsInProgress ? "Thinking" : ageMs <= DONE_WINDOW_MS ? "Finished recently" : "Idle",
    paths: [thread.cwd]
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
  notes: string[]
): Promise<CodexThread[]> {
  try {
    return await withAppServerClient(async (client) => {
      const threads = await client.listThreads({
        cwd: projectRoot,
        limit: localLimit
      });
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
  notes?: string[];
}): Promise<DashboardSnapshot> {
  const projectRoot = input.projectRoot;
  const roomConfig = await loadRoomConfig(projectRoot);
  const notes = [...(input.notes ?? [])];
  const agents: DashboardAgent[] = [];

  const threads = [...input.threads].sort((left, right) => right.updatedAt - left.updatedAt);

  for (const thread of threads) {
    const summary = summariseThread(thread);
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
      paths: summary.paths,
      threadId: thread.id,
      taskId: null,
      resumeCommand: `codex resume ${thread.id}`,
      url: null,
      git: thread.gitInfo
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
      paths: [],
      threadId: null,
      taskId: task.id,
      resumeCommand: null,
      url: task.url,
      git: null
    });
  }

  const presenceAgents = await loadFreshPresenceAgents(projectRoot);
  for (const presenceAgent of presenceAgents) {
    agents.push({
      ...presenceAgent,
      roomId: findRoomForPaths(roomConfig, projectRoot, presenceAgent.paths)
    });
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
    notes
  };
}

export async function buildDashboardSnapshot(
  options: SnapshotOptions
): Promise<DashboardSnapshot> {
  const projectRoot = options.projectRoot;
  const notes: string[] = [];

  const threads = await buildLocalAgents(projectRoot, options.localLimit ?? 10, notes);
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
