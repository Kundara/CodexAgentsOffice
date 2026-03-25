import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign
} from "node:crypto";
import { basename } from "node:path";

import { ensureAgentAppearance } from "./appearance";
import {
  canonicalizeProjectPath,
  sameProjectPath,
  type DiscoveredProject
} from "./project-paths";
import type { ActivityState, DashboardAgent } from "./types";

const DEFAULT_OPENCLAW_GATEWAY_URL = "ws://127.0.0.1:18789";
const OPENCLAW_REQUEST_TIMEOUT_MS = 4000;
const OPENCLAW_CONNECT_TIMEOUT_MS = 2500;
const OPENCLAW_CACHE_TTL_MS = 5000;
const OPENCLAW_DISCOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const OPENCLAW_PROTOCOL_VERSION = 1;

interface OpenClawGatewayResponse<T> {
  type?: string;
  id?: string;
  ok?: boolean;
  payload?: T;
  error?: {
    message?: string;
    code?: string;
  };
}

interface OpenClawGatewayEvent {
  type?: string;
  event?: string;
  payload?: Record<string, unknown> | null;
}

interface OpenClawGatewayAgentListResponse {
  defaultId?: string;
  agents?: OpenClawGatewayAgent[];
}

interface OpenClawGatewayAgent {
  id: string;
  name?: string;
  identity?: {
    name?: string;
  };
}

interface OpenClawGatewayConfigResponse {
  config?: {
    agents?: {
      defaults?: {
        workspace?: string;
      };
      list?: Array<{
        id?: string;
        name?: string;
        workspace?: string;
      }>;
    };
  };
}

interface OpenClawGatewaySessionsResponse {
  sessions?: OpenClawSessionRow[];
}

interface OpenClawSessionRow {
  key: string;
  spawnedBy?: string;
  kind?: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  updatedAt?: number | null;
  status?: "running" | "done" | "failed" | "killed" | "timeout";
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  parentSessionKey?: string;
  childSessions?: string[];
  modelProvider?: string;
  model?: string;
}

interface OpenClawWorkspaceAgent {
  agentId: string;
  name: string | null;
  workspaceRoot: string;
  isDefault: boolean;
}

interface OpenClawWorkspaceData {
  fetchedAt: number;
  agents: OpenClawWorkspaceAgent[];
  sessions: OpenClawSessionRow[];
}

type OpenClawSocket = {
  close: (code?: number, reason?: string) => void;
  send: (data: string) => void;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: (type: string, listener: (event: unknown) => void) => void;
};

type OpenClawPendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

let cachedWorkspaceData: Promise<OpenClawWorkspaceData | null> | null = null;
let cachedWorkspaceDataAt = 0;
let cachedIdentity: {
  deviceId: string;
  publicKeyRawBase64Url: string;
  privateKeyPem: string;
} | null = null;

function openClawEnabled(): boolean {
  return [
    process.env.OPENCLAW_GATEWAY_URL,
    process.env.OPENCLAW_GATEWAY_TOKEN,
    process.env.OPENCLAW_GATEWAY_PASSWORD
  ].some((value) => typeof value === "string" && value.trim().length > 0);
}

function openClawGatewayUrl(): string {
  const configured = process.env.OPENCLAW_GATEWAY_URL;
  if (typeof configured !== "string" || configured.trim().length === 0) {
    return DEFAULT_OPENCLAW_GATEWAY_URL;
  }
  return configured.trim();
}

function openClawGatewayToken(): string | undefined {
  const configured = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (typeof configured !== "string") {
    return undefined;
  }
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function openClawGatewayPassword(): string | undefined {
  const configured = process.env.OPENCLAW_GATEWAY_PASSWORD;
  if (typeof configured !== "string") {
    return undefined;
  }
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function openClawTimeoutError(label: string, timeoutMs: number): Error {
  return new Error(`OpenClaw ${label} timed out after ${timeoutMs}ms`);
}

function shorten(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function normalizeAgentIdFromSessionKey(sessionKey: string | null | undefined): string | null {
  if (typeof sessionKey !== "string") {
    return null;
  }
  const match = sessionKey.trim().match(/^agent:([^:]+):/i);
  return match ? match[1].trim().toLowerCase() : null;
}

function cachedOpenClawIdentity() {
  if (cachedIdentity) {
    return cachedIdentity;
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const publicKeyRaw = publicKeyDer.subarray(publicKeyDer.length - 32);
  cachedIdentity = {
    deviceId: createHash("sha256").update(publicKeyRaw).digest("hex"),
    publicKeyRawBase64Url: base64UrlEncode(publicKeyRaw),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
  return cachedIdentity;
}

function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string;
  nonce: string;
  platform?: string;
  deviceFamily?: string;
}): string {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    params.platform ?? "",
    params.deviceFamily ?? ""
  ].join("|");
}

function onceSocketEvent(
  socket: OpenClawSocket,
  eventType: string,
  timeoutMs: number,
  predicate?: (event: unknown) => boolean
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(openClawTimeoutError(eventType, timeoutMs));
    }, timeoutMs);

    const onEvent = (event: unknown) => {
      if (predicate && !predicate(event)) {
        return;
      }
      cleanup();
      resolve(event);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener(eventType, onEvent);
    };

    socket.addEventListener(eventType, onEvent);
  });
}

