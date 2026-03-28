import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { ensureAgentAppearance } from "./appearance";
import {
  cursorLocalSessionLimit,
  cursorLogsDir,
  cursorTranscriptFiles,
  loadCursorWorkspaceEntries
} from "./cursor-lib/local-discovery";
import type { CursorWorkspaceEntry } from "./cursor-lib/local-discovery";
import {
  gitRemoteOriginUrl,
  normalizeRepositoryUrl,
  sourceKindFromModel
} from "./cursor-lib/shared";
export {
  cursorStatusToActivityState,
  gitRemoteOriginUrl,
  normalizeRepositoryUrl,
  sourceKindFromModel
} from "./cursor-lib/shared";
export {
  cursorAgentMatchesRepository,
  cursorApiKeyConfigured,
  describeCursorAgentAvailability,
  loadCursorAgents,
  loadCursorCloudProjectSnapshotData
} from "./cursor-cloud-data";
import { canonicalizeProjectPath, sameProjectPath } from "./project-paths";
import type { ActivityState, AgentActivityEvent, DashboardAgent, DashboardEvent } from "./types";

const execFileAsync = promisify(execFile);

const CURSOR_LOCAL_ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const CURSOR_LOCAL_DONE_WINDOW_MS = 15 * 60 * 1000;
const CURSOR_LOCAL_EVENT_WINDOW_MS = 2 * 60 * 1000;
const CURSOR_HOOK_ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const CURSOR_HOOK_DONE_WINDOW_MS = 15 * 60 * 1000;
const CURSOR_HOOK_EVENT_WINDOW_MS = 5 * 60 * 1000;
const CURSOR_HOOK_FUTURE_TOLERANCE_MS = 30 * 1000;

interface CursorComposerSummary {
  composerId: string;
  name?: string;
  subtitle?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  unifiedMode?: string;
  filesChangedCount?: number;
  totalLinesAdded?: number;
  totalLinesRemoved?: number;
  hasBlockingPendingActions?: boolean;
  isArchived?: boolean;
  createdOnBranch?: string;
  activeBranch?: {
    branchName?: string;
    lastInteractionAt?: number;
  };
  branches?: Array<{
    branchName?: string;
    lastInteractionAt?: number;
  }>;
}

interface CursorComposerData {
  allComposers?: CursorComposerSummary[];
  selectedComposerIds?: string[];
  lastFocusedComposerIds?: string[];
}

interface CursorGenerationEntry {
  unixMs?: number;
  generationUUID?: string;
  type?: string;
  textDescription?: string;
}

interface CursorPromptEntry {
  text?: string;
  commandType?: number;
}

interface CursorBackgroundComposerData {
  cachedSelectedGitState?: {
    ref?: string;
    continueRef?: string;
  };
}

interface CursorLocalWorkspaceState {
  composerData: CursorComposerData | null;
  prompts: CursorPromptEntry[];
  generations: CursorGenerationEntry[];
  backgroundComposer: CursorBackgroundComposerData | null;
}

interface CursorTranscriptContentPart {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface CursorTranscriptLine {
  role?: string;
  model?: string;
  message?: {
    model?: string;
    content?: CursorTranscriptContentPart[];
    usage?: Record<string, unknown>;
  };
  usage?: Record<string, unknown>;
}

interface CursorTranscriptSessionSummary {
  sessionId: string;
  filePath: string;
  createdAtMs: number;
  updatedAtMs: number;
  initialPrompt: string | null;
  latestUserText: string | null;
  latestAssistantText: string | null;
  latestRole: "user" | "assistant" | null;
  latestToolState: ActivityState | null;
  model: string | null;
}

interface CursorHookSessionSummary {
  sessionId: string;
  createdAtMs: number;
  updatedAtMs: number;
  timestampWasClamped: boolean;
  label: string;
  sourceKind: string;
  state: ActivityState;
  detail: string;
  statusText: string | null;
  paths: string[];
  activityEvent: AgentActivityEvent | null;
  latestMessage: string | null;
  isOngoing: boolean;
}

interface CursorAgentLoopState {
  active: boolean;
  updatedAtMs: number | null;
}

function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false);
}

function cursorComposerTimestamp(composer: CursorComposerSummary): number {
  return Math.max(
    composer.lastUpdatedAt ?? 0,
    composer.createdAt ?? 0,
    composer.activeBranch?.lastInteractionAt ?? 0,
    ...(Array.isArray(composer.branches)
      ? composer.branches.map((branch) => branch.lastInteractionAt ?? 0)
      : [0])
  );
}

function extractBalancedJsonSegment(text: string, startIndex: number): string | null {
  const opening = text[startIndex];
  const closing = opening === "[" ? "]" : opening === "{" ? "}" : null;
  if (!closing) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === opening) {
      depth += 1;
      continue;
    }
    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractAsciiStrings(raw: Buffer, minimumLength = 4): string[] {
  const strings: string[] = [];
  let current = "";
  for (const byte of raw.values()) {
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
      continue;
    }
    if (current.length >= minimumLength) {
      strings.push(current);
    }
    current = "";
  }
  if (current.length >= minimumLength) {
    strings.push(current);
  }
  return strings;
}

function extractEmbeddedJsonTextCandidates<T>(text: string, key: string, opening: "{" | "["): Array<{ value: T; raw: string }> {
  const candidates: Array<{ value: T; raw: string }> = [];
  let fromIndex = 0;
  while (fromIndex < text.length) {
    const keyIndex = text.indexOf(key, fromIndex);
    if (keyIndex < 0) {
      break;
    }
    let jsonStart = keyIndex + key.length;
    const maxLookahead = Math.min(text.length, jsonStart + 12);
    while (jsonStart < maxLookahead && text[jsonStart] !== opening) {
      jsonStart += 1;
    }
    fromIndex = keyIndex + key.length;
    if (text[jsonStart] !== opening) {
      continue;
    }
    const parsed = extractBalancedJsonSegment(text, jsonStart);
    if (!parsed) {
      continue;
    }
    try {
      candidates.push({
        value: JSON.parse(parsed) as T,
        raw: parsed
      });
    } catch {
      continue;
    }
  }
  return candidates;
}

