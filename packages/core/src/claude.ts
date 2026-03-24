import { open, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";

import { ensureAgentAppearance } from "./appearance";
import type { DiscoveredProject } from "./project-paths";
import type { AgentActivityEvent, ActivityState, AgentConfidence, DashboardAgent, NeedsUserState } from "./types";

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
const LOG_HEAD_BYTES = 4096;
const LOG_TAIL_BYTES = 65536;
const RECENT_MESSAGE_WINDOW_MS = 5 * 60 * 1000;
const RECENT_DONE_WINDOW_MS = 15 * 60 * 1000;

interface ClaudeProjectDir {
  root: string;
  dirPath: string;
  updatedAt: number;
  count: number;
  files: Array<{ path: string; updatedAt: number }>;
}

interface ClaudeActivitySummary {
  label: string;
  sourceKind: string;
  state: ActivityState;
  detail: string;
  updatedAt: string;
  paths: string[];
  activityEvent: AgentActivityEvent | null;
  gitBranch: string | null;
  confidence: AgentConfidence;
  needsUser: NeedsUserState | null;
  latestMessage: string | null;
  isOngoing: boolean;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function canonicalizeProjectPath(input: string | null | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const raw = input.trim();
  if (!raw) {
    return null;
  }

  const windowsDriveMatch = raw.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (windowsDriveMatch) {
    const drive = windowsDriveMatch[1].toLowerCase();
    const rest = windowsDriveMatch[2].replace(/\\/g, "/");
    return trimTrailingSlash(`/mnt/${drive}/${rest}`);
  }

  if (raw.startsWith("/")) {
    return trimTrailingSlash(raw.replace(/\\/g, "/"));
  }

  return trimTrailingSlash(raw.replace(/\\/g, "/"));
}

function shorten(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function isMeaningfulTranscriptText(text: string | null | undefined): text is string {
  if (typeof text !== "string") {
    return false;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  return !/^[.\-_~`"'!,;:|/\\()[\]{}]+$/.test(normalized);
}

function parseJsonLines(text: string, dropFirstPartial = false): Array<Record<string, unknown>> {
  const lines = text.split(/\r?\n/);
  const usable = dropFirstPartial ? lines.slice(1) : lines;
  const records: Array<Record<string, unknown>> = [];

  for (const line of usable) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed === "object" && parsed) {
        records.push(parsed as Record<string, unknown>);
      }
    } catch {
      continue;
    }
  }

  return records;
}

async function readSegment(path: string, start: number, length: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readLogSample(path: string): Promise<{
  mtimeMs: number;
  headRecords: Array<Record<string, unknown>>;
  tailRecords: Array<Record<string, unknown>>;
}> {
  const handle = await open(path, "r");
  try {
    const stats = await handle.stat();
    const headLength = Math.min(Number(stats.size), LOG_HEAD_BYTES);
    const tailLength = Math.min(Number(stats.size), LOG_TAIL_BYTES);
    const tailStart = Math.max(0, Number(stats.size) - tailLength);
    const [head, tail] = await Promise.all([
      readSegment(path, 0, headLength),
      readSegment(path, tailStart, tailLength)
    ]);
    return {
      mtimeMs: stats.mtimeMs,
      headRecords: parseJsonLines(head),
      tailRecords: parseJsonLines(tail, tailStart > 0)
    };
  } finally {
    await handle.close();
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : null;
}

function parseTimestampMs(value: unknown): number {
  if (typeof value !== "string") {
    return Number.NaN;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function messageObject(record: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(record.message);
}

function recordTimestampMs(record: Record<string, unknown>, fallback: number): number {
  const parsed = parseTimestampMs(record.timestamp);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractTextEntries(content: unknown): string[] {
  if (typeof content === "string") {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return [];
    }

    if (record.type === "text" && typeof record.text === "string") {
      return [record.text];
    }

    if (record.type === "tool_result" && typeof record.content === "string") {
      return [record.content];
    }

    return [];
  });
}

function extractUserText(record: Record<string, unknown>): string | null {
  if (record.type !== "user") {
    return null;
  }

  const message = messageObject(record);
  if (!message) {
    return null;
  }

  if (typeof message.content === "string") {
    return isMeaningfulTranscriptText(message.content) ? message.content : null;
  }

  const text = extractTextEntries(message.content).find((entry) => isMeaningfulTranscriptText(entry));
  return text ?? null;
}

function extractAssistantText(record: Record<string, unknown>): string | null {
  if (record.type !== "assistant") {
    return null;
  }

  const message = messageObject(record);
  if (!message) {
    return null;
  }

  const text = extractTextEntries(message.content).find((entry) => isMeaningfulTranscriptText(entry));
  return text ?? null;
}

function extractAssistantTool(record: Record<string, unknown>): { name: string; input: Record<string, unknown> } | null {
  if (record.type !== "assistant") {
    return null;
  }

  const message = messageObject(record);
  if (!message || !Array.isArray(message.content)) {
    return null;
  }

  for (const entry of [...message.content].reverse()) {
    const item = asRecord(entry);
    if (!item || item.type !== "tool_use" || typeof item.name !== "string") {
      continue;
    }
    return {
      name: item.name,
      input: asRecord(item.input) ?? {}
    };
  }

  return null;
}

function extractPathsFromText(text: string): string[] {
  const matches = text.match(/(?:[A-Za-z]:[\\/][^\s`'"]+|\/[^\s`'"]+)/g) ?? [];
  return Array.from(new Set(matches.map((entry) => canonicalizeProjectPath(entry) ?? entry)));
}

function extractToolPaths(input: Record<string, unknown>): string[] {
  const values: string[] = [];
  const directKeys = ["file_path", "path", "cwd"];

  for (const key of directKeys) {
    const value = input[key];
    if (typeof value === "string") {
      values.push(value);
    }
  }

  for (const key of ["paths", "files"]) {
    const value = input[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      if (typeof entry === "string") {
        values.push(entry);
        continue;
      }
      const record = asRecord(entry);
      if (!record) {
        continue;
      }
      for (const nestedKey of ["file_path", "path"]) {
        if (typeof record[nestedKey] === "string") {
          values.push(record[nestedKey] as string);
        }
      }
    }
  }

  return Array.from(
    new Set(
      values
        .map((value) => canonicalizeProjectPath(value) ?? value)
        .filter((value) => typeof value === "string" && value.length > 0)
    )
  );
}

function looksLikeValidationCommand(command: string): boolean {
  return /\b(test|tests|lint|build|check|verify|pytest|cargo test|go test|npm test|pnpm test|vitest|jest)\b/i.test(
    command
  );
}

function isImagePath(path: string | null): boolean {
  return Boolean(path && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path));
}

function claudeHooksFilePath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, ".codex-agents", "claude-hooks", `${sessionId}.jsonl`);
}

function stringValue(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function claudeToolSummary(input: {
  sessionId: string;
  model: string | null;
  fallbackCwd: string;
  gitBranch: string | null;
  updatedAt: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  failed?: boolean;
}): ClaudeActivitySummary | null {
  const toolName = input.toolName.trim();
  const toolPaths = extractToolPaths(input.toolInput);
  const primaryPath = toolPaths[0] ?? input.fallbackCwd;

  if (/(edit|write|multiedit)/i.test(toolName)) {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: input.failed ? "blocked" : "editing",
      detail: primaryPath ? `Editing ${primaryPath}` : "Editing files",
      updatedAt: input.updatedAt,
      paths: toolPaths.length > 0 ? toolPaths : [input.fallbackCwd],
      activityEvent: {
        type: "fileChange",
        action: "edited",
        path: primaryPath ?? null,
        title: primaryPath ? `edit ${primaryPath}` : "Editing files",
        isImage: isImagePath(primaryPath ?? null)
      },
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: !input.failed
    };
  }

  if (/(bash|shell)/i.test(toolName)) {
    const command =
      typeof input.toolInput.command === "string" ? input.toolInput.command
      : typeof input.toolInput.cmd === "string" ? input.toolInput.cmd
      : toolName;
    const cwd =
      canonicalizeProjectPath(typeof input.toolInput.cwd === "string" ? input.toolInput.cwd : null)
      ?? input.fallbackCwd;
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: input.failed ? "blocked" : looksLikeValidationCommand(command) ? "validating" : "running",
      detail: command,
      updatedAt: input.updatedAt,
      paths: cwd ? [cwd] : [],
      activityEvent: {
        type: "commandExecution",
        action: "ran",
        path: cwd ?? null,
        title: command,
        isImage: false
      },
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: !input.failed
    };
  }

  if (/(read|grep|glob|search|ls|list)/i.test(toolName)) {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: input.failed ? "blocked" : "scanning",
      detail: primaryPath ? `Reading ${primaryPath}` : `Using ${toolName}`,
      updatedAt: input.updatedAt,
      paths: toolPaths.length > 0 ? toolPaths : [input.fallbackCwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: !input.failed
    };
  }

  if (/(task|delegate|agent)/i.test(toolName)) {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: input.failed ? "blocked" : "delegating",
      detail: input.failed ? "Delegation failed" : "Delegating work",
      updatedAt: input.updatedAt,
      paths: [input.fallbackCwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: !input.failed
    };
  }

  return null;
}

export function summariseClaudeHookRecord(input: {
  sessionId: string;
  model: string | null;
  fallbackCwd: string;
  gitBranch: string | null;
  record: Record<string, unknown>;
  fallbackUpdatedAt: number;
}): ClaudeActivitySummary | null {
  const hookEventName = typeof input.record.hook_event_name === "string" ? input.record.hook_event_name : null;
  if (!hookEventName) {
    return null;
  }

  const cwd =
    canonicalizeProjectPath(typeof input.record.cwd === "string" ? input.record.cwd : null)
    ?? input.fallbackCwd;
  const updatedAt = new Date(recordTimestampMs(input.record, input.fallbackUpdatedAt)).toISOString();
  const toolName = typeof input.record.tool_name === "string" ? input.record.tool_name : "";
  const toolInput = asRecord(input.record.tool_input) ?? {};
  const requestId =
    stringValue(input.record, "request_id", "requestId")
    ?? `${input.sessionId}:${hookEventName}:${updatedAt}`;

  if (hookEventName === "PermissionRequest") {
    const detail =
      typeof toolInput.command === "string" ? toolInput.command
      : extractToolPaths(toolInput)[0]
      ?? toolName
      ?? "Permission requested";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "blocked",
      detail: shorten(detail, 88),
      updatedAt,
      paths: extractToolPaths(toolInput).length > 0 ? extractToolPaths(toolInput) : [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: {
        kind: "approval",
        requestId,
        reason: stringValue(input.record, "reason", "message") ?? shorten(detail, 88),
        command: stringValue(toolInput, "command", "cmd") ?? undefined,
        cwd,
        grantRoot: extractToolPaths(toolInput)[0] ?? undefined
      },
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "Elicitation") {
    const detail =
      typeof input.record.prompt === "string" ? input.record.prompt
      : typeof input.record.message === "string" ? input.record.message
      : "Waiting on input";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "waiting",
      detail: shorten(detail, 88),
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: {
        kind: "input",
        requestId,
        reason: shorten(detail, 88),
        cwd
      },
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "UserPromptSubmit") {
    const detail = stringValue(input.record, "prompt", "message", "text") ?? "Updated plan";
    const paths = extractPathsFromText(detail);
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail: shorten(detail, 88),
      updatedAt,
      paths: paths.length > 0 ? paths : [cwd],
      activityEvent: {
        type: "userMessage",
        action: "said",
        path: paths[0] ?? cwd,
        title: shorten(detail, 88),
        isImage: false
      },
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "SessionStart") {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail: "Session started",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "SessionEnd") {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "done",
      detail: "Session ended",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: false
    };
  }

  if (hookEventName === "PreCompact") {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "thinking",
      detail: "Compacting context",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "SubagentStart") {
    const detail =
      typeof input.record.agent_type === "string" ? `Spawning ${input.record.agent_type} subagent`
      : "Spawning subagent";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "delegating",
      detail,
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "SubagentStop") {
    const detail =
      typeof input.record.agent_type === "string" ? `${input.record.agent_type} subagent finished`
      : "Subagent finished";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "done",
      detail,
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: false
    };
  }

  if (hookEventName === "StopFailure") {
    const detail =
      typeof input.record.error === "string" ? input.record.error
      : typeof input.record.reason === "string" ? input.record.reason
      : "Claude turn failed";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "blocked",
      detail: shorten(detail, 88),
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: false
    };
  }

  if (hookEventName === "Stop" || hookEventName === "TaskCompleted") {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "done",
      detail: hookEventName === "TaskCompleted" ? "Task completed" : "Finished recently",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: false
    };
  }

  if (hookEventName === "PreToolUse" || hookEventName === "PostToolUse" || hookEventName === "PostToolUseFailure") {
    return claudeToolSummary({
      sessionId: input.sessionId,
      model: input.model,
      fallbackCwd: cwd,
      gitBranch: input.gitBranch,
      updatedAt,
      toolName,
      toolInput,
      failed: hookEventName === "PostToolUseFailure"
    });
  }

  return null;
}

