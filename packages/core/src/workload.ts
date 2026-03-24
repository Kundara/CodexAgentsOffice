import type { CloudTask, DashboardAgent, DashboardSnapshot } from "./types";

const ACTIVE_LOCAL_WINDOW_MS = 20 * 60 * 1000;
const WAITING_LOCAL_WINDOW_MS = 45 * 60 * 1000;
const ACTIVE_PRESENCE_WINDOW_MS = 3 * 60 * 1000;
const ACTIVE_CLOUD_WINDOW_MS = 8 * 60 * 60 * 1000;
const ACTIVE_SUBSCRIBED_LOCAL_WINDOW_MS = 90 * 1000;
const ACTIVE_FRESH_LOCAL_WINDOW_MS = 30 * 1000;
export const RECENT_DONE_GRACE_MS = 5 * 1000;

const TERMINAL_CLOUD_STATUSES = new Set([
  "ready",
  "completed",
  "complete",
  "failed",
  "cancelled",
  "canceled",
  "error"
]);

export function isTerminalCloudStatus(status: string | null | undefined): boolean {
  if (typeof status !== "string") {
    return false;
  }
  return TERMINAL_CLOUD_STATUSES.has(status.trim().toLowerCase());
}

function parseUpdatedAt(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
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

export function isCurrentCloudTask(task: CloudTask, now = Date.now()): boolean {
  const updatedAt = parseUpdatedAt(task.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return false;
  }
  if (isTerminalCloudStatus(task.status)) {
    return false;
  }
  return now - updatedAt <= ACTIVE_CLOUD_WINDOW_MS;
}

export function isCurrentWorkloadAgent(agent: DashboardAgent, now = Date.now()): boolean {
  const updatedAt = parseUpdatedAt(agent.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  if (agent.source === "cloud") {
    return !isTerminalCloudStatus(agent.statusText) && now - updatedAt <= ACTIVE_CLOUD_WINDOW_MS;
  }

  if (agent.source === "local") {
    const stoppedAt = parseUpdatedAt(agent.stoppedAt ?? "");
    if (Number.isFinite(stoppedAt)) {
      return now - stoppedAt <= RECENT_DONE_GRACE_MS;
    }
    if (
      agent.isOngoing
      || agent.statusText === "active"
      || agent.state === "waiting"
      || agent.state === "blocked"
      || agent.needsUser !== null
    ) {
      return true;
    }
    if (agent.state === "done") {
      return now - updatedAt <= RECENT_DONE_GRACE_MS;
    }
    if (
      isLiveLocalState(agent.state)
      && now - updatedAt <= ACTIVE_FRESH_LOCAL_WINDOW_MS
    ) {
      return true;
    }
    if (
      agent.liveSubscription === "subscribed"
      && isLiveLocalState(agent.state)
      && now - updatedAt <= ACTIVE_SUBSCRIBED_LOCAL_WINDOW_MS
    ) {
      return true;
    }
    return false;
  }

  if (agent.state === "idle") {
    return false;
  }

  if (agent.state === "done") {
    return now - updatedAt <= RECENT_DONE_GRACE_MS;
  }

  if (agent.source === "presence") {
    return now - updatedAt <= ACTIVE_PRESENCE_WINDOW_MS;
  }

  const freshnessWindow =
    agent.state === "waiting" || agent.state === "blocked"
      ? WAITING_LOCAL_WINDOW_MS
      : ACTIVE_LOCAL_WINDOW_MS;

  return now - updatedAt <= freshnessWindow;
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
