import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ActivityState } from "../types";

const execFileAsync = promisify(execFile);

export function normalizeRepositoryUrl(input: string | null | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const scpLikeMatch = trimmed.match(/^git@([^:]+):(.+)$/i);
  if (scpLikeMatch) {
    const host = scpLikeMatch[1].toLowerCase();
    const pathname = scpLikeMatch[2].replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
    return `https://${host}/${pathname}`.toLowerCase();
  }

  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.toLowerCase();
    const normalizedProtocol =
      protocol === "ssh:" || protocol === "git:" ? "https:" : protocol;
    const pathname = normalizedRepositoryPathname(url.pathname);
    return `${normalizedProtocol}//${url.hostname.toLowerCase()}/${pathname}`.toLowerCase();
  } catch {
    return trimmed.replace(/\.git$/i, "").replace(/[\\/]+$/, "").toLowerCase();
  }
}

function normalizedRepositoryPathname(pathname: string): string {
  const trimmed = pathname.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return trimmed;
  }

  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  const githubPullIndex = segments.findIndex((segment) => segment === "pull" || segment === "pulls");
  if (githubPullIndex === 2) {
    return segments.slice(0, 2).join("/");
  }

  const bitbucketPullIndex = segments.findIndex((segment) => segment === "pull-requests");
  if (bitbucketPullIndex === 2) {
    return segments.slice(0, 2).join("/");
  }

  const gitlabMergeRequestIndex = segments.findIndex((segment) => segment === "merge_requests");
  if (gitlabMergeRequestIndex >= 2) {
    const repositorySegments =
      segments[gitlabMergeRequestIndex - 1] === "-"
        ? segments.slice(0, gitlabMergeRequestIndex - 1)
        : segments.slice(0, gitlabMergeRequestIndex);
    if (repositorySegments.length >= 2) {
      return repositorySegments.join("/");
    }
  }

  return trimmed;
}

export function cursorStatusToActivityState(status: string | null | undefined): ActivityState {
  const normalized = typeof status === "string" ? status.trim().toUpperCase() : "";
  switch (normalized) {
    case "CREATING":
    case "RUNNING":
      return "running";
    case "FINISHED":
      return "done";
    case "ERROR":
      return "blocked";
    case "EXPIRED":
      return "idle";
    default:
      return "idle";
  }
}

export function sourceKindFromModel(model: string | null | undefined): string {
  return model && model.trim().length > 0 ? `cursor:${model.trim()}` : "cursor";
}

export async function gitRemoteOriginUrl(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectRoot, "config", "--get", "remote.origin.url"]);
    return normalizeRepositoryUrl(stdout);
  } catch {
    return null;
  }
}
