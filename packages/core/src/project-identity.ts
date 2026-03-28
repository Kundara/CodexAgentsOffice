import { execFile } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
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

function resolveGitPath(projectRoot: string, value: string | null): string | null {
  if (!value) {
    return null;
  }
  const absolute = value.startsWith("/") ? value : resolve(projectRoot, value);
  return canonicalizeProjectPath(absolute);
}

function deriveWorktreeName(input: {
  projectRoot: string;
  gitRoot: string;
  commonGitDir: string | null;
  absoluteGitDir: string | null;
}): string | null {
  const commonGitDir = canonicalizeProjectPath(input.commonGitDir);
  const absoluteGitDir = canonicalizeProjectPath(input.absoluteGitDir);
  if (!commonGitDir || !absoluteGitDir || commonGitDir === absoluteGitDir) {
    return null;
  }

  const repoBase = basename(input.gitRoot) || basename(input.projectRoot) || "repo";
  const projectLeaf = basename(input.projectRoot);
  if (projectLeaf && projectLeaf !== repoBase) {
    return projectLeaf;
  }

  const adminLeaf = basename(absoluteGitDir);
  if (adminLeaf && adminLeaf !== repoBase && adminLeaf !== ".git") {
    return adminLeaf;
  }

  const parentLeaf = basename(dirname(input.projectRoot));
  if (
    parentLeaf
    && parentLeaf !== repoBase
    && parentLeaf !== ".git"
    && parentLeaf !== ".codex"
    && parentLeaf !== "worktrees"
  ) {
    return parentLeaf;
  }

  return projectLeaf || adminLeaf || "worktree";
}

export async function resolveProjectIdentity(projectRoot: string): Promise<ProjectIdentity | null> {
  const gitRoot = resolveGitPath(projectRoot, await gitOutput(projectRoot, ["rev-parse", "--show-toplevel"]));
  if (!gitRoot) {
    return null;
  }

  const commonGitDir = resolveGitPath(projectRoot, await gitOutput(projectRoot, ["rev-parse", "--git-common-dir"]));
  const absoluteGitDir = resolveGitPath(projectRoot, await gitOutput(projectRoot, ["rev-parse", "--absolute-git-dir"]));
  const repoUrl = normalizeRepositoryUrl(await gitOutput(projectRoot, ["config", "--get", "remote.origin.url"]));
  const branch = await gitOutput(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const repoName = repoNameFromUrl(repoUrl) ?? basename(gitRoot) ?? projectLabelFromRoot(projectRoot);
  const worktreeName = deriveWorktreeName({
    projectRoot,
    gitRoot,
    commonGitDir,
    absoluteGitDir
  });

  return {
    key: repoUrl ?? commonGitDir ?? gitRoot,
    source: repoUrl ? "git" : "unknown",
    gitRoot,
    commonGitDir,
    repoUrl,
    repoName,
    branch,
    worktreeName
  };
}