function readSocketMessageData(event: unknown): string {
  const candidate =
    typeof event === "object" && event && "data" in (event as Record<string, unknown>)
      ? (event as Record<string, unknown>).data
      : null;
  if (typeof candidate === "string") {
    return candidate;
  }
  if (candidate instanceof ArrayBuffer) {
    return Buffer.from(candidate).toString("utf8");
  }
  if (ArrayBuffer.isView(candidate)) {
    return Buffer.from(candidate.buffer, candidate.byteOffset, candidate.byteLength).toString("utf8");
  }
  return "";
}

class OpenClawGatewayClient {
  private readonly socket: OpenClawSocket;
  private readonly pending = new Map<string, OpenClawPendingRequest>();
  private connectNonce: string | null = null;
  private closed = false;

  constructor(socket: OpenClawSocket) {
    this.socket = socket;
    this.socket.addEventListener("message", (event) => this.onMessage(event));
    this.socket.addEventListener("close", () => this.failAll(new Error("OpenClaw gateway closed")));
    this.socket.addEventListener("error", () => this.failAll(new Error("OpenClaw gateway error")));
  }

  static async connect(): Promise<OpenClawGatewayClient> {
    const WebSocketCtor = globalThis.WebSocket as unknown as { new(url: string): OpenClawSocket };
    if (typeof WebSocketCtor !== "function") {
      throw new Error("WebSocket runtime unavailable");
    }

    const socket = new WebSocketCtor(openClawGatewayUrl());
    await onceSocketEvent(socket, "open", OPENCLAW_CONNECT_TIMEOUT_MS);
    const client = new OpenClawGatewayClient(socket);
    await client.handshake();
    return client;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.failAll(new Error("OpenClaw gateway client closed"));
    this.socket.close(1000, "done");
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) {
      throw new Error("OpenClaw gateway client already closed");
    }

    const id = randomUUID();
    const frame = JSON.stringify({
      type: "req",
      id,
      method,
      params
    });

    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(openClawTimeoutError(method, OPENCLAW_REQUEST_TIMEOUT_MS));
      }, OPENCLAW_REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout
      });

      this.socket.send(frame);
    });
  }

  private async handshake(): Promise<void> {
    this.connectNonce = await this.waitForConnectChallenge();
    const identity = cachedOpenClawIdentity();
    const clientId = "codex-agents-office";
    const clientMode = "backend";
    const role = "operator";
    const scopes = ["operator.read"];
    const signedAtMs = Date.now();
    const signaturePayload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: openClawGatewayToken(),
      nonce: this.connectNonce,
      platform: process.platform,
      deviceFamily: "desktop"
    });

    const signature = base64UrlEncode(
      sign(null, Buffer.from(signaturePayload, "utf8"), identity.privateKeyPem)
    );

    await this.request("connect", {
      minProtocol: OPENCLAW_PROTOCOL_VERSION,
      maxProtocol: OPENCLAW_PROTOCOL_VERSION,
      client: {
        id: clientId,
        displayName: "Codex Agents Office",
        version: "0.1.0",
        platform: process.platform,
        mode: clientMode
      },
      caps: [],
      commands: [],
      role,
      scopes,
      auth: openClawGatewayToken() || openClawGatewayPassword()
        ? {
            token: openClawGatewayToken(),
            password: openClawGatewayPassword()
          }
        : undefined,
      device: {
        id: identity.deviceId,
        publicKey: identity.publicKeyRawBase64Url,
        signature,
        signedAt: signedAtMs,
        nonce: this.connectNonce
      }
    });
  }

  private async waitForConnectChallenge(): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(openClawTimeoutError("connect.challenge", OPENCLAW_CONNECT_TIMEOUT_MS));
      }, OPENCLAW_CONNECT_TIMEOUT_MS);

      const onMessage = (event: unknown) => {
        const text = readSocketMessageData(event);
        if (!text) {
          return;
        }

        let parsed: OpenClawGatewayEvent;
        try {
          parsed = JSON.parse(text) as OpenClawGatewayEvent;
        } catch {
          return;
        }

        if (parsed.type !== "event" || parsed.event !== "connect.challenge") {
          return;
        }

        const nonce = typeof parsed.payload?.nonce === "string" ? parsed.payload.nonce.trim() : "";
        if (!nonce) {
          return;
        }

        cleanup();
        resolve(nonce);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.removeEventListener("message", onMessage);
      };

      this.socket.addEventListener("message", onMessage);
    });
  }

  private onMessage(event: unknown): void {
    const text = readSocketMessageData(event);
    if (!text) {
      return;
    }

    let parsed: OpenClawGatewayResponse<unknown>;
    try {
      parsed = JSON.parse(text) as OpenClawGatewayResponse<unknown>;
    } catch {
      return;
    }

    if (parsed.type !== "res" || typeof parsed.id !== "string") {
      return;
    }

    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }

    this.pending.delete(parsed.id);
    clearTimeout(pending.timeout);

    if (parsed.ok) {
      pending.resolve(parsed.payload);
      return;
    }

    pending.reject(
      new Error(parsed.error?.message ?? parsed.error?.code ?? "OpenClaw gateway request failed")
    );
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }
}