function extractEmbeddedJsonCandidates<T>(raw: Buffer, key: string, opening: "{" | "["): Array<{ value: T; raw: string }> {
  const candidates = extractAsciiStrings(raw)
    .flatMap((text) => extractEmbeddedJsonTextCandidates<T>(text, key, opening));
  if (candidates.length > 0) {
    return candidates;
  }

  const rawCandidates: Array<{ value: T; raw: string }> = [];
  const keyBytes = Buffer.from(key, "utf8");
  const openingCode = opening.charCodeAt(0);
  const closingCode = (opening === "[" ? "]" : "}").charCodeAt(0);
  let fromIndex = 0;

  while (fromIndex < raw.length) {
    const keyIndex = raw.indexOf(keyBytes, fromIndex);
    if (keyIndex < 0) {
      break;
    }

    let jsonStart = keyIndex + keyBytes.length;
    const maxLookahead = Math.min(raw.length, jsonStart + 64);
    while (jsonStart < maxLookahead && raw[jsonStart] !== openingCode) {
      jsonStart += 1;
    }
    fromIndex = keyIndex + keyBytes.length;
    if (raw[jsonStart] !== openingCode) {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaping = false;
    let parsed = "";
    let completed = false;
    for (let index = jsonStart; index < raw.length; index += 1) {
      const byte = raw[index];
      if (byte < 32 || byte > 126) {
        continue;
      }
      const char = String.fromCharCode(byte);
      parsed += char;

      if (inString) {
        if (escaping) {
          escaping = false;
          continue;
        }
        if (char === "\\") {
          escaping = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }
      if (byte === openingCode) {
        depth += 1;
        continue;
      }
      if (byte === closingCode) {
        depth -= 1;
        if (depth === 0) {
          completed = true;
          break;
        }
      }
    }

    if (!completed || parsed.length === 0) {
      continue;
    }

    try {
      rawCandidates.push({
        value: JSON.parse(parsed) as T,
        raw: parsed
      });
    } catch {
      continue;
    }
  }

  return rawCandidates;
}

function pickBestCandidate<T>(
  candidates: Array<{ value: T; raw: string }>,
  score: (value: T) => number
): T | null {
  return candidates
    .sort((left, right) => {
      const scoreDelta = score(right.value) - score(left.value);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return right.raw.length - left.raw.length;
    })[0]?.value ?? null;
}

function parseCursorLocalWorkspaceState(raw: Buffer): CursorLocalWorkspaceState {
  const composerData = pickBestCandidate<CursorComposerData>(
    extractEmbeddedJsonCandidates(raw, "composer.composerData", "{"),
    (value) => Math.max(...(Array.isArray(value.allComposers) ? value.allComposers.map((composer) => cursorComposerTimestamp(composer)) : [0]))
  );
  const prompts = pickBestCandidate<CursorPromptEntry[]>(
    extractEmbeddedJsonCandidates(raw, "aiService.prompts", "["),
    (value) => Array.isArray(value) ? value.length : 0
  ) ?? [];
  const generations = pickBestCandidate<CursorGenerationEntry[]>(
    extractEmbeddedJsonCandidates(raw, "aiService.generations", "["),
    (value) => Math.max(...(Array.isArray(value) ? value.map((entry) => entry.unixMs ?? 0) : [0]))
  ) ?? [];
  const backgroundComposer = pickBestCandidate<CursorBackgroundComposerData>(
    extractEmbeddedJsonCandidates(raw, "workbench.backgroundComposer.workspacePersistentData", "{"),
    (value) => `${value.cachedSelectedGitState?.ref ?? ""}${value.cachedSelectedGitState?.continueRef ?? ""}`.length
  );

  return {
    composerData,
    prompts,
    generations,
    backgroundComposer
  };
}

function parseCursorJsonValue<T>(input: unknown): T | null {
  if (typeof input !== "string" || input.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

function loadCursorLocalWorkspaceStateFromSqlite(filePath: string): CursorLocalWorkspaceState | null {
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(filePath, { readOnly: true });
    const readValue = (key: string): string | null => {
      const row = database
        ?.prepare("select value from ItemTable where key = ?")
        .get(key) as { value?: unknown } | undefined;
      return typeof row?.value === "string" ? row.value : null;
    };

    const composerData = parseCursorJsonValue<CursorComposerData>(readValue("composer.composerData"));
    const prompts = parseCursorJsonValue<CursorPromptEntry[]>(readValue("aiService.prompts")) ?? [];
    const generations = parseCursorJsonValue<CursorGenerationEntry[]>(readValue("aiService.generations")) ?? [];
    const backgroundComposer = parseCursorJsonValue<CursorBackgroundComposerData>(
      readValue("workbench.backgroundComposer.workspacePersistentData")
    );

    if (!composerData && prompts.length === 0 && generations.length === 0 && !backgroundComposer) {
      return null;
    }

    return {
      composerData,
      prompts,
      generations,
      backgroundComposer
    };
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

async function loadCursorLocalWorkspaceState(workspace: CursorWorkspaceEntry): Promise<CursorLocalWorkspaceState | null> {
  for (const filePath of [workspace.stateFilePath, workspace.backupFilePath]) {
    if (!await pathExists(filePath)) {
      continue;
    }
    try {
      const fromSqlite = loadCursorLocalWorkspaceStateFromSqlite(filePath);
      if (fromSqlite?.composerData || fromSqlite?.prompts.length || fromSqlite?.generations.length) {
        return fromSqlite;
      }

      const raw = await readFile(filePath);
      const parsed = parseCursorLocalWorkspaceState(raw);
      if (parsed.composerData || parsed.prompts.length > 0 || parsed.generations.length > 0) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function orderedCursorComposers(composerData: CursorComposerData | null): CursorComposerSummary[] {
  if (!composerData || !Array.isArray(composerData.allComposers)) {
    return [];
  }

  const activeComposers = composerData.allComposers.filter((composer) => composer && composer.isArchived !== true);
  const byId = new Map(activeComposers.map((composer) => [composer.composerId, composer]));
  const orderedIds = [
    ...(Array.isArray(composerData.lastFocusedComposerIds) ? composerData.lastFocusedComposerIds : []),
    ...(Array.isArray(composerData.selectedComposerIds) ? composerData.selectedComposerIds : []),
    ...activeComposers
      .slice()
      .sort((left, right) => cursorComposerTimestamp(right) - cursorComposerTimestamp(left))
      .map((composer) => composer.composerId)
  ];

  const ordered: CursorComposerSummary[] = [];
  const seen = new Set<string>();
  for (const composerId of orderedIds) {
    if (typeof composerId !== "string" || seen.has(composerId)) {
      continue;
    }
    const composer = byId.get(composerId);
    if (!composer) {
      continue;
    }
    seen.add(composerId);
    ordered.push(composer);
  }

  return ordered;
}

function cursorPrimaryComposerId(
  composerData: CursorComposerData | null,
  latestGenerationMs: number
): string | null {
  const composers = orderedCursorComposers(composerData);
  if (composers.length === 0) {
    return null;
  }

  if (Number.isFinite(latestGenerationMs) && latestGenerationMs > 0) {
    const matchedComposer = composers
      .map((composer) => ({
        composer,
        distanceMs: Math.abs(cursorComposerTimestamp(composer) - latestGenerationMs)
      }))
      .sort((left, right) => left.distanceMs - right.distanceMs)[0] ?? null;
    if (matchedComposer && matchedComposer.distanceMs <= CURSOR_LOCAL_ACTIVE_WINDOW_MS) {
      return matchedComposer.composer.composerId;
    }
  }

  return composers[0]?.composerId ?? null;
}

async function cursorAgentLoopState(): Promise<CursorAgentLoopState> {
  const logsDir = await cursorLogsDir();
  if (!logsDir) {
    return { active: false, updatedAtMs: null };
  }

  const directories = await readdir(logsDir, { withFileTypes: true }).catch(() => []);
  const recentDirs = directories
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .slice(-5)
    .reverse();

  let lastEvent: { active: boolean; updatedAtMs: number } | null = null;
  const pattern = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*?\[PowerMainService\] (Started|Stopping) wakelock .*reason="agent-loop"/;

  for (const dirName of recentDirs) {
    const filePath = join(logsDir, dirName, "main.log");
    if (!await pathExists(filePath)) {
      continue;
    }
    const raw = await readFile(filePath, "utf8").catch(() => "");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(pattern);
      if (!match) {
        continue;
      }
      const updatedAtMs = Date.parse(match[1].replace(" ", "T") + "Z");
      if (!Number.isFinite(updatedAtMs)) {
        continue;
      }
      lastEvent = {
        active: match[2] === "Started",
        updatedAtMs
      };
    }
    if (lastEvent) {
      break;
    }
  }

  return lastEvent ?? { active: false, updatedAtMs: null };
}

function cursorLocalPromptDetail(prompt: string | null, fallback: string): string {
  if (prompt && prompt.trim().length > 0) {
    const normalized = prompt.replace(/\s+/g, " ").trim();
    return normalized.length <= 88 ? normalized : `${normalized.slice(0, 87)}…`;
  }
  return fallback;
}

function cleanCursorTranscriptUserText(text: string): string | null {
  const normalized = text
    .replace(/<\/?user_query>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function cleanCursorTranscriptAssistantText(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function cursorTranscriptContentText(
  role: "user" | "assistant",
  content: CursorTranscriptContentPart[] | undefined
): string | null {
  if (!Array.isArray(content)) {
    return null;
  }

  const joined = content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join(" ");
  if (!joined.trim()) {
    return null;
  }

  return role === "user"
    ? cleanCursorTranscriptUserText(joined)
    : cleanCursorTranscriptAssistantText(joined);
}

function cursorTranscriptToolState(toolName: string | null | undefined): ActivityState | null {
  const normalized = typeof toolName === "string" ? toolName.trim().toLowerCase() : "";
  switch (normalized) {
    case "edit":
    case "editfile":
    case "edit_file":
    case "edit_file_v2":
    case "strreplace":
    case "write":
    case "writefile":
    case "applypatch":
    case "apply_patch":
    case "search_replace":
      return "editing";
    case "shell":
    case "run_terminal_cmd":
    case "run_terminal_command_v2":
      return "running";
    case "read":
    case "readfile":
    case "read_file":
    case "read_file_v2":
    case "grep":
    case "glob":
    case "list":
    case "ls":
    case "list_dir":
    case "list_dir_v2":
    case "ripgrep":
    case "ripgrep_raw_search":
    case "semantic_search_full":
    case "codebase_search":
      return "scanning";
    case "task":
    case "task_v2":
      return "delegating";
    case "todowrite":
    case "create_plan":
      return "planning";
    default:
      return null;
  }
}

function cursorTranscriptLatestToolState(content: CursorTranscriptContentPart[] | undefined): ActivityState | null {
  if (!Array.isArray(content)) {
    return null;
  }

  for (let index = content.length - 1; index >= 0; index -= 1) {
    const state = cursorTranscriptToolState(content[index]?.name);
    if (state) {
      return state;
    }
  }

  return null;
}

async function summariseCursorTranscriptSession(file: {
  sessionId: string;
  filePath: string;
  createdAtMs: number;
  updatedAtMs: number;
}): Promise<CursorTranscriptSessionSummary | null> {
  const raw = await readFile(file.filePath, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }

  let initialPrompt: string | null = null;
  let latestUserText: string | null = null;
  let latestAssistantText: string | null = null;
  let latestRole: "user" | "assistant" | null = null;
  let latestToolState: ActivityState | null = null;
  let model: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let parsed: CursorTranscriptLine | null = null;
    try {
      parsed = JSON.parse(line) as CursorTranscriptLine;
    } catch {
      continue;
    }
    if (!parsed) {
      continue;
    }

    const role = parsed.role === "user" || parsed.role === "assistant" ? parsed.role : null;
    if (!role) {
      continue;
    }

    const content = Array.isArray(parsed.message?.content) ? parsed.message.content : [];
    const text = cursorTranscriptContentText(role, content);
    if (!model) {
      const candidateModel = parsed.model ?? parsed.message?.model ?? null;
      model = typeof candidateModel === "string" && candidateModel.trim().length > 0
        ? candidateModel.trim()
        : null;
    }

    if (role === "user") {
      if (!initialPrompt && text) {
        initialPrompt = text;
      }
      if (text) {
        latestUserText = text;
        latestRole = "user";
      }
      continue;
    }

    const toolState = cursorTranscriptLatestToolState(content);
    if (text) {
      latestAssistantText = text;
    }
    if (text || toolState) {
      latestRole = "assistant";
    }
    if (toolState) {
      latestToolState = toolState;
    }
  }

  if (!initialPrompt && !latestUserText && !latestAssistantText) {
    return null;
  }

  return {
    sessionId: file.sessionId,
    filePath: file.filePath,
    createdAtMs: file.createdAtMs,
    updatedAtMs: file.updatedAtMs,
    initialPrompt,
    latestUserText,
    latestAssistantText,
    latestRole,
    latestToolState,
    model
  };
}

function cursorHooksDir(projectRoot: string): string {
  return join(projectRoot, ".codex-agents", "cursor-hooks");
}

export function cursorHooksFilePath(projectRoot: string, sessionId: string): string {
  return join(cursorHooksDir(projectRoot), `${sessionId}.jsonl`);
}

function cursorHookRecordTimestampMs(record: Record<string, unknown>, fallbackUpdatedAt: number): {
  timestampMs: number;
  wasFutureClamped: boolean;
} {
  for (const key of ["timestamp", "created_at", "createdAt", "updated_at", "updatedAt"]) {
    const value = record[key];
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        if (parsed > fallbackUpdatedAt + CURSOR_HOOK_FUTURE_TOLERANCE_MS) {
          return {
            timestampMs: Math.max(0, fallbackUpdatedAt - CURSOR_HOOK_FUTURE_TOLERANCE_MS),
            wasFutureClamped: true
          };
        }
        return {
          timestampMs: parsed,
          wasFutureClamped: false
        };
      }
    }
  }
  return {
    timestampMs: fallbackUpdatedAt,
    wasFutureClamped: false
  };
}

function cursorHookSessionId(record: Record<string, unknown>): string | null {
  for (const key of ["conversation_id", "session_id", "parent_conversation_id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function cursorHookEventName(record: Record<string, unknown>): string | null {
  const value = record.hook_event_name;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function cursorHookModel(record: Record<string, unknown>): string | null {
  const value = record.model;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function cursorHookString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function cursorHookStringList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter((entry) => entry.length > 0);
}

function cursorHookAttachmentsPaths(record: Record<string, unknown>): string[] {
  const value = record.attachments;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const filePath = (entry as Record<string, unknown>).file_path;
      return typeof filePath === "string" && filePath.trim().length > 0 ? filePath.trim() : null;
    })
    .filter((entry): entry is string => entry !== null);
}

function cursorHookPaths(record: Record<string, unknown>, fallbackCwd: string): string[] {
  const values = new Set<string>();
  const cwd = cursorHookString(record, "cwd") ?? fallbackCwd;
  if (cwd) {
    values.add(cwd);
  }

  for (const value of [
    cursorHookString(record, "file_path"),
    cursorHookString(record, "transcript_path"),
    cursorHookString(record, "agent_transcript_path")
  ]) {
    if (value) {
      values.add(value);
    }
  }

  cursorHookStringList(record, "modified_files").forEach((value) => values.add(value));
  cursorHookStringList(record, "workspace_roots").forEach((value) => values.add(value));
  cursorHookAttachmentsPaths(record).forEach((value) => values.add(value));
  return [...values];
}

function cursorHookActivityEventForTool(input: {
  toolName: string | null;
  record: Record<string, unknown>;
  fallbackCwd: string;
  failed: boolean;
}): AgentActivityEvent | null {
  const normalizedTool = typeof input.toolName === "string" ? input.toolName.trim() : "";
  const toolInput = input.record.tool_input;
  const toolInputRecord = toolInput && typeof toolInput === "object" ? toolInput as Record<string, unknown> : null;
  const command = cursorHookString(input.record, "command")
    ?? (toolInputRecord ? cursorHookString(toolInputRecord, "command") : null);
  const workingDirectory = toolInputRecord
    ? cursorHookString(toolInputRecord, "working_directory")
    : null;
  const filePath = cursorHookString(input.record, "file_path")
    ?? (toolInputRecord ? cursorHookString(toolInputRecord, "file_path") : null);
  const state = cursorTranscriptToolState(normalizedTool);

  if (filePath || state === "editing") {
    return {
      type: "fileChange",
      action: "edited",
      path: filePath ?? input.fallbackCwd,
      title: cursorLocalPromptDetail(filePath ?? "Edited files", "Edited files"),
      isImage: false
    };
  }

  if (normalizedTool.toLowerCase().startsWith("mcp:")) {
    return {
      type: "mcpToolCall",
      action: "ran",
      path: input.fallbackCwd,
      title: cursorLocalPromptDetail(normalizedTool, "MCP tool"),
      isImage: false
    };
  }

  if (command || normalizedTool.toLowerCase() === "shell") {
    return {
      type: "commandExecution",
      action: "ran",
      path: workingDirectory ?? input.fallbackCwd,
      title: cursorLocalPromptDetail(command ?? normalizedTool, input.failed ? "Command failed" : "Command ran"),
      isImage: false
    };
  }

  if (state === "scanning") {
    return {
      type: "other",
      action: "updated",
      path: input.fallbackCwd,
      title: cursorLocalPromptDetail(normalizedTool || "Scanning", "Scanning"),
      isImage: false
    };
  }

  return null;
}

function cursorHookToolDetail(toolName: string | null, record: Record<string, unknown>): string {
  const toolInput = record.tool_input;
  const toolInputRecord = toolInput && typeof toolInput === "object" ? toolInput as Record<string, unknown> : null;
  const command = cursorHookString(record, "command")
    ?? (toolInputRecord ? cursorHookString(toolInputRecord, "command") : null);
  const filePath = cursorHookString(record, "file_path")
    ?? (toolInputRecord ? cursorHookString(toolInputRecord, "file_path") : null);
  const errorMessage = cursorHookString(record, "error_message");

  if (errorMessage) {
    return cursorLocalPromptDetail(errorMessage, "Tool failed");
  }
  if (command) {
    return cursorLocalPromptDetail(command, "Shell command");
  }
  if (filePath) {
    return cursorLocalPromptDetail(filePath, "Edited file");
  }
  if (toolName) {
    return cursorLocalPromptDetail(toolName, "Tool activity");
  }
  return "Tool activity";
}

function cursorHookToolState(record: Record<string, unknown>, failed: boolean, fallbackCwd: string): {
  state: ActivityState;
  detail: string;
  activityEvent: AgentActivityEvent | null;
  latestMessage: string | null;
  isOngoing: boolean;
} {
  const toolName = cursorHookString(record, "tool_name");
  const detail = cursorHookToolDetail(toolName, record);
  const activityEvent = cursorHookActivityEventForTool({
    toolName,
    record,
    fallbackCwd,
    failed
  });
  if (failed) {
    return {
      state: "blocked",
      detail,
      activityEvent,
      latestMessage: cursorHookString(record, "error_message"),
      isOngoing: false
    };
  }

  const mappedState = cursorTranscriptToolState(toolName);
  return {
    state: mappedState ?? "thinking",
    detail,
    activityEvent,
    latestMessage: cursorHookString(record, "agent_message"),
    isOngoing: true
  };
}

function cursorHookPhaseSummary(input: {
  eventName: string;
  record: Record<string, unknown>;
  fallbackCwd: string;
  fallbackUpdatedAt: number;
}): CursorHookSessionSummary | null {
  const eventName = input.eventName.toLowerCase();
  const { timestampMs: updatedAtMs, wasFutureClamped } = cursorHookRecordTimestampMs(input.record, input.fallbackUpdatedAt);
  const sessionId = cursorHookSessionId(input.record) ?? `cursor-${updatedAtMs}`;
  const model = cursorHookModel(input.record);
  const paths = cursorHookPaths(input.record, input.fallbackCwd);
  const sourceKind = model ? sourceKindFromModel(model) : "cursor:local:hook";
  const prompt = cursorHookString(input.record, "prompt");
  const responseText = cursorHookString(input.record, "text");
  const cwd = cursorHookString(input.record, "cwd") ?? input.fallbackCwd;

  switch (eventName) {
    case "beforesubmitprompt":
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: cursorLocalPromptDetail(prompt, `Cursor ${sessionId.slice(0, 4)}`),
        sourceKind,
        state: "planning",
        detail: cursorLocalPromptDetail(prompt, "Preparing prompt"),
        statusText: model ?? "hook",
        paths,
        activityEvent: prompt
          ? {
            type: "userMessage",
            action: "said",
            path: cwd,
            title: cursorLocalPromptDetail(prompt, "Cursor prompt"),
            isImage: false
          }
          : null,
        latestMessage: null,
        isOngoing: true
      };
    case "afteragentresponse":
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: cursorLocalPromptDetail(responseText, `Cursor ${sessionId.slice(0, 4)}`),
        sourceKind,
        state: "thinking",
        detail: cursorLocalPromptDetail(responseText, "Cursor response"),
        statusText: model ?? "hook",
        paths,
        activityEvent: responseText
          ? {
            type: "agentMessage",
            action: "said",
            path: cwd,
            title: cursorLocalPromptDetail(responseText, "Cursor response"),
            isImage: false
          }
          : null,
        latestMessage: responseText,
        isOngoing: true
      };
    case "afteragentthought":
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: `Cursor ${sessionId.slice(0, 4)}`,
        sourceKind,
        state: "thinking",
        detail: cursorLocalPromptDetail(responseText, "Thinking"),
        statusText: model ?? "hook",
        paths,
        activityEvent: responseText
          ? {
            type: "reasoning",
            action: "updated",
            path: cwd,
            title: cursorLocalPromptDetail(responseText, "Thinking"),
            isImage: false
          }
          : null,
        latestMessage: null,
        isOngoing: true
      };
    case "afterfileedit": {
      const filePath = cursorHookString(input.record, "file_path");
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: cursorLocalPromptDetail(filePath, `Cursor ${sessionId.slice(0, 4)}`),
        sourceKind,
        state: "editing",
        detail: cursorLocalPromptDetail(filePath, "Edited file"),
        statusText: model ?? "hook",
        paths,
        activityEvent: {
          type: "fileChange",
          action: "edited",
          path: filePath ?? cwd,
          title: cursorLocalPromptDetail(filePath, "Edited file"),
          isImage: false
        },
        latestMessage: null,
        isOngoing: true
      };
    }
    case "beforetooluse":
    case "pretooluse":
    case "posttooluse":
      return (() => {
        const tool = cursorHookToolState(input.record, false, input.fallbackCwd);
        return {
          sessionId,
          createdAtMs: updatedAtMs,
          updatedAtMs,
          timestampWasClamped: wasFutureClamped,
          label: tool.detail,
          sourceKind,
          state: tool.state,
          detail: tool.detail,
          statusText: model ?? "hook",
          paths,
          activityEvent: tool.activityEvent,
          latestMessage: tool.latestMessage,
          isOngoing: true
        };
      })();
    case "posttoolusefailure":
      return (() => {
        const tool = cursorHookToolState(input.record, true, input.fallbackCwd);
        return {
          sessionId,
          createdAtMs: updatedAtMs,
          updatedAtMs,
          timestampWasClamped: wasFutureClamped,
          label: tool.detail,
          sourceKind,
          state: tool.state,
          detail: tool.detail,
          statusText: model ?? "hook",
          paths,
          activityEvent: tool.activityEvent,
          latestMessage: tool.latestMessage,
          isOngoing: false
        };
      })();
    case "beforeshellexecution":
    case "aftershellexecution": {
      const command = cursorHookString(input.record, "command");
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: cursorLocalPromptDetail(command, `Cursor ${sessionId.slice(0, 4)}`),
        sourceKind,
        state: "running",
        detail: cursorLocalPromptDetail(command, "Shell command"),
        statusText: model ?? "hook",
        paths,
        activityEvent: {
          type: "commandExecution",
          action: "ran",
          path: cwd,
          title: cursorLocalPromptDetail(command, "Shell command"),
          isImage: false
        },
        latestMessage: null,
        isOngoing: true
      };
    }
    case "beforemcpexecution":
    case "aftermcpexecution": {
      const toolName = cursorHookString(input.record, "tool_name");
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: cursorLocalPromptDetail(toolName, `Cursor ${sessionId.slice(0, 4)}`),
        sourceKind,
        state: "running",
        detail: cursorLocalPromptDetail(toolName, "MCP tool"),
        statusText: model ?? "hook",
        paths,
        activityEvent: {
          type: "mcpToolCall",
          action: "ran",
          path: cwd,
          title: cursorLocalPromptDetail(toolName, "MCP tool"),
          isImage: false
        },
        latestMessage: null,
        isOngoing: true
      };
    }
    case "subagentstart": {
      const task = cursorHookString(input.record, "task") ?? cursorHookString(input.record, "description");
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: cursorLocalPromptDetail(task, `Cursor ${sessionId.slice(0, 4)}`),
        sourceKind,
        state: "delegating",
        detail: cursorLocalPromptDetail(task, "Delegating to subagent"),
        statusText: model ?? "hook",
        paths,
        activityEvent: {
          type: "other",
          action: "updated",
          path: cwd,
          title: cursorLocalPromptDetail(task, "Delegating to subagent"),
          isImage: false
        },
        latestMessage: null,
        isOngoing: true
      };
    }
    case "subagentstop": {
      const status = cursorHookString(input.record, "status");
      const summary = cursorHookString(input.record, "summary") ?? cursorHookString(input.record, "task");
      const state =
        status === "error" ? "blocked"
        : status === "aborted" ? "done"
        : "thinking";
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: cursorLocalPromptDetail(summary, `Cursor ${sessionId.slice(0, 4)}`),
        sourceKind,
        state,
        detail: cursorLocalPromptDetail(summary, "Subagent completed"),
        statusText: model ?? "hook",
        paths,
        activityEvent: {
          type: "other",
          action: "updated",
          path: cwd,
          title: cursorLocalPromptDetail(summary, "Subagent completed"),
          isImage: false
        },
        latestMessage: null,
        isOngoing: state !== "blocked"
      };
    }
    case "stop": {
      const status = cursorHookString(input.record, "status");
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: `Cursor ${sessionId.slice(0, 4)}`,
        sourceKind,
        state: status === "error" ? "blocked" : "done",
        detail:
          status === "error" ? "Cursor session failed"
          : status === "aborted" ? "Cursor session stopped"
          : "Cursor session completed",
        statusText: model ?? "hook",
        paths,
        activityEvent: null,
        latestMessage: null,
        isOngoing: false
      };
    }
    case "sessionstart": {
      const composerMode = cursorHookString(input.record, "composer_mode");
      const state =
        composerMode === "edit" ? "editing"
        : composerMode === "ask" ? "thinking"
        : "thinking";
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: `Cursor ${sessionId.slice(0, 4)}`,
        sourceKind,
        state,
        detail: composerMode ? `Session started · ${composerMode}` : "Session started",
        statusText: model ?? "hook",
        paths,
        activityEvent: null,
        latestMessage: null,
        isOngoing: true
      };
    }
    case "sessionend": {
      const reason = cursorHookString(input.record, "reason");
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: `Cursor ${sessionId.slice(0, 4)}`,
        sourceKind,
        state: reason === "error" ? "blocked" : "done",
        detail: reason ? `Session ended · ${reason}` : "Session ended",
        statusText: model ?? "hook",
        paths,
        activityEvent: null,
        latestMessage: null,
        isOngoing: false
      };
    }
    case "precompact":
      return {
        sessionId,
        createdAtMs: updatedAtMs,
        updatedAtMs,
        timestampWasClamped: wasFutureClamped,
        label: `Cursor ${sessionId.slice(0, 4)}`,
        sourceKind,
        state: "thinking",
        detail: "Compacting context",
        statusText: model ?? "hook",
        paths,
        activityEvent: {
          type: "contextCompaction",
          action: "updated",
          path: cwd,
          title: "Compacting context",
          isImage: false
        },
        latestMessage: null,
        isOngoing: true
      };
    default:
      return null;
  }
}

