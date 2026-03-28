import { ensureAgentAppearance } from "./appearance";
import { getStoredCursorApiKeySync } from "./app-settings";
import {
  cursorStatusToActivityState,
  gitRemoteOriginUrl,
  normalizeRepositoryUrl,
  sourceKindFromModel
} from "./cursor-lib/shared";
import { projectLabelFromRoot } from "./project-paths";
import type { ActivityState, AgentActivityEvent, DashboardAgent, DashboardEvent } from "./types";

const DEFAULT_CURSOR_API_BASE_URL = "https://api.cursor.com";
const DEFAULT_CURSOR_AGENT_LIMIT = 24;
const CURSOR_API_PAGE_SIZE = 100;
const CURSOR_CLOUD_CONVERSATION_WINDOW_MS = 30 * 60 * 1000;

interface RawCursorListResponse {
  agents?: RawCursorAgent[];
  nextCursor?: string | null;
}

interface RawCursorAgent {
  id: string;
  name?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  summary?: string;
  source?: {
    repository?: string;
    ref?: string;
    prUrl?: string | null;
  };
  target?: {
    url?: string;
    branchName?: string;
    prUrl?: string | null;
    autoCreatePr?: boolean;
  };
  model?: string;
}

interface RawCursorConversationResponse {
  messages?: RawCursorConversationMessage[];
}

interface RawCursorConversationMessage {
  id?: string;
  type?: string;
  text?: string;
  createdAt?: string;
}

function cursorApiKey(): string | null {
  const value = process.env.CURSOR_API_KEY;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return getStoredCursorApiKeySync();
}

export function cursorApiKeyConfigured(): boolean {
  return cursorApiKey() !== null;
}

function cursorApiBaseUrl(): string {
  const configured = process.env.CURSOR_API_BASE_URL;
  if (typeof configured !== "string" || configured.trim().length === 0) {
    return DEFAULT_CURSOR_API_BASE_URL;
  }
  return configured.trim().replace(/[\\/]+$/, "");
}

function cursorAgentLimit(): number {
  const raw = Number.parseInt(process.env.CURSOR_AGENT_LIMIT ?? "", 10);
  if (!Number.isFinite(raw)) {
    return DEFAULT_CURSOR_AGENT_LIMIT;
  }
  return Math.max(1, Math.min(100, raw));
}

function isCursorAgentOngoing(status: string | null | undefined): boolean {
  const normalized = typeof status === "string" ? status.trim().toUpperCase() : "";
  return normalized === "CREATING" || normalized === "RUNNING";
}

function cursorDetail(agent: RawCursorAgent): string {
  const status = typeof agent.status === "string" ? agent.status.trim() : "UNKNOWN";
  const branchName = agent.target?.branchName ?? null;
  const prUrl = agent.target?.prUrl ?? null;
  const summary = typeof agent.summary === "string" ? agent.summary.trim() : "";
  if (summary) {
    return summary;
  }
  if (branchName && prUrl) {
    return `${status} · ${branchName} · PR ready`;
  }
  if (branchName) {
    return `${status} · ${branchName}`;
  }
  return status;
}

export async function describeCursorAgentAvailability(projectRoot: string): Promise<string | null> {
  if (!cursorApiKeyConfigured()) {
    return "Cursor background agents disabled: CURSOR_API_KEY is not configured for this process.";
  }

  const repositoryUrl = await gitRemoteOriginUrl(projectRoot);
  if (!repositoryUrl) {
    return "Cursor background agents unavailable for this project: git remote.origin.url is missing.";
  }

  return null;
}

function cursorAuthHeader(apiKey: string, scheme: "basic" | "bearer"): string {
  if (scheme === "basic") {
    const token = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
    return `Basic ${token}`;
  }
  return `Bearer ${apiKey}`;
}

async function fetchCursorListPage(
  apiKey: string,
  cursor: string | null,
  pageSize: number
): Promise<RawCursorListResponse> {
  const url = new URL("/v0/agents", cursorApiBaseUrl());
  url.searchParams.set("limit", String(pageSize));
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  return fetchCursorJson<RawCursorListResponse>(apiKey, url);
}

async function fetchCursorJson<T>(apiKey: string, url: URL): Promise<T> {
  let firstFailure: Error | null = null;
  for (const scheme of ["basic", "bearer"] as const) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: cursorAuthHeader(apiKey, scheme)
      }
    });

    if (response.ok) {
      return await response.json() as T;
    }

    const body = await response.text().catch(() => "");
    const detail = body.trim();
    const error = new Error(
      detail.length > 0
        ? `Cursor API ${response.status}: ${detail}`
        : `Cursor API ${response.status}: ${response.statusText}`
    );
    if (firstFailure === null) {
      firstFailure = error;
    }

    if (scheme === "basic" && (response.status === 401 || response.status === 403)) {
      continue;
    }
    throw error;
  }

  throw firstFailure ?? new Error("Cursor API request failed");
}