function sessionRowTimestamp(row: OpenClawSessionRow): number {
  if (typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt)) {
    return row.updatedAt;
  }
  if (typeof row.endedAt === "number" && Number.isFinite(row.endedAt)) {
    return row.endedAt;
  }
  if (typeof row.startedAt === "number" && Number.isFinite(row.startedAt)) {
    return row.startedAt;
  }
  return Number.NaN;
}

function workspaceAgentsFromGatewayData(input: {
  config: OpenClawGatewayConfigResponse["config"];
  gatewayAgents: OpenClawGatewayAgent[];
  defaultAgentId: string | null;
}): OpenClawWorkspaceAgent[] {
  const workspaceAgents = new Map<string, OpenClawWorkspaceAgent>();
  const configuredAgents = Array.isArray(input.config?.agents?.list) ? input.config.agents.list : [];
  const defaultWorkspace = canonicalizeProjectPath(input.config?.agents?.defaults?.workspace ?? null);
  const gatewayAgentNames = new Map<string, string | null>();

  for (const agent of input.gatewayAgents) {
    gatewayAgentNames.set(
      agent.id.trim().toLowerCase(),
      agent.name?.trim() || agent.identity?.name?.trim() || null
    );
  }

  for (const configuredAgent of configuredAgents) {
    const agentId = typeof configuredAgent?.id === "string" ? configuredAgent.id.trim().toLowerCase() : "";
    if (!agentId) {
      continue;
    }

    const workspaceRoot = canonicalizeProjectPath(configuredAgent.workspace ?? null);
    if (!workspaceRoot) {
      continue;
    }

    workspaceAgents.set(agentId, {
      agentId,
      name:
        configuredAgent.name?.trim()
        || gatewayAgentNames.get(agentId)
        || null,
      workspaceRoot,
      isDefault: input.defaultAgentId === agentId
    });
  }

  if (input.defaultAgentId && defaultWorkspace && !workspaceAgents.has(input.defaultAgentId)) {
    workspaceAgents.set(input.defaultAgentId, {
      agentId: input.defaultAgentId,
      name: gatewayAgentNames.get(input.defaultAgentId) ?? null,
      workspaceRoot: defaultWorkspace,
      isDefault: true
    });
  }

  return [...workspaceAgents.values()];
}

function openClawDisplayLabel(params: {
  row: OpenClawSessionRow;
  agent: OpenClawWorkspaceAgent;
}): string {
  return (
    params.row.label?.trim()
    || params.row.displayName?.trim()
    || params.row.derivedTitle?.trim()
    || params.agent.name?.trim()
    || params.row.key
  );
}

function openClawLatestMessage(row: OpenClawSessionRow): string | null {
  const preview = row.lastMessagePreview?.trim() ?? "";
  return preview.length > 0 ? preview : null;
}