function ageCursorHookSummary(summary: CursorHookSessionSummary, now = Date.now()): CursorHookSessionSummary {
  if (!summary.isOngoing) {
    const ageMs = now - summary.updatedAtMs;
    if (ageMs <= CURSOR_HOOK_DONE_WINDOW_MS) {
      return summary;
    }
    return {
      ...summary,
      state: "idle",
      detail: "Idle",
      activityEvent: null,
      latestMessage: null,
      timestampWasClamped: false
    };
  }

  const ageMs = now - summary.updatedAtMs;
  if (ageMs <= CURSOR_HOOK_ACTIVE_WINDOW_MS) {
    return summary;
  }
  if (ageMs <= CURSOR_HOOK_DONE_WINDOW_MS) {
    return {
      ...summary,
      state: "done",
      detail: summary.detail === "Idle" ? "Done" : summary.detail,
      activityEvent: null,
      isOngoing: false,
      timestampWasClamped: false
    };
  }
  return {
    ...summary,
    state: "idle",
    detail: "Idle",
    activityEvent: null,
    latestMessage: null,
    isOngoing: false,
    timestampWasClamped: false
  };
}

function cursorHookEventKind(event: AgentActivityEvent | null): DashboardEvent["kind"] {
  if (!event) {
    return "other";
  }
  if (event.type === "fileChange") {
    return "fileChange";
  }
  if (event.type === "commandExecution") {
    return "command";
  }
  if (event.type === "userMessage" || event.type === "agentMessage") {
    return "message";
  }
  if (event.type === "mcpToolCall") {
    return "tool";
  }
  return "other";
}

