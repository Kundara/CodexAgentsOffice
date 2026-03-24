import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ensureAgentAppearance } from "./appearance";
import type { ActivityState, DashboardAgent } from "./types";

const execFileAsync = promisify(execFile);

const DEFAULT_CURSOR_API_BASE_URL = "https://api.cursor.com";
const DEFAULT_CURSOR_AGENT_LIMIT = 24;

interface RawCursorListResponse {
  agents?: RawCursorAgent[];
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
  };
  target?: {
    url?: string;
    branchName?: string;
    prUrl?: string | null;
    autoCreatePr?: boolean;
  };
  model?: string;
}

function cursorApiKey(): string | null {
  const value = process.env.CURSOR_API_KEY;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

export function normalizeRepositoryUrl(input: string | null | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const scpLikeMatch = trimmed.match(/^git@([^:]+):(.+)$/i);
  if (scpLikeMatch) {
    const host = scpLikeMatch[1].toLowerCase();
    const path = scpLikeMatch[2].replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
    return `https://${host}/${path}`.toLowerCase();
  }

  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.toLowerCase();
    const normalizedProtocol =
      protocol === "ssh:" || protocol === "git:" ? "https:" : protocol;
    const pathname = url.pathname.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
    return `${normalizedProtocol}//${url.hostname.toLowerCase()}/${pathname}`.toLowerCase();
  } catch {
    return trimmed.replace(/\.git$/i, "").replace(/[\\/]+$/, "").toLowerCase();
  }
}

export function cursorStatusToActivityState(status: string | null | undefined): ActivityState {
  const normalized = typeof status === "string" ? status.trim().toUpperCase() : "";
  switch (normalized) {
    case "CREATING":
    case "RUNNING":
      return "running";
    case "FINISHED":
      return "done";
    case "ERROR":
      return "blocked";
    case "EXPIRED":
      return "idle";
    default:
      return "idle";
  }
}

function isCursorAgentOngoing(status: string | null | undefined): boolean {
  const normalized = typeof status === "string" ? status.trim().toUpperCase() : "";
  return normalized === "CREATING" || normalized === "RUNNING";
}

function sourceKindFromModel(model: string | null | undefined): string {
  return model && model.trim().length > 0 ? `cursor:${model.trim()}` : "cursor";
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

async function gitRemoteOriginUrl(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectRoot, "config", "--get", "remote.origin.url"]);
    return normalizeRepositoryUrl(stdout);
  } catch {
    return null;
  }
}

async function listCursorBackgroundAgents(limit = cursorAgentLimit()): Promise<RawCursorAgent[]> {
  const apiKey = cursorApiKey();
  if (!apiKey) {
    return [];
  }

  const url = new URL("/v0/agents", cursorApiBaseUrl());
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body.trim();
    throw new Error(
      detail.length > 0
        ? `Cursor API ${response.status}: ${detail}`
        : `Cursor API ${response.status}: ${response.statusText}`
    );
  }

  const parsed = await response.json() as RawCursorListResponse;
  return Array.isArray(parsed.agents) ? parsed.agents : [];
}

export async function loadCursorAgents(projectRoot: string, limit = cursorAgentLimit()): Promise<DashboardAgent[]> {
  const apiKey = cursorApiKey();
  if (!apiKey) {
    return [];
  }

  const repositoryUrl = await gitRemoteOriginUrl(projectRoot);
  if (!repositoryUrl) {
    return [];
  }

  const listedAgents = await listCursorBackgroundAgents(limit);
  const matchingAgents = listedAgents.filter((agent) => {
    const candidate = normalizeRepositoryUrl(agent.source?.repository);
    return candidate !== null && candidate === repositoryUrl;
  });

  const agents: DashboardAgent[] = [];
  for (const agent of matchingAgents) {
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
      activityEvent: null,
      latestMessage: summary,
      threadId: null,
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
      liveSubscription: "readOnly"
    });
  }

  return agents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