export function openClawSessionToActivityState(params: {
  row: OpenClawSessionRow;
  activeChildCount: number;
}): ActivityState {
  if (params.activeChildCount > 0) {
    return "delegating";
  }

  switch (params.row.status) {
    case "running":
      return "thinking";
    case "done":
      return "done";
    case "failed":
    case "killed":
    case "timeout":
      return "blocked";
    default:
      return "idle";
  }
}

export function openClawSessionDetail(params: {
  row: OpenClawSessionRow;
  activeChildCount: number;
}): string {
  if (params.activeChildCount > 0) {
    return `Delegating to ${params.activeChildCount} session${params.activeChildCount === 1 ? "" : "s"}`;
  }

  const preview = openClawLatestMessage(params.row);
  if (preview) {
    return shorten(preview, 88);
  }

  if (params.row.derivedTitle?.trim()) {
    return shorten(params.row.derivedTitle, 88);
  }

  switch (params.row.status) {
    case "running":
      return "Thinking";
    case "done":
      return "Finished recently";
    case "failed":
      return "Session failed";
    case "killed":
      return "Session stopped";
    case "timeout":
      return "Session timed out";
    default:
      return "Idle";
  }
}

function sessionDepthForKey(
  key: string,
  parentByKey: Map<string, string | null>,
  seen = new Set<string>()
): number {
  const parent = parentByKey.get(key) ?? null;
  if (!parent) {
    return 0;
  }
  if (seen.has(key) || seen.has(parent)) {
    return 1;
  }
  seen.add(key);
  return 1 + sessionDepthForKey(parent, parentByKey, seen);
}

async function loadOpenClawWorkspaceDataUncached(): Promise<OpenClawWorkspaceData | null> {
  if (!openClawEnabled()) {
    return null;
  }

  const client = await OpenClawGatewayClient.connect();
  try {
    const [configResult, agentsResult, sessionsResult] = await Promise.all([
      client.request<OpenClawGatewayConfigResponse>("config.get", {}),
      client.request<OpenClawGatewayAgentListResponse>("agents.list", {}),
      client.request<OpenClawGatewaySessionsResponse>("sessions.list", {
        includeGlobal: false,
        includeUnknown: false,
        includeDerivedTitles: true,
        includeLastMessage: true
      })
    ]);

    const defaultAgentId =
      typeof agentsResult?.defaultId === "string" && agentsResult.defaultId.trim().length > 0
        ? agentsResult.defaultId.trim().toLowerCase()
        : null;

    return {
      fetchedAt: Date.now(),
      agents: workspaceAgentsFromGatewayData({
        config: configResult?.config,
        gatewayAgents: Array.isArray(agentsResult?.agents) ? agentsResult.agents : [],
        defaultAgentId
      }),
      sessions: Array.isArray(sessionsResult?.sessions) ? sessionsResult.sessions : []
    };
  } finally {
    await client.close();
  }
}

async function loadOpenClawWorkspaceData(): Promise<OpenClawWorkspaceData | null> {
  const now = Date.now();
  if (cachedWorkspaceData && now - cachedWorkspaceDataAt <= OPENCLAW_CACHE_TTL_MS) {
    return await cachedWorkspaceData;
  }

  cachedWorkspaceDataAt = now;
  cachedWorkspaceData = loadOpenClawWorkspaceDataUncached().catch((error) => {
    cachedWorkspaceData = null;
    cachedWorkspaceDataAt = 0;
    throw error;
  });
  return await cachedWorkspaceData;
}

export function openClawWorkspaceMatchesProject(
  workspaceRoot: string | null | undefined,
  projectRoot: string
): boolean {
  return sameProjectPath(workspaceRoot, projectRoot);
}

