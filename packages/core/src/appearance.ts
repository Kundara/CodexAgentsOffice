import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentRoster, AppearanceProfile } from "./types";
import { getRosterFilePath } from "./room-config";

export const APPEARANCES: AppearanceProfile[] = [
  { id: "mint", label: "Mint", body: "#4bd69f", accent: "#dff8ec", shadow: "#1d7c5a" },
  { id: "ember", label: "Ember", body: "#f06d5e", accent: "#ffe0db", shadow: "#932f25" },
  { id: "sun", label: "Sun", body: "#f5b74f", accent: "#fff1c9", shadow: "#93661f" },
  { id: "ocean", label: "Ocean", body: "#4f9df5", accent: "#d9edff", shadow: "#235896" },
  { id: "iris", label: "Iris", body: "#7b73f0", accent: "#e6e1ff", shadow: "#4139a3" },
  { id: "slate", label: "Slate", body: "#708090", accent: "#e4ebf0", shadow: "#374552" },
  { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
  { id: "rose", label: "Rose", body: "#d86797", accent: "#ffe1ef", shadow: "#86385a" }
];

function buildEmptyRoster(): AgentRoster {
  return { version: 1, agents: {} };
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

export async function loadAgentRoster(projectRoot: string): Promise<AgentRoster> {
  const rosterPath = getRosterFilePath(projectRoot);
  try {
    const text = await readFile(rosterPath, "utf8");
    const parsed = JSON.parse(text) as Partial<AgentRoster>;
    return {
      version: parsed.version ?? 1,
      agents: parsed.agents ?? {}
    };
  } catch {
    return buildEmptyRoster();
  }
}

async function saveAgentRoster(projectRoot: string, roster: AgentRoster): Promise<void> {
  const rosterPath = getRosterFilePath(projectRoot);
  await mkdir(dirname(rosterPath), { recursive: true });
  await writeFile(rosterPath, JSON.stringify(roster, null, 2) + "\n", "utf8");
}

export function getAppearanceById(appearanceId: string): AppearanceProfile {
  return APPEARANCES.find((appearance) => appearance.id === appearanceId) ?? APPEARANCES[0];
}

function getDeterministicAppearanceId(agentKey: string): string {
  const index = stableHash(agentKey) % APPEARANCES.length;
  return APPEARANCES[index].id;
}

export async function ensureAgentAppearance(
  projectRoot: string,
  agentKey: string
): Promise<AppearanceProfile> {
  const roster = await loadAgentRoster(projectRoot);
  const existing = roster.agents[agentKey];
  if (existing) {
    return getAppearanceById(existing.appearanceId);
  }

  const appearanceId = getDeterministicAppearanceId(agentKey);
  roster.agents[agentKey] = {
    appearanceId,
    updatedAt: new Date().toISOString()
  };
  await saveAgentRoster(projectRoot, roster);
  return getAppearanceById(appearanceId);
}

export async function cycleAgentAppearance(
  projectRoot: string,
  agentKey: string
): Promise<AppearanceProfile> {
  const roster = await loadAgentRoster(projectRoot);
  const current = roster.agents[agentKey]?.appearanceId ?? getDeterministicAppearanceId(agentKey);
  const currentIndex = APPEARANCES.findIndex((appearance) => appearance.id === current);
  const next = APPEARANCES[(currentIndex + 1 + APPEARANCES.length) % APPEARANCES.length];

  roster.agents[agentKey] = {
    appearanceId: next.id,
    updatedAt: new Date().toISOString()
  };
  await saveAgentRoster(projectRoot, roster);
  return next;
}
