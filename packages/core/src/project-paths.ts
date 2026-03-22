import { basename, normalize } from "node:path";

import { withAppServerClient } from "./app-server";
import type { CodexThread } from "./types";

export interface DiscoveredProject {
  root: string;
  label: string;
  updatedAt: number;
  count: number;
}

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
  return basename(projectRoot) || projectRoot;
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

export async function discoverCodexProjects(limit = 50): Promise<DiscoveredProject[]> {
  const projects = new Map<string, DiscoveredProject>();

  await withAppServerClient(async (client) => {
    const threads = await client.listThreads({ limit });
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