export async function discoverOpenClawProjects(limit = 20): Promise<DiscoveredProject[]> {
  const data = await loadOpenClawWorkspaceData();
  if (!data) {
    return [];
  }

  const recentCutoff = Date.now() - OPENCLAW_DISCOVERY_WINDOW_MS;
  const projects = new Map<string, DiscoveredProject>();
  const workspaceByAgentId = new Map(data.agents.map((agent) => [agent.agentId, agent.workspaceRoot]));

  for (const session of data.sessions) {
    const updatedAt = sessionRowTimestamp(session);
    if (!Number.isFinite(updatedAt) || updatedAt < recentCutoff) {
      continue;
    }

    const agentId = normalizeAgentIdFromSessionKey(session.key);
    const workspaceRoot = agentId ? workspaceByAgentId.get(agentId) ?? null : null;
    if (!workspaceRoot) {
      continue;
    }

    const existing = projects.get(workspaceRoot);
    if (existing) {
      existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
      existing.count += 1;
      continue;
    }

    projects.set(workspaceRoot, {
      root: workspaceRoot,
      label: openClawSessionWorkspaceLabel(workspaceRoot) ?? workspaceRoot,
      updatedAt,
      count: 1
    });
  }

  return [...projects.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}

export async function loadOpenClawAgents(projectRoot: string): Promise<DashboardAgent[]> {
  const data = await loadOpenClawWorkspaceData();
  if (!data) {
    return [];
  }

  const matchedAgents = data.agents.filter((agent) =>
    openClawWorkspaceMatchesProject(agent.workspaceRoot, projectRoot)
  );
  if (matchedAgents.length === 0) {
    return [];
  }

  const matchedAgentIds = new Set(matchedAgents.map((agent) => agent.agentId));
  const agentById = new Map(matchedAgents.map((agent) => [agent.agentId, agent]));
  const relevantSessions = data.sessions.filter((session) => {
    const agentId = normalizeAgentIdFromSessionKey(session.key);
    return Boolean(agentId && matchedAgentIds.has(agentId));
  });

  const parentByKey = new Map<string, string | null>();
  const activeChildCountByKey = new Map<string, number>();
  for (const session of relevantSessions) {
    parentByKey.set(session.key, session.parentSessionKey?.trim() || null);
  }
  for (const session of relevantSessions) {
    const parentKey = session.parentSessionKey?.trim() || null;
    if (!parentKey) {
      continue;
    }
    const state = openClawSessionToActivityState({ row: session, activeChildCount: 0 });
    if (state === "done" || state === "idle") {
      continue;
    }
    activeChildCountByKey.set(parentKey, (activeChildCountByKey.get(parentKey) ?? 0) + 1);
  }

  const agents: DashboardAgent[] = [];
  for (const session of relevantSessions.sort((left, right) => {
    return sessionRowTimestamp(right) - sessionRowTimestamp(left);
  })) {
    const agentId = normalizeAgentIdFromSessionKey(session.key);
    if (!agentId) {
      continue;
    }

    const agent = agentById.get(agentId);
    if (!agent) {
      continue;
    }

    const updatedAtMs = sessionRowTimestamp(session);
    if (!Number.isFinite(updatedAtMs)) {
      continue;
    }

    const activeChildCount = activeChildCountByKey.get(session.key) ?? 0;
    const state = openClawSessionToActivityState({
      row: session,
      activeChildCount
    });
    const sourceKind =
      session.modelProvider && session.model
        ? `openclaw:${session.modelProvider}/${session.model}`
        : session.model
          ? `openclaw:${session.model}`
          : "openclaw";

    agents.push({
      id: `openclaw:${session.key}`,
      label: openClawDisplayLabel({ row: session, agent }),
      source: "openclaw",
      sourceKind,
      parentThreadId: session.parentSessionKey ? `openclaw:${session.parentSessionKey}` : null,
      depth: sessionDepthForKey(session.key, parentByKey),
      isCurrent: false,
      isOngoing: session.status === "running",
      statusText: session.status ?? null,
      role: agent.isDefault ? (agent.name ?? "openclaw") : agent.agentId,
      nickname: agent.name,
      isSubagent: Boolean(session.parentSessionKey),
      state,
      detail: openClawSessionDetail({ row: session, activeChildCount }),
      cwd: agent.workspaceRoot,
      roomId: null,
      appearance: await ensureAgentAppearance(projectRoot, `openclaw:${session.key}`),
      updatedAt: new Date(updatedAtMs).toISOString(),
      stoppedAt:
        typeof session.endedAt === "number" && Number.isFinite(session.endedAt)
          ? new Date(session.endedAt).toISOString()
          : null,
      paths: [agent.workspaceRoot],
      activityEvent: null,
      latestMessage: openClawLatestMessage(session),
      threadId: session.key,
      taskId: null,
      resumeCommand: null,
      url: null,
      git: null,
      provenance: "openclaw",
      confidence: "typed",
      needsUser: null,
      liveSubscription: "readOnly",
      network: null
    });
  }

  return agents;
}

export function openClawSessionWorkspaceLabel(
  workspaceRoot: string | null | undefined
): string | null {
  const canonical = canonicalizeProjectPath(workspaceRoot);
  if (!canonical) {
    return null;
  }
  return basename(canonical) || canonical;
}
