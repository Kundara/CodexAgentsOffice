export type ActivityState =
  | "planning"
  | "scanning"
  | "thinking"
  | "editing"
  | "running"
  | "validating"
  | "delegating"
  | "waiting"
  | "blocked"
  | "done"
  | "idle"
  | "cloud";

export interface RoomDefinition {
  id: string;
  name: string;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: RoomDefinition[];
}

export interface RoomConfig {
  version: number;
  generated: boolean;
  filePath: string;
  rooms: RoomDefinition[];
}

export interface AppearanceProfile {
  id: string;
  label: string;
  body: string;
  accent: string;
  shadow: string;
}

export interface AsepriteHeader {
  fileSize: number;
  frames: number;
  width: number;
  height: number;
  colorDepth: number;
  flags: number;
  speed: number;
}

export interface AgentAppearanceEntry {
  appearanceId: string;
  updatedAt: string;
}

export interface AgentRoster {
  version: number;
  agents: Record<string, AgentAppearanceEntry>;
}

export interface PresenceEntry {
  id: string;
  label: string;
  role: string | null;
  state: ActivityState;
  detail: string;
  cwd: string | null;
  updatedAt: string;
  appearanceId?: string | null;
}

export interface PresenceRoster {
  version: number;
  agents: PresenceEntry[];
}

export interface GitInfo {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
}

export interface ThreadItem {
  type: string;
  [key: string]: unknown;
}

export type AgentActivityEventType =
  | "userMessage"
  | "agentMessage"
  | "plan"
  | "reasoning"
  | "commandExecution"
  | "fileChange"
  | "mcpToolCall"
  | "dynamicToolCall"
  | "collabToolCall"
  | "collabAgentToolCall"
  | "webSearch"
  | "imageView"
  | "enteredReviewMode"
  | "exitedReviewMode"
  | "contextCompaction"
  | "other";

export type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags?: string[] };

export interface CodexTurn {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error: { message?: string } | null;
  items: ThreadItem[];
}

export interface CodexThread {
  id: string;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: ThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: string | Record<string, unknown>;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: GitInfo | null;
  name: string | null;
  turns: CodexTurn[];
}

export interface CloudTask {
  id: string;
  url: string;
  title: string;
  status: string;
  updatedAt: string;
  environmentId: string | null;
  environmentLabel: string | null;
  summary: {
    filesChanged: number;
    linesAdded: number;
    linesRemoved: number;
  };
  isReview: boolean;
  attemptTotal: number;
}

export interface AgentActivityEvent {
  type: AgentActivityEventType;
  action: "created" | "edited" | "deleted" | "moved" | "ran" | "said" | "updated";
  path: string | null;
  title: string;
  isImage: boolean;
  linesAdded?: number;
  linesRemoved?: number;
}

export type AgentProvenanceSource = "codex" | "claude" | "cloud" | "cursor" | "presence";
export type AgentConfidence = "typed" | "inferred";

// Stores live approval/input waits from app-server.
// Stores live approval/input waits from the app-server observer.
export interface NeedsUserState {
  kind: "approval" | "input";
  requestId: string;
  turnId?: string;
  itemId?: string;
  reason?: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
}

export interface DashboardEvent {
  id: string;
  source: AgentProvenanceSource;
  confidence: AgentConfidence;
  threadId: string | null;
  createdAt: string;
  method: string;
  turnId?: string;
  itemId?: string;
  itemType?: string;
  requestId?: string;
  kind: "turn" | "item" | "approval" | "input" | "command" | "fileChange" | "subagent" | "status" | "message" | "tool" | "other";
  phase: "started" | "completed" | "interrupted" | "failed" | "waiting" | "updated";
  title: string;
  detail: string;
  path: string | null;
  action?: "created" | "edited" | "deleted" | "moved" | "ran" | "said" | "updated";
  isImage?: boolean;
  linesAdded?: number;
  linesRemoved?: number;
  reason?: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
  availableDecisions?: string[];
  networkApprovalContext?: Record<string, unknown> | null;
}

export interface DashboardAgent {
  id: string;
  label: string;
  source: "local" | "cloud" | "cursor" | "presence" | "claude";
  sourceKind: string;
  parentThreadId: string | null;
  depth: number;
  isCurrent: boolean;
  isOngoing: boolean;
  statusText: string | null;
  role: string | null;
  nickname: string | null;
  isSubagent: boolean;
  state: ActivityState;
  detail: string;
  cwd: string | null;
  roomId: string | null;
  appearance: AppearanceProfile;
  updatedAt: string;
  stoppedAt: string | null;
  paths: string[];
  activityEvent: AgentActivityEvent | null;
  latestMessage: string | null;
  threadId: string | null;
  taskId: string | null;
  resumeCommand: string | null;
  url: string | null;
  git: GitInfo | null;
  provenance: AgentProvenanceSource;
  confidence: AgentConfidence;
  needsUser: NeedsUserState | null;
  liveSubscription: "subscribed" | "readOnly";
}

export interface DashboardSnapshot {
  projectRoot: string;
  generatedAt: string;
  rooms: RoomConfig;
  agents: DashboardAgent[];
  cloudTasks: CloudTask[];
  events: DashboardEvent[];
  notes: string[];
}

export interface SnapshotOptions {
  projectRoot: string;
  includeCloud?: boolean;
  localLimit?: number;
  readThreads?: boolean;
}