async function listCursorBackgroundAgents(limit = cursorAgentLimit()): Promise<RawCursorAgent[]> {
  const apiKey = cursorApiKey();
  if (!apiKey) {
    return [];
  }

  const agents: RawCursorAgent[] = [];
  let cursor: string | null = null;

  while (agents.length < limit) {
    const pageSize = Math.min(CURSOR_API_PAGE_SIZE, limit - agents.length);
    const parsed = await fetchCursorListPage(apiKey, cursor, pageSize);
    const pageAgents = Array.isArray(parsed.agents) ? parsed.agents : [];
    agents.push(...pageAgents);

    const nextCursor = typeof parsed.nextCursor === "string" && parsed.nextCursor.trim().length > 0
      ? parsed.nextCursor.trim()
      : null;
    if (!nextCursor || pageAgents.length === 0) {
      break;
    }
    cursor = nextCursor;
  }

  return agents;
}

function cursorAgentRepositories(agent: Pick<RawCursorAgent, "source" | "target">): string[] {
  const candidates = [
    agent.source?.repository,
    agent.source?.prUrl,
    agent.target?.prUrl
  ]
    .map((value) => normalizeRepositoryUrl(value))
    .filter((value): value is string => value !== null);
  return [...new Set(candidates)];
}

export function cursorAgentMatchesRepository(
  agent: Pick<RawCursorAgent, "source" | "target">,
  repositoryUrl: string | null | undefined
): boolean {
  const normalizedRepository = normalizeRepositoryUrl(repositoryUrl);
  if (normalizedRepository === null) {
    return false;
  }
  return cursorAgentRepositories(agent).includes(normalizedRepository);
}

function cursorConversationMessageType(
  message: Pick<RawCursorConversationMessage, "type">
): AgentActivityEvent["type"] | null {
  const normalized = typeof message.type === "string" ? message.type.trim().toLowerCase() : "";
  switch (normalized) {
    case "user_message":
    case "user":
      return "userMessage";
    case "assistant_message":
    case "assistant":
      return "agentMessage";
    default:
      return null;
  }
}

function cursorConversationMessageText(message: Pick<RawCursorConversationMessage, "text">): string | null {
  if (typeof message.text !== "string") {
    return null;
  }
  const normalized = message.text.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

async function fetchCursorAgentConversation(apiKey: string, agentId: string): Promise<RawCursorConversationMessage[]> {
  const url = new URL(`/v0/agents/${encodeURIComponent(agentId)}/conversation`, cursorApiBaseUrl());
  const parsed = await fetchCursorJson<RawCursorConversationResponse>(apiKey, url);
  return Array.isArray(parsed.messages) ? parsed.messages : [];
}

function shouldFetchCursorAgentConversation(agent: RawCursorAgent, nowMs: number): boolean {
  if (isCursorAgentOngoing(agent.status)) {
    return true;
  }
  const updatedAtMs = Date.parse(agent.updatedAt ?? agent.createdAt ?? "");
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }
  return nowMs - updatedAtMs <= CURSOR_CLOUD_CONVERSATION_WINDOW_MS;
}

function cursorConversationEvent(input: {
  projectRoot: string;
  agentId: string;
  message: RawCursorConversationMessage;
  createdAt: string;
}): DashboardEvent | null {
  const messageId = typeof input.message.id === "string" ? input.message.id.trim() : "";
  const type = cursorConversationMessageType(input.message);
  const text = cursorConversationMessageText(input.message);
  if (messageId.length === 0 || !type || !text) {
    return null;
  }

  return {
    id: `${input.projectRoot}::cursor-cloud::${input.agentId}::${messageId}`,
    source: "cursor",
    confidence: "typed",
    threadId: input.agentId,
    createdAt: input.createdAt,
    method: type === "userMessage" ? "cursor/cloud/userMessage" : "cursor/cloud/agentMessage",
    itemId: messageId,
    itemType: type === "userMessage" ? "user_message" : "assistant_message",
    kind: "message",
    phase: "updated",
    title: type === "userMessage" ? "Cursor prompt" : "Cursor reply",
    detail: text,
    path: input.projectRoot,
    action: "said",
    isImage: false
  };
}