function cursorHookEventMethod(eventName: string | null, summary: CursorHookSessionSummary): string {
  const normalized = typeof eventName === "string" ? eventName.trim() : "activity";
  switch (summary.activityEvent?.type) {
    case "userMessage":
      return "cursor/local/userMessage";
    case "agentMessage":
      return "cursor/local/agentMessage";
    case "fileChange":
      return "cursor/local/fileChange";
    case "commandExecution":
      return "cursor/local/commandExecution";
    case "mcpToolCall":
      return "cursor/local/mcpToolCall";
    case "reasoning":
      return "cursor/local/reasoning";
    case "contextCompaction":
      return "cursor/local/contextCompaction";
    default:
      return `cursor/local/hook/${normalized}`;
  }
}

function cursorHookEventFromSummary(input: {
  projectRoot: string;
  sessionId: string;
  eventName: string | null;
  summary: CursorHookSessionSummary;
  createdAtMs: number;
  index: number;
}): DashboardEvent | null {
  if (Date.now() - input.createdAtMs > CURSOR_HOOK_EVENT_WINDOW_MS) {
    return null;
  }

  if (!input.summary.activityEvent && !input.summary.latestMessage) {
    return null;
  }

  return {
    id: `${input.projectRoot}::cursor-hook::${input.sessionId}::${input.index}::${input.eventName ?? "activity"}`,
    source: "cursor",
    confidence: "typed",
    threadId: input.sessionId,
    createdAt: new Date(input.createdAtMs).toISOString(),
    method: cursorHookEventMethod(input.eventName, input.summary),
    kind: cursorHookEventKind(input.summary.activityEvent),
    phase:
      input.summary.state === "blocked" ? "failed"
      : input.summary.state === "done" ? "completed"
      : "updated",
    title: input.summary.detail,
    detail: input.summary.latestMessage ?? input.summary.detail,
    path: input.summary.activityEvent?.path ?? input.projectRoot,
    action: input.summary.activityEvent?.action,
    isImage: input.summary.activityEvent?.isImage
  };
}