function sourceKindFromModel(model: string | null): string {
  return model ? `claude:${model}` : "claude";
}

function labelFromModel(model: string | null, sessionId: string): string {
  if (!model) {
    return `Claude ${sessionId.slice(0, 4)}`;
  }

  const normalized = model
    .replace(/^claude-/i, "")
    .replace(/-\d{8}$/i, "")
    .replace(/-/g, " ")
    .trim();
  return `Claude ${shorten(normalized, 18)}`;
}

function extractProjectRoot(records: Array<Record<string, unknown>>): string | null {
  for (const record of records) {
    const root = canonicalizeProjectPath(typeof record.cwd === "string" ? record.cwd : null);
    if (root) {
      return root;
    }
  }
  return null;
}

async function scanClaudeProjectDirs(): Promise<ClaudeProjectDir[]> {
  let projectEntries;
  try {
    projectEntries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects: ClaudeProjectDir[] = [];

  for (const entry of projectEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dirPath = join(CLAUDE_PROJECTS_DIR, entry.name);
    const fileEntries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
    const files = await Promise.all(
      fileEntries
        .filter((file) => file.isFile() && file.name.endsWith(".jsonl"))
        .map(async (file) => {
          const path = join(dirPath, file.name);
          const sample = await readLogSample(path).catch(() => null);
          if (!sample) {
            return null;
          }
          return {
            path,
            updatedAt: sample.mtimeMs,
            root: extractProjectRoot([...sample.headRecords, ...sample.tailRecords])
          };
        })
    );

    const validFiles = files.filter((file): file is { path: string; updatedAt: number; root: string | null } => Boolean(file));
    if (validFiles.length === 0) {
      continue;
    }

    const newestFile = [...validFiles].sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (!newestFile.root) {
      continue;
    }

    projects.push({
      root: newestFile.root,
      dirPath,
      updatedAt: newestFile.updatedAt,
      count: validFiles.length,
      files: validFiles
        .map((file) => ({ path: file.path, updatedAt: file.updatedAt }))
        .sort((left, right) => right.updatedAt - left.updatedAt)
    });
  }

  return projects.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function summariseClaudeSession(
  sessionId: string,
  fallbackCwd: string,
  records: Array<Record<string, unknown>>,
  fallbackUpdatedAt: number,
  hookRecords: Array<Record<string, unknown>> = []
): ClaudeActivitySummary {
  const ordered = [...records].sort((left, right) => recordTimestampMs(left, fallbackUpdatedAt) - recordTimestampMs(right, fallbackUpdatedAt));
  const latestRecord = ordered.at(-1) ?? null;
  const latestAssistant = [...ordered].reverse().find((record) => record.type === "assistant") ?? null;
  const latestToolRecord = [...ordered].reverse().find((record) => Boolean(extractAssistantTool(record))) ?? null;
  const latestUserTextRecord = [...ordered].reverse().find((record) => Boolean(extractUserText(record))) ?? null;
  const latestAssistantTextRecord = [...ordered].reverse().find((record) => Boolean(extractAssistantText(record))) ?? null;

  const latestMessage = latestAssistant ? messageObject(latestAssistant) : null;
  const model = latestMessage && typeof latestMessage.model === "string" ? latestMessage.model : null;
  const updatedAtMs = latestRecord ? recordTimestampMs(latestRecord, fallbackUpdatedAt) : fallbackUpdatedAt;
  const updatedAt = new Date(updatedAtMs).toISOString();
  const gitBranch = latestRecord && typeof latestRecord.gitBranch === "string" ? latestRecord.gitBranch : null;
  const latestHookSummary = [...hookRecords]
    .reverse()
    .map((record) => summariseClaudeHookRecord({
      sessionId,
      model,
      fallbackCwd,
      gitBranch,
      record,
      fallbackUpdatedAt
    }))
    .find((summary): summary is ClaudeActivitySummary => Boolean(summary));

  if (latestHookSummary) {
    return latestHookSummary;
  }

  if (latestToolRecord) {
    const tool = extractAssistantTool(latestToolRecord);
    if (tool) {
      const toolSummary = claudeToolSummary({
        sessionId,
        model,
        fallbackCwd,
        gitBranch,
        updatedAt,
        toolName: tool.name,
        toolInput: tool.input,
        failed: false
      });
      if (toolSummary) {
        return {
          ...toolSummary,
          confidence: "inferred"
        };
      }
    }
  }

  if (latestUserTextRecord && (!latestAssistantTextRecord || recordTimestampMs(latestUserTextRecord, fallbackUpdatedAt) >= recordTimestampMs(latestAssistantTextRecord, fallbackUpdatedAt))) {
    const text = extractUserText(latestUserTextRecord) ?? "Assigned work";
    const paths = extractPathsFromText(text);
    return {
      label: labelFromModel(model, sessionId),
      sourceKind: sourceKindFromModel(model),
      state: "planning",
      detail: shorten(text, 88),
      updatedAt,
      paths: paths.length > 0 ? paths : [fallbackCwd],
      activityEvent: null,
      gitBranch,
      confidence: "inferred",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (latestAssistantTextRecord) {
    const text = extractAssistantText(latestAssistantTextRecord) ?? "Responded";
    const textPaths = extractPathsFromText(text);
    const ageMs = Date.now() - recordTimestampMs(latestAssistantTextRecord, fallbackUpdatedAt);
    const state =
      ageMs <= 2 * 60 * 1000 ? "thinking"
      : ageMs <= RECENT_DONE_WINDOW_MS ? "done"
      : "idle";
    return {
      label: labelFromModel(model, sessionId),
      sourceKind: sourceKindFromModel(model),
      state,
      detail: shorten(text, 88),
      updatedAt,
      paths: textPaths.length > 0 ? textPaths : [fallbackCwd],
      activityEvent:
        ageMs <= RECENT_MESSAGE_WINDOW_MS
          ? {
              type: "agentMessage",
              action: "said",
              path: textPaths[0] ?? fallbackCwd,
              title: shorten(text, 88),
              isImage: false
            }
          : null,
      gitBranch,
      confidence: "inferred",
      needsUser: null,
      latestMessage: text,
      isOngoing: ageMs <= RECENT_DONE_WINDOW_MS
    };
  }

  return {
    label: labelFromModel(model, sessionId),
    sourceKind: sourceKindFromModel(model),
    state: "idle",
    detail: "Idle",
    updatedAt,
    paths: [fallbackCwd],
    activityEvent: null,
    gitBranch,
    confidence: "inferred",
    needsUser: null,
    latestMessage: null,
    isOngoing: false
  };
}

export async function discoverClaudeProjects(limit = 50): Promise<DiscoveredProject[]> {
  const projects = await scanClaudeProjectDirs();
  return projects
    .slice(0, limit)
    .map((project) => ({
      root: project.root,
      label: basename(project.root) || project.root,
      updatedAt: project.updatedAt,
      count: project.count
    }));
}

export async function loadClaudeAgents(projectRoot: string, limit = 12): Promise<DashboardAgent[]> {
  const canonicalRoot = canonicalizeProjectPath(projectRoot);
  if (!canonicalRoot) {
    return [];
  }

  const projects = await scanClaudeProjectDirs();
  const project = projects.find((entry) => entry.root === canonicalRoot);
  if (!project) {
    return [];
  }

  const agents: DashboardAgent[] = [];
  for (const file of project.files.slice(0, limit)) {
    const sample = await readLogSample(file.path).catch(() => null);
    if (!sample) {
      continue;
    }

    const records = [...sample.headRecords, ...sample.tailRecords];
    const fallbackCwd = extractProjectRoot(records) ?? canonicalRoot;
    const sessionId = file.path.match(/([0-9a-f-]{36})\.jsonl$/i)?.[1] ?? file.path;
    const hookSample = await readLogSample(claudeHooksFilePath(canonicalRoot, sessionId)).catch(() => null);
    const hookRecords = hookSample ? [...hookSample.headRecords, ...hookSample.tailRecords] : [];
    const summary = summariseClaudeSession(
      sessionId,
      fallbackCwd,
      records,
      Math.max(file.updatedAt, hookSample?.mtimeMs ?? 0),
      hookRecords
    );
    const appearance = await ensureAgentAppearance(canonicalRoot, `claude:${sessionId}`);

    agents.push({
      id: `claude:${sessionId}`,
      label: summary.label,
      source: "claude",
      sourceKind: summary.sourceKind,
      parentThreadId: null,
      depth: 0,
      isCurrent: false,
      isOngoing: summary.isOngoing,
      statusText: "claude",
      role: "claude",
      nickname: null,
      isSubagent: false,
      state: summary.state,
      detail: summary.detail,
      cwd: fallbackCwd,
      roomId: null,
      appearance,
      updatedAt: summary.updatedAt,
      stoppedAt: null,
      paths: summary.paths,
      activityEvent: summary.activityEvent,
      latestMessage: summary.latestMessage,
      threadId: null,
      taskId: null,
      resumeCommand: null,
      url: null,
      git: {
        sha: null,
        branch: summary.gitBranch,
        originUrl: null
      },
      provenance: "claude",
      confidence: summary.confidence,
      needsUser: summary.needsUser,
      liveSubscription: "readOnly"
    });
  }

  return agents;
}
