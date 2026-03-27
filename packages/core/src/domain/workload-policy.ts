import type { CloudTask, DashboardAgent, DashboardSnapshot } from "../types";

const ACTIVE_LOCAL_WINDOW_MS = 20 * 60 * 1000;
const WAITING_LOCAL_WINDOW_MS = 45 * 60 * 1000;
const ACTIVE_PRESENCE_WINDOW_MS = 3 * 60 * 1000;
const ACTIVE_CLOUD_WINDOW_MS = 8 * 60 * 60 * 1000;
const ACTIVE_SUBSCRIBED_LOCAL_WINDOW_MS = 90 * 1000;
const ACTIVE_FRESH_LOCAL_WINDOW_MS = 30 * 1000;
export const RECENT_DONE_GRACE_MS = 5 * 1000;
const SUBAGENT_DONE_GRACE_MS = 1200;
const FUTURE_TIMESTAMP_TOLERANCE_MS = 5 * 1000;

const TERMINAL_CLOUD_STATUSES = new Set([
  "ready",
  "completed",
  "complete",
  "failed",
  "cancelled",
  "canceled",
  "error"
]);

function parseUpdatedAt(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function ageSince(timestamp: number, now: number): number {
  if (!Number.isFinite(timestamp)) {
    return Number.NaN;
  }
  const deltaMs = now - timestamp;
  if (deltaMs < -FUTURE_TIMESTAMP_TOLERANCE_MS) {
    return Number.NaN;
  }
  return Math.max(0, deltaMs);
}

function isLiveLocalState(state: string): boolean {
  return [
    "editing",
    "running",
    "validating",
    "scanning",
    "thinking",
    "planning",
    "delegating"
  ].includes(state);
}

function hasMeaningfulAgentReply(agent: Pick<DashboardAgent, "latestMessage" | "activityEvent">): boolean {
  if (typeof agent.latestMessage === "string" && agent.latestMessage.trim().length > 0) {
    return true;
  }
  return agent.activityEvent?.type === "agentMessage";
}

function settleDormantLocalState(
  agent: DashboardAgent,
  isCurrent: boolean
): DashboardAgent {
  const stoppedAt = parseUpdatedAt(agent.stoppedAt ?? "");
  if (
    agent.source !== "local"
    || agent.isOngoing
    || agent.statusText === "active"
    || agent.needsUser !== null
    || !isLiveLocalState(agent.state)
  ) {
    return agent;
  }

  if (!Number.isFinite(stoppedAt) && isCurrent) {
    return agent;
  }

  return {
    ...agent,
    state: hasMeaningfulAgentReply(agent) ? "done" : "idle"
  };
}

export function terminalDoneGraceMs(agent: Pick<DashboardAgent, "parentThreadId">): number {
  return agent.parentThreadId ? SUBAGENT_DONE_GRACE_MS : RECENT_DONE_GRACE_MS;
}

export function isTerminalCloudStatus(status: string | null | undefined): boolean {
  if (typeof status !== "string") {
    return false;
  }
  return TERMINAL_CLOUD_STATUSES.has(status.trim().toLowerCase());
}

export function isCurrentCloudTask(task: CloudTask, now = Date.now()): boolean {
  const updatedAtAgeMs = ageSince(parseUpdatedAt(task.updatedAt), now);
  if (!Number.isFinite(updatedAtAgeMs)) {
    return false;
  }
  if (isTerminalCloudStatus(task.status)) {
    return false;
  }
  return updatedAtAgeMs <= ACTIVE_CLOUD_WINDOW_MS;
}

export function isCurrentWorkloadAgent(agent: DashboardAgent, now = Date.now()): boolean {
  const doneGraceMs = terminalDoneGraceMs(agent);

  if (agent.source === "cloud") {
    const updatedAtAgeMs = ageSince(parseUpdatedAt(agent.updatedAt), now);
    if (!Number.isFinite(updatedAtAgeMs)) {
      return false;
    }
    return !isTerminalCloudStatus(agent.statusText) && updatedAtAgeMs <= ACTIVE_CLOUD_WINDOW_MS;
  }

  if (agent.source === "local") {
    if (
      agent.isOngoing
      || agent.statusText === "active"
      || agent.needsUser !== null
    ) {
      return true;
    }

    const updatedAtAgeMs = ageSince(parseUpdatedAt(agent.updatedAt), now);
    if (
      !Number.isFinite(updatedAtAgeMs)
      && agent.activityEvent?.type === "userMessage"
    ) {
      return true;
    }
    if (!Number.isFinite(updatedAtAgeMs)) {
      return false;
    }
    const stoppedAtAgeMs = ageSince(parseUpdatedAt(agent.stoppedAt ?? ""), now);
    if (Number.isFinite(stoppedAtAgeMs)) {
      return stoppedAtAgeMs <= doneGraceMs;
    }
    if (agent.state === "waiting" || agent.state === "blocked") {
      return updatedAtAgeMs <= WAITING_LOCAL_WINDOW_MS;
    }
    if (agent.state === "done") {
      return updatedAtAgeMs <= doneGraceMs;
    }
    if (
      isLiveLocalState(agent.state)
      && updatedAtAgeMs <= ACTIVE_FRESH_LOCAL_WINDOW_MS
    ) {
      return true;
    }
    if (
      agent.liveSubscription === "subscribed"
      && isLiveLocalState(agent.state)
      && updatedAtAgeMs <= ACTIVE_SUBSCRIBED_LOCAL_WINDOW_MS
    ) {
      return true;
    }
    return false;
  }

  if (agent.state === "idle") {
    return false;
  }

  const updatedAtAgeMs = ageSince(parseUpdatedAt(agent.updatedAt), now);
  if (!Number.isFinite(updatedAtAgeMs)) {
    return false;
  }

  if (agent.state === "done") {
    return updatedAtAgeMs <= doneGraceMs;
  }

  if (agent.source === "presence") {
    return updatedAtAgeMs <= ACTIVE_PRESENCE_WINDOW_MS;
  }

  const freshnessWindow =
    agent.state === "waiting" || agent.state === "blocked"
      ? WAITING_LOCAL_WINDOW_MS
      : ACTIVE_LOCAL_WINDOW_MS;

  return updatedAtAgeMs <= freshnessWindow;
}

export function applyCurrentWorkloadState(snapshot: DashboardSnapshot, now = Date.now()): DashboardSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((agent) => {
      const isCurrent = isCurrentWorkloadAgent(agent, now);
      return settleDormantLocalState({
        ...agent,
        isCurrent
      }, isCurrent);
    }),
    cloudTasks: snapshot.cloudTasks.filter((task) => isCurrentCloudTask(task, now))
  };
}

export function filterSnapshotToCurrentWorkload(
  snapshot: DashboardSnapshot,
  now = Date.now()
): DashboardSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.filter((agent) => isCurrentWorkloadAgent(agent, now)),
    cloudTasks: snapshot.cloudTasks.filter((task) => isCurrentCloudTask(task, now))
  };
}