async function cursorHookFiles(projectRoot: string): Promise<Array<{
  sessionId: string;
  filePath: string;
  updatedAtMs: number;
}>> {
  const hooksDir = cursorHooksDir(projectRoot);
  if (!await pathExists(hooksDir)) {
    return [];
  }

  const entries = await readdir(hooksDir, { withFileTypes: true }).catch(() => []);
  const files: Array<{
    sessionId: string;
    filePath: string;
    updatedAtMs: number;
  }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const filePath = join(hooksDir, entry.name);
    const fileStats = await stat(filePath).catch(() => null);
    if (!fileStats?.isFile()) {
      continue;
    }
    files.push({
      sessionId: entry.name.replace(/\.jsonl$/i, ""),
      filePath,
      updatedAtMs: fileStats.mtimeMs
    });
  }

  return files.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

async function summariseCursorHookSession(file: {
  sessionId: string;
  filePath: string;
  updatedAtMs: number;
}, fallbackCwd: string): Promise<{
  summary: CursorHookSessionSummary;
  events: DashboardEvent[];
} | null> {
  const raw = await readFile(file.filePath, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }

  const rawRecords = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((record): record is Record<string, unknown> => record !== null);

  if (rawRecords.length === 0) {
    return null;
  }

  const sortedRecords = rawRecords
    .slice()
    .sort(
      (left, right) =>
        cursorHookRecordTimestampMs(left, file.updatedAtMs).timestampMs
        - cursorHookRecordTimestampMs(right, file.updatedAtMs).timestampMs
    );

  let latestSummary: CursorHookSessionSummary | null = null;
  let latestPrompt: string | null = null;
  let latestAssistantText: string | null = null;
  const pathSet = new Set<string>();
  const events: DashboardEvent[] = [];

  for (const [index, record] of sortedRecords.entries()) {
    const eventName = cursorHookEventName(record);
    const summary = cursorHookPhaseSummary({
      eventName: eventName ?? "activity",
      record,
      fallbackCwd,
      fallbackUpdatedAt: file.updatedAtMs
    });
    if (!summary) {
      continue;
    }

    summary.paths.forEach((path) => pathSet.add(path));
    if ((eventName ?? "").toLowerCase() === "beforesubmitprompt") {
      latestPrompt = cursorHookString(record, "prompt") ?? latestPrompt;
    }
    if ((eventName ?? "").toLowerCase() === "afteragentresponse") {
      latestAssistantText = cursorHookString(record, "text") ?? latestAssistantText;
    }
    const shouldReplaceLatest =
      !latestSummary
      || summary.updatedAtMs >= latestSummary.updatedAtMs
      || (
        latestSummary.timestampWasClamped
        && !summary.timestampWasClamped
        && summary.updatedAtMs >= latestSummary.updatedAtMs - CURSOR_HOOK_FUTURE_TOLERANCE_MS
      );
    if (shouldReplaceLatest) {
      latestSummary = summary;
    }

    const event = cursorHookEventFromSummary({
      projectRoot: fallbackCwd,
      sessionId: file.sessionId,
      eventName,
      summary,
      createdAtMs: summary.updatedAtMs,
      index
    });
    if (event) {
      events.push(event);
    }
  }

  if (!latestSummary) {
    return null;
  }

  const agedSummary = ageCursorHookSummary({
    ...latestSummary,
    label: cursorLocalPromptDetail(
      latestPrompt ?? latestAssistantText ?? latestSummary.label,
      `Cursor ${file.sessionId.slice(0, 4)}`
    ),
    latestMessage: latestAssistantText ?? latestSummary.latestMessage,
    paths: pathSet.size > 0 ? [...pathSet] : latestSummary.paths
  });

  return {
    summary: agedSummary,
    events: events.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  };
}

