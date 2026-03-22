import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { getAppearanceById } from "./appearance";
import { getPresenceFilePath } from "./room-config";
import type { DashboardAgent, PresenceEntry, PresenceRoster } from "./types";

const DEFAULT_BOSS_APPEARANCE_ID = "sun";
const PRESENCE_FRESHNESS_MS = 5 * 60 * 1000;

function emptyPresenceRoster(): PresenceRoster {
  return {
    version: 1,
    agents: []
  };
}

export async function loadPresenceRoster(projectRoot: string): Promise<PresenceRoster> {
  const filePath = getPresenceFilePath(projectRoot);
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as Partial<PresenceRoster>;
    return {
      version: parsed.version ?? 1,
      agents: Array.isArray(parsed.agents) ? parsed.agents : []
    };
  } catch {
    return emptyPresenceRoster();
  }
}

async function savePresenceRoster(projectRoot: string, roster: PresenceRoster): Promise<void> {
  const filePath = getPresenceFilePath(projectRoot);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(roster, null, 2) + "\n", "utf8");
}

export async function setBossPresence(projectRoot: string, input?: {
  state?: PresenceEntry["state"];
  detail?: string;
  label?: string;
}): Promise<void> {
  const roster = await loadPresenceRoster(projectRoot);
  const now = new Date().toISOString();
  const nextEntry: PresenceEntry = {
    id: "boss",
    label: input?.label ?? "Boss",
    role: "boss",
    state: input?.state ?? "thinking",
    detail: input?.detail ?? "Working in Codex desktop",
    cwd: projectRoot,
    updatedAt: now,
    appearanceId: DEFAULT_BOSS_APPEARANCE_ID
  };

  const nextAgents = roster.agents.filter((entry) => entry.id !== nextEntry.id);
  nextAgents.unshift(nextEntry);
  await savePresenceRoster(projectRoot, {
    version: roster.version,
    agents: nextAgents
  });
}

export async function clearBossPresence(projectRoot: string): Promise<void> {
  const roster = await loadPresenceRoster(projectRoot);
  await savePresenceRoster(projectRoot, {
    version: roster.version,
    agents: roster.agents.filter((entry) => entry.id !== "boss")
  });
}

export async function loadFreshPresenceAgents(projectRoot: string): Promise<DashboardAgent[]> {
  const roster = await loadPresenceRoster(projectRoot);
  const threshold = Date.now() - PRESENCE_FRESHNESS_MS;

  return roster.agents
    .filter((entry) => {
      const updatedAt = Date.parse(entry.updatedAt);
      return Number.isFinite(updatedAt) && updatedAt >= threshold;
    })
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      source: "presence" as const,
      sourceKind: "presence",
      parentThreadId: null,
      depth: 0,
      isCurrent: false,
      statusText: null,
      role: entry.role,
      nickname: null,
      isSubagent: false,
      state: entry.state,
      detail: entry.detail,
      cwd: entry.cwd,
      roomId: null,
      appearance: getAppearanceById(entry.appearanceId ?? DEFAULT_BOSS_APPEARANCE_ID),
      updatedAt: entry.updatedAt,
      paths: entry.cwd ? [entry.cwd] : [],
      threadId: null,
      taskId: null,
      resumeCommand: null,
      url: null,
      git: null
    }));
}
