import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CodexCommandCandidate {
  command: string;
  label: string;
}

export function buildCodexCommandCandidates(input: {
  platform: NodeJS.Platform;
  codexCliPath?: string | null;
  macAppBundlePaths?: string[];
}): CodexCommandCandidate[] {
  const candidates: CodexCommandCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (command: string | null | undefined, label: string): void => {
    if (typeof command !== "string") {
      return;
    }
    const normalized = command.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push({ command: normalized, label });
  };

  pushCandidate(input.codexCliPath, "CODEX_CLI_PATH override");
  pushCandidate(input.platform === "win32" ? "codex.cmd" : "codex", "Codex CLI on PATH");

  if (input.platform === "darwin") {
    for (const bundlePath of input.macAppBundlePaths ?? []) {
      pushCandidate(bundlePath, "Codex app bundle");
    }
  }

  return candidates;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function listCodexCommandCandidates(): Promise<CodexCommandCandidate[]> {
  const macAppBundlePaths: string[] = [];

  if (platform === "darwin") {
    const bundleCandidates = [
      "/Applications/Codex.app/Contents/Resources/codex",
      join(homedir(), "Applications", "Codex.app", "Contents", "Resources", "codex")
    ];

    for (const bundlePath of bundleCandidates) {
      if (await isExecutable(bundlePath)) {
        macAppBundlePaths.push(bundlePath);
      }
    }
  }

  return buildCodexCommandCandidates({
    platform,
    codexCliPath: process.env.CODEX_CLI_PATH,
    macAppBundlePaths
  });
}

function formatSpawnError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const details = "code" in error && typeof (error as NodeJS.ErrnoException).code === "string"
    ? ` (${(error as NodeJS.ErrnoException).code})`
    : "";
  return `${error.message}${details}`;
}

function codexResolutionHint(): string {
  if (platform === "darwin") {
    return "Install Codex CLI, set CODEX_CLI_PATH, or install the Codex app in /Applications.";
  }
  if (platform === "win32") {
    return "Install Codex CLI or set CODEX_CLI_PATH to a runnable Codex executable.";
  }
  return "Install Codex CLI or set CODEX_CLI_PATH to a runnable Codex executable.";
}

function buildResolutionError(errors: string[]): Error {
  const detail = errors.length > 0 ? ` Tried: ${errors.join("; ")}` : "";
  return new Error(`Unable to start Codex command.${detail} ${codexResolutionHint()}`.trim());
}

async function spawnCandidate(
  candidate: CodexCommandCandidate,
  args: string[]
): Promise<ChildProcessWithoutNullStreams> {
  return await new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
    const child = spawn(candidate.command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const onSpawn = (): void => {
      child.off("error", onError);
      resolve(child);
    };

    const onError = (error: Error): void => {
      child.off("spawn", onSpawn);
      reject(error);
    };

    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

export async function spawnCodexProcess(
  args: string[]
): Promise<{ child: ChildProcessWithoutNullStreams; candidate: CodexCommandCandidate }> {
  const candidates = await listCodexCommandCandidates();
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const child = await spawnCandidate(candidate, args);
      return { child, candidate };
    } catch (error) {
      errors.push(`${candidate.label}: ${formatSpawnError(error)}`);
    }
  }

  throw buildResolutionError(errors);
}

export async function execCodex(args: string[]): Promise<{ stdout: string; stderr: string; candidate: CodexCommandCandidate }> {
  const candidates = await listCodexCommandCandidates();
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const result = await execFileAsync(candidate.command, args);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        candidate
      };
    } catch (error) {
      errors.push(`${candidate.label}: ${formatSpawnError(error)}`);
    }
  }

  throw buildResolutionError(errors);
}