async function loadCursorHookProjectSnapshotData(projectRoot: string, limit = cursorLocalSessionLimit()): Promise<{
  agents: DashboardAgent[];
  events: DashboardEvent[];
}> {
  const canonicalRoot = canonicalizeProjectPath(projectRoot);
  if (!canonicalRoot) {
    return { agents: [], events: [] };
  }

  const files = await cursorHookFiles(canonicalRoot);
  if (files.length === 0) {
    return { agents: [], events: [] };
  }

  const [originUrl, branch] = await Promise.all([
    gitRemoteOriginUrl(canonicalRoot),
    gitCurrentBranch(canonicalRoot)
  ]);
  const summaries = (await Promise.all(files.slice(0, Math.max(limit, 24)).map((file) => summariseCursorHookSession(file, canonicalRoot))))
    .filter((entry): entry is { summary: CursorHookSessionSummary; events: DashboardEvent[] } => entry !== null);

  const agents: DashboardAgent[] = [];
  const events: DashboardEvent[] = [];
  for (const entry of summaries.slice(0, limit)) {
    if (entry.summary.state === "idle" && !entry.summary.isOngoing) {
      continue;
    }
    const appearance = await ensureAgentAppearance(canonicalRoot, `cursor-local:${entry.summary.sessionId}`);
    agents.push({
      id: `cursor-local:${entry.summary.sessionId}`,
      label: entry.summary.label,
      source: "cursor",
      sourceKind: entry.summary.sourceKind,
      parentThreadId: null,
      depth: 0,
      isCurrent: false,
      isOngoing: entry.summary.isOngoing,
      statusText: entry.summary.statusText,
      role: "cursor",
      nickname: null,
      isSubagent: false,
      state: entry.summary.state,
      detail: entry.summary.detail,
      cwd: canonicalRoot,
      roomId: null,
      appearance,
      updatedAt: new Date(entry.summary.updatedAtMs).toISOString(),
      stoppedAt: entry.summary.isOngoing ? null : new Date(entry.summary.updatedAtMs).toISOString(),
      paths: entry.summary.paths.length > 0 ? entry.summary.paths : [canonicalRoot],
      activityEvent: entry.summary.activityEvent,
      latestMessage: entry.summary.latestMessage,
      threadId: entry.summary.sessionId,
      taskId: null,
      resumeCommand: null,
      url: null,
      git: {
        sha: null,
        branch,
        originUrl
      },
      provenance: "cursor",
      confidence: "typed",
      needsUser: null,
      liveSubscription: "readOnly",
      network: null
    });
    events.push(...entry.events);
  }

  return {
    agents: agents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    events: events.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  };
}

