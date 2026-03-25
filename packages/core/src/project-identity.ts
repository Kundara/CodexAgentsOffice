import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

import { normalizeRepositoryUrl } from "./cursor";
import { canonicalizeProjectPath, projectLabelFromRoot } from "./project-paths";
import type { ProjectIdentity } from "./types";

const execFileAsync = promisify(execFile);

function repoNameFromUrl(repoUrl: string | null): string | null {
  if (!repoUrl) {
    return null;
  }
  try {
    const url = new URL(repoUrl);
    const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    return segments.at(-1) ?? null;
  } catch {
    const segments = repoUrl.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    return segments.at(-1) ?? null;
  }
}

async function gitOutput(projectRoot: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectRoot, ...args]);
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export async function resolveProjectIdentity(projectRoot: string): Promise<ProjectIdentity | null> {
  const gitRootRaw = await gitOutput(projectRoot, ["rev-parse", "--show-toplevel"]);
  const gitRoot = canonicalizeProjectPath(gitRootRaw);
  if (!gitRoot) {
    return null;
  }

  const repoUrl = normalizeRepositoryUrl(await gitOutput(projectRoot, ["config", "--get", "remote.origin.url"]));
  const branch = await gitOutput(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const repoName = repoNameFromUrl(repoUrl) ?? basename(gitRoot) ?? projectLabelFromRoot(projectRoot);

  return {
    key: repoUrl,
    source: repoUrl ? "git" : "unknown",
    gitRoot,
    repoUrl,
    repoName,
    branch
  };
}
