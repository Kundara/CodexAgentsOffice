import { basename, normalize } from "node:path";

import { withAppServerClient } from "./app-server";
import type { CodexThread } from "./types";

export interface DiscoveredProject {
  root: string;
  label: string;
  updatedAt: number;
  count: number;
}

const MIN_CODEX_PROJECT_DISCOVERY_THREAD_LIMIT = 100;
const MAX_CODEX_PROJECT_DISCOVERY_THREAD_LIMIT = 400;
const CODEX_PROJECT_DISCOVERY_THREAD_MULTIPLIER = 20;

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

export function canonicalizeProjectPath(input: string | null | undefined): string | null {
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
    return trimTrailingSlash(normalize(`/mnt/${drive}/${rest}`));
  }

  if (raw.startsWith("/")) {
    return trimTrailingSlash(normalize(raw.replace(/\\/g, "/")));
  }

  return trimTrailingSlash(raw.replace(/\\/g, "/"));
}

export function projectLabelFromRoot(projectRoot: string): string {
  return humanizeProjectLabel(basename(projectRoot) || projectRoot);
}

export function humanizeProjectLabel(label: string): string {
  const normalized = String(label || "").trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

export function sameProjectPath(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftCanonical = canonicalizeProjectPath(left);
  const rightCanonical = canonicalizeProjectPath(right);
  return Boolean(leftCanonical && rightCanonical && leftCanonical === rightCanonical);
}

export function filterThreadsForProject(projectRoot: string, threads: CodexThread[]): CodexThread[] {
  const canonicalRoot = canonicalizeProjectPath(projectRoot);
  if (!canonicalRoot) {
    return [];
  }

  return threads.filter((thread) => sameProjectPath(thread.cwd, canonicalRoot));
}

export function codexProjectDiscoveryThreadLimit(projectLimit: number): number {
  const normalizedLimit = Number.isFinite(projectLimit)
    ? Math.max(1, Math.floor(projectLimit))
    : 20;
  return Math.max(
    normalizedLimit,
    Math.min(
      MAX_CODEX_PROJECT_DISCOVERY_THREAD_LIMIT,
      Math.max(MIN_CODEX_PROJECT_DISCOVERY_THREAD_LIMIT, normalizedLimit * CODEX_PROJECT_DISCOVERY_THREAD_MULTIPLIER)
    )
  );
}

export async function discoverCodexProjects(limit = 20): Promise<DiscoveredProject[]> {
  const projects = new Map<string, DiscoveredProject>();
  const threadLimit = codexProjectDiscoveryThreadLimit(limit);

  await withAppServerClient(async (client) => {
    const threads = await client.listThreads({ limit: threadLimit });
    for (const thread of threads) {
      const root = canonicalizeProjectPath(thread.cwd);
      if (!root) {
        continue;
      }

      const existing = projects.get(root);
      if (existing) {
        existing.updatedAt = Math.max(existing.updatedAt, thread.updatedAt);
        existing.count += 1;
        continue;
      }

      projects.set(root, {
        root,
        label: projectLabelFromRoot(root),
        updatedAt: thread.updatedAt,
        count: 1
      });
    }
  });

  return [...projects.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function discoverProjects(limit = 20): Promise<DiscoveredProject[]> {
  const merged = new Map<string, DiscoveredProject>();
  const { PROJECT_ADAPTERS } = await import("./adapters");
  const discoveredProjectLists: DiscoveredProject[][] = await Promise.all([
    discoverCodexProjects(limit).catch(() => []),
    ...PROJECT_ADAPTERS
      .filter((adapter) => typeof adapter.discoverProjects === "function")
      .map((adapter) => adapter.discoverProjects!(limit).catch(() => [] as DiscoveredProject[]))
  ]);

  for (const project of discoveredProjectLists.flat()) {
    const existing = merged.get(project.root);
    if (existing) {
      existing.updatedAt = Math.max(existing.updatedAt, project.updatedAt);
      existing.count += project.count;
      continue;
    }

    merged.set(project.root, { ...project });
  }

  return [...merged.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}