function cursorLocalLabel(composer: CursorComposerSummary, prompt: string | null): string {
  const name = typeof composer.name === "string" ? composer.name.trim() : "";
  if (name.length > 0) {
    return name;
  }
  const subtitle = typeof composer.subtitle === "string" ? composer.subtitle.trim() : "";
  if (subtitle.length > 0) {
    return cursorLocalPromptDetail(subtitle, "Cursor local");
  }
  if (prompt) {
    return cursorLocalPromptDetail(prompt, "Cursor local");
  }
  return `Cursor ${composer.composerId.slice(0, 4)}`;
}

function cursorLocalDetail(composer: CursorComposerSummary, prompt: string | null, state: ActivityState): string {
  const subtitle = typeof composer.subtitle === "string" ? composer.subtitle.trim() : "";
  const changedFiles = composer.filesChangedCount ?? 0;
  const added = composer.totalLinesAdded ?? 0;
  const removed = composer.totalLinesRemoved ?? 0;
  if (state === "editing" && changedFiles > 0) {
    return `${changedFiles} file${changedFiles === 1 ? "" : "s"} changed · +${added} -${removed}`;
  }
  if (subtitle.length > 0) {
    return cursorLocalPromptDetail(subtitle, "Cursor local");
  }
  if (prompt) {
    return cursorLocalPromptDetail(prompt, "Cursor local");
  }
  return state === "idle" ? "Idle" : "Cursor local";
}

function cursorTranscriptActivityState(summary: CursorTranscriptSessionSummary, now: number): {
  state: ActivityState;
  isOngoing: boolean;
} {
  const ageMs = now - summary.updatedAtMs;
  if (ageMs <= CURSOR_LOCAL_ACTIVE_WINDOW_MS) {
    if (summary.latestToolState) {
      return { state: summary.latestToolState, isOngoing: true };
    }
    return { state: "thinking", isOngoing: true };
  }

  if (ageMs <= CURSOR_LOCAL_DONE_WINDOW_MS) {
    return { state: "done", isOngoing: false };
  }

  return { state: "idle", isOngoing: false };
}

function cursorLocalActivityState(input: {
  composer: CursorComposerSummary;
  isPrimaryComposer: boolean;
  latestGenerationMs: number;
  agentLoop: CursorAgentLoopState;
  now: number;
}): { state: ActivityState; isOngoing: boolean } {
  const composerUpdatedAt = cursorComposerTimestamp(input.composer);
  const latestGenerationMs = input.isPrimaryComposer ? input.latestGenerationMs : 0;
  const agentLoopUpdatedAtMs = input.isPrimaryComposer ? (input.agentLoop.updatedAtMs ?? 0) : 0;
  const agentLoopActive = input.isPrimaryComposer ? input.agentLoop.active : false;
  const referenceUpdatedAt = Math.max(composerUpdatedAt, latestGenerationMs, agentLoopUpdatedAtMs);
  const ageMs = input.now - referenceUpdatedAt;
  const changedFiles = input.composer.filesChangedCount ?? 0;
  const changedLines = (input.composer.totalLinesAdded ?? 0) + (input.composer.totalLinesRemoved ?? 0);

  if (input.composer.hasBlockingPendingActions) {
    return { state: "blocked", isOngoing: true };
  }

  if (input.isPrimaryComposer && (agentLoopActive || ageMs <= CURSOR_LOCAL_ACTIVE_WINDOW_MS)) {
    if (changedFiles > 0 || changedLines > 0) {
      return { state: "editing", isOngoing: true };
    }
    return { state: "thinking", isOngoing: true };
  }

  if (changedFiles > 0 || changedLines > 0) {
    if (ageMs <= CURSOR_LOCAL_DONE_WINDOW_MS) {
      return { state: "done", isOngoing: false };
    }
    return { state: "idle", isOngoing: false };
  }

  if (ageMs <= CURSOR_LOCAL_DONE_WINDOW_MS) {
    return { state: "done", isOngoing: false };
  }

  return { state: "idle", isOngoing: false };
}