export async function loadCursorCloudProjectSnapshotData(
  projectRoot: string,
  options?: {
    limit?: number;
    knownConversationMessageIds?: Map<string, Set<string>>;
    emitConversationEvents?: boolean;
  }
): Promise<{ agents: DashboardAgent[]; events: DashboardEvent[] }> {
  const limit = options?.limit ?? cursorAgentLimit();
  const apiKey = cursorApiKey();
  if (!apiKey) {
    return { agents: [], events: [] };
  }

  const repositoryUrl = await gitRemoteOriginUrl(projectRoot);
  if (!repositoryUrl) {
    return { agents: [], events: [] };
  }

  const listedAgents = await listCursorBackgroundAgents(limit);
  const matchingAgents = listedAgents.filter((agent) => cursorAgentMatchesRepository(agent, repositoryUrl));
  const nowMs = Date.now();
  const knownConversationMessageIds = options?.knownConversationMessageIds ?? new Map<string, Set<string>>();
  const emitConversationEvents = options?.emitConversationEvents ?? false;
  const conversations = new Map<string, RawCursorConversationMessage[]>();

  await Promise.all(matchingAgents.map(async (agent) => {
    if (!shouldFetchCursorAgentConversation(agent, nowMs)) {
      return;
    }
    try {
      conversations.set(agent.id, await fetchCursorAgentConversation(apiKey, agent.id));
    } catch {
      // Conversation polling is best-effort; keep status-only agent visibility when it fails.
    }
  }));

  const agents: DashboardAgent[] = [];
  const events: DashboardEvent[] = [];
  for (const agent of matchingAgents) {
    const conversation = conversations.get(agent.id) ?? [];
    const latestAssistantMessage = conversation
      .slice()
      .reverse()
      .find((message) => cursorConversationMessageType(message) === "agentMessage" && cursorConversationMessageText(message)) ?? null;
    const appearance = await ensureAgentAppearance(projectRoot, `cursor:${agent.id}`);
    const state = cursorStatusToActivityState(agent.status);
    const updatedAt = agent.updatedAt ?? agent.createdAt ?? new Date().toISOString();
    const label = typeof agent.name === "string" && agent.name.trim().length > 0
      ? agent.name.trim()
      : `Cursor ${agent.id}`;
    const detail = cursorDetail(agent);
    const branchName = agent.target?.branchName ?? agent.source?.ref ?? null;
    const repository = normalizeRepositoryUrl(agent.source?.repository);
    const summary = typeof agent.summary === "string" && agent.summary.trim().length > 0
      ? agent.summary.trim()
      : null;
    const latestAssistantText = latestAssistantMessage ? cursorConversationMessageText(latestAssistantMessage) : null;
    const activityEvent: AgentActivityEvent | null = latestAssistantText
      ? {
        type: "agentMessage",
        action: "said",
        path: projectRoot,
        title: latestAssistantText,
        isImage: false
      }
      : null;

    const knownIds = knownConversationMessageIds.get(agent.id) ?? new Set<string>();
    if (!knownConversationMessageIds.has(agent.id)) {
      knownConversationMessageIds.set(agent.id, knownIds);
    }
    conversation.forEach((message, index) => {
      const messageId = typeof message.id === "string" ? message.id.trim() : "";
      if (messageId.length === 0) {
        return;
      }
      const seen = knownIds.has(messageId);
      knownIds.add(messageId);
      if (!emitConversationEvents || seen) {
        return;
      }
      const createdAt = typeof message.createdAt === "string" && Number.isFinite(Date.parse(message.createdAt))
        ? new Date(message.createdAt).toISOString()
        : new Date(nowMs + index).toISOString();
      const event = cursorConversationEvent({
        projectRoot,
        agentId: agent.id,
        message,
        createdAt
      });
      if (event) {
        events.push(event);
      }
    });

    agents.push({
      id: `cursor:${agent.id}`,
      label,
      source: "cursor",
      sourceKind: sourceKindFromModel(agent.model),
      parentThreadId: null,
      depth: 0,
      isCurrent: false,
      isOngoing: isCursorAgentOngoing(agent.status),
      statusText: agent.status ?? null,
      role: "cursor",
      nickname: null,
      isSubagent: false,
      state,
      detail,
      cwd: projectRoot,
      roomId: null,
      appearance,
      updatedAt,
      stoppedAt: state === "done" || state === "blocked" || state === "idle" ? updatedAt : null,
      paths: [projectRoot],
      activityEvent,
      latestMessage: latestAssistantMessage ? (cursorConversationMessageText(latestAssistantMessage) ?? summary) : summary,
      threadId: agent.id,
      taskId: agent.id,
      resumeCommand: null,
      url: agent.target?.url ?? null,
      git: {
        sha: null,
        branch: branchName,
        originUrl: repository
      },
      provenance: "cursor",
      confidence: "typed",
      needsUser: null,
      liveSubscription: "readOnly",
      network: null
    });
  }

  return {
    agents: agents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    events: events.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  };
}

export async function loadCursorAgents(projectRoot: string, limit = cursorAgentLimit()): Promise<DashboardAgent[]> {
  return (await loadCursorCloudProjectSnapshotData(projectRoot, { limit })).agents;
}