function cursorTranscriptMessageEvent(input: {
  projectRoot: string;
  sessionId: string;
  role: "user" | "assistant" | null;
  detail: string | null;
  createdAtMs: number;
}): DashboardEvent | null {
  if (!input.role || !input.detail || Date.now() - input.createdAtMs > CURSOR_LOCAL_EVENT_WINDOW_MS) {
    return null;
  }

  return {
    id: `${input.projectRoot}::cursor-local::${input.sessionId}::${input.createdAtMs}`,
    source: "cursor",
    confidence: "inferred",
    threadId: input.sessionId,
    createdAt: new Date(input.createdAtMs).toISOString(),
    method: input.role === "user" ? "cursor/local/userMessage" : "cursor/local/agentMessage",
    kind: "message",
    phase: "updated",
    title: input.role === "user" ? "Cursor prompt" : "Cursor reply",
    detail: cursorLocalPromptDetail(input.detail, "Cursor local"),
    path: input.projectRoot,
    action: "said",
    isImage: false
  };
}

function cursorLocalPromptEvent(
  projectRoot: string,
  composerId: string,
  prompt: string | null,
  createdAtMs: number
): DashboardEvent | null {
  if (!prompt || !Number.isFinite(createdAtMs) || Date.now() - createdAtMs > CURSOR_LOCAL_EVENT_WINDOW_MS) {
    return null;
  }

  return {
    id: `${projectRoot}::cursor-local::${composerId}::${createdAtMs}`,
    source: "cursor",
    confidence: "inferred",
    threadId: composerId,
    createdAt: new Date(createdAtMs).toISOString(),
    method: "cursor/local/prompt",
    kind: "message",
    phase: "updated",
    title: "Cursor prompt",
    detail: cursorLocalPromptDetail(prompt, "Cursor local prompt"),
    path: projectRoot,
    action: "said",
    isImage: false
  };
}

async function gitCurrentBranch(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectRoot, "rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = stdout.trim();
    return branch.length > 0 && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}

async function loadCursorTranscriptProjectSnapshotData(projectRoot: string, limit = cursorLocalSessionLimit()): Promise<{
  agents: DashboardAgent[];
  events: DashboardEvent[];
}> {
  const canonicalRoot = canonicalizeProjectPath(projectRoot);
  if (!canonicalRoot) {
    return { agents: [], events: [] };
  }

  const transcriptFiles = (await cursorTranscriptFiles(canonicalRoot)).slice(0, Math.max(limit, 24));
  if (transcriptFiles.length === 0) {
    return { agents: [], events: [] };
  }

  const summaries = (await Promise.all(transcriptFiles.map((file) => summariseCursorTranscriptSession(file))))
    .filter((summary): summary is CursorTranscriptSessionSummary => summary !== null);
  if (summaries.length === 0) {
    return { agents: [], events: [] };
  }

  const now = Date.now();
  const [originUrl, branch] = await Promise.all([
    gitRemoteOriginUrl(canonicalRoot),
    gitCurrentBranch(canonicalRoot)
  ]);

  const agents: DashboardAgent[] = [];
  const events: DashboardEvent[] = [];
  for (const summary of summaries.slice(0, limit)) {
    const { state, isOngoing } = cursorTranscriptActivityState(summary, now);
    if (state === "idle" && !isOngoing) {
      continue;
    }

    const labelText = summary.initialPrompt
      ?? summary.latestUserText
      ?? summary.latestAssistantText
      ?? `Cursor ${summary.sessionId.slice(0, 4)}`;
    const detailText = summary.latestAssistantText
      ?? summary.latestUserText
      ?? summary.initialPrompt
      ?? "Cursor local";
    const activityText = summary.latestRole === "assistant"
      ? (summary.latestAssistantText ?? detailText)
      : (summary.latestUserText ?? summary.initialPrompt ?? detailText);
    const updatedAt = new Date(summary.updatedAtMs || now).toISOString();
    const appearance = await ensureAgentAppearance(canonicalRoot, `cursor-local:${summary.sessionId}`);
    const activityEvent: AgentActivityEvent | null = activityText
      ? {
        type: summary.latestRole === "user" ? "userMessage" : "agentMessage",
        action: "said",
        path: canonicalRoot,
        title: cursorLocalPromptDetail(activityText, "Cursor local"),
        isImage: false
      }
      : null;

    agents.push({
      id: `cursor-local:${summary.sessionId}`,
      label: cursorLocalPromptDetail(labelText, `Cursor ${summary.sessionId.slice(0, 4)}`),
      source: "cursor",
      sourceKind: summary.model ? `cursor:${summary.model}` : "cursor:local:agent-transcript",
      parentThreadId: null,
      depth: 0,
      isCurrent: false,
      isOngoing,
      statusText: summary.model ?? "agent transcript",
      role: "cursor",
      nickname: null,
      isSubagent: false,
      state,
      detail: cursorLocalPromptDetail(detailText, "Cursor local"),
      cwd: canonicalRoot,
      roomId: null,
      appearance,
      updatedAt,
      stoppedAt: isOngoing ? null : updatedAt,
      paths: [canonicalRoot],
      activityEvent,
      latestMessage: summary.latestAssistantText,
      threadId: summary.sessionId,
      taskId: null,
      resumeCommand: null,
      url: null,
      git: {
        sha: null,
        branch,
        originUrl
      },
      provenance: "cursor",
      confidence: "inferred",
      needsUser: null,
      liveSubscription: "readOnly",
      network: null
    });

    const event = cursorTranscriptMessageEvent({
      projectRoot: canonicalRoot,
      sessionId: summary.sessionId,
      role: summary.latestRole,
      detail: activityText,
      createdAtMs: summary.updatedAtMs
    });
    if (event) {
      events.push(event);
    }
  }

  return {
    agents: agents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    events: events.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  };
}

export async function loadCursorLocalProjectSnapshotData(projectRoot: string, limit = cursorLocalSessionLimit()): Promise<{
  agents: DashboardAgent[];
  events: DashboardEvent[];
}> {
  return loadCursorHookProjectSnapshotData(projectRoot, limit);
}
