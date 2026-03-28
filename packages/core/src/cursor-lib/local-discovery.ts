import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { canonicalizeProjectPath, projectLabelFromRoot } from "../project-paths";

const DEFAULT_CURSOR_LOCAL_SESSION_LIMIT = 12;

export interface CursorWorkspaceEntry {
  id: string;
  root: string;
  label: string;
  stateFilePath: string;
  backupFilePath: string;
  updatedAtMs: number;
}

export function cursorLocalSessionLimit(): number {
  const raw = Number.parseInt(process.env.CURSOR_LOCAL_SESSION_LIMIT ?? "", 10);
  if (!Number.isFinite(raw)) {
    return DEFAULT_CURSOR_LOCAL_SESSION_LIMIT;
  }
  return Math.max(1, Math.min(50, raw));
}

function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false);
}

function decodeCursorWorkspaceFolderUri(input: string | null | undefined): string | null {
  if (typeof input !== "string" || input.trim().length === 0) {
    return null;
  }

  const trimmed = input.trim();
  const windowsUriMatch = trimmed.match(/^file:\/\/\/([a-zA-Z]):\/(.*)$/);
  if (windowsUriMatch) {
    return canonicalizeProjectPath(`${windowsUriMatch[1]}:/${decodeURIComponent(windowsUriMatch[2])}`);
  }

  try {
    const url = new URL(trimmed);
    const decodedPath = decodeURIComponent(url.pathname);
    const windowsPathMatch = decodedPath.match(/^\/([a-zA-Z]):\/(.*)$/);
    if (windowsPathMatch) {
      return canonicalizeProjectPath(`${windowsPathMatch[1]}:/${windowsPathMatch[2]}`);
    }
    return canonicalizeProjectPath(decodedPath);
  } catch {
    return canonicalizeProjectPath(decodeURIComponent(trimmed));
  }
}

async function cursorUserDataDir(): Promise<string | null> {
  const candidates = new Set<string>();

  const explicit = canonicalizeProjectPath(process.env.CURSOR_USER_DATA_DIR);
  if (explicit) {
    candidates.add(explicit);
  }

  const appData = canonicalizeProjectPath(process.env.APPDATA);
  if (appData) {
    candidates.add(join(appData, "Cursor"));
  }

  if (await pathExists("/mnt/c/Users")) {
    try {
      const users = await readdir("/mnt/c/Users", { withFileTypes: true });
      for (const entry of users) {
        if (!entry.isDirectory()) {
          continue;
        }
        candidates.add(`/mnt/c/Users/${entry.name}/AppData/Roaming/Cursor`);
      }
    } catch {
      // ignore
    }
  }

  for (const candidate of candidates) {
    if (candidate && await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function cursorWorkspaceStorageDir(): Promise<string | null> {
  const explicit = canonicalizeProjectPath(process.env.CURSOR_WORKSPACE_STORAGE_DIR);
  if (explicit && await pathExists(explicit)) {
    return explicit;
  }

  const userDataDir = await cursorUserDataDir();
  if (!userDataDir) {
    return null;
  }

  const workspaceStorage = join(userDataDir, "User", "workspaceStorage");
  return await pathExists(workspaceStorage) ? workspaceStorage : null;
}

export async function cursorLogsDir(): Promise<string | null> {
  const explicit = canonicalizeProjectPath(process.env.CURSOR_LOGS_DIR);
  if (explicit && await pathExists(explicit)) {
    return explicit;
  }

  const userDataDir = await cursorUserDataDir();
  if (!userDataDir) {
    return null;
  }

  const logsDir = join(userDataDir, "logs");
  return await pathExists(logsDir) ? logsDir : null;
}

async function cursorProjectsDirs(): Promise<string[]> {
  const candidates = new Set<string>();

  const explicit = canonicalizeProjectPath(process.env.CURSOR_PROJECTS_DIR);
  if (explicit) {
    candidates.add(explicit);
  }

  const homeDir = canonicalizeProjectPath(process.env.HOME);
  if (homeDir) {
    candidates.add(join(homeDir, ".cursor", "projects"));
  }

  if (await pathExists("/mnt/c/Users")) {
    try {
      const users = await readdir("/mnt/c/Users", { withFileTypes: true });
      for (const entry of users) {
        if (!entry.isDirectory()) {
          continue;
        }
        candidates.add(`/mnt/c/Users/${entry.name}/.cursor/projects`);
      }
    } catch {
      // ignore
    }
  }

  const available: string[] = [];
  for (const candidate of candidates) {
    if (candidate && await pathExists(candidate)) {
      available.push(candidate);
    }
  }

  return available;
}

function cursorProjectKeyCandidates(projectRoot: string): string[] {
  const canonicalRoot = canonicalizeProjectPath(projectRoot);
  if (!canonicalRoot) {
    return [];
  }

  const candidates = new Set<string>();
  const unixStyle = canonicalRoot.replace(/^\/+/, "").replace(/[\\/]+/g, "-");
  if (unixStyle.length > 0) {
    candidates.add(unixStyle);
  }

  const windowsMountMatch = canonicalRoot.match(/^\/mnt\/([a-zA-Z])\/(.+)$/);
  if (windowsMountMatch) {
    const rest = windowsMountMatch[2].replace(/[\\/]+/g, "-");
    candidates.add(`${windowsMountMatch[1].toLowerCase()}-${rest}`);
    candidates.add(`${windowsMountMatch[1].toUpperCase()}-${rest}`);
  }

  return [...candidates];
}

async function cursorTranscriptDir(projectRoot: string): Promise<string | null> {
  const projectKeys = cursorProjectKeyCandidates(projectRoot);
  if (projectKeys.length === 0) {
    return null;
  }

  const projectDirs = await cursorProjectsDirs();
  for (const baseDir of projectDirs) {
    for (const projectKey of projectKeys) {
      const candidate = join(baseDir, projectKey, "agent-transcripts");
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export async function cursorTranscriptFiles(projectRoot: string): Promise<Array<{
  sessionId: string;
  filePath: string;
  createdAtMs: number;
  updatedAtMs: number;
}>> {
  const transcriptsDir = await cursorTranscriptDir(projectRoot);
  if (!transcriptsDir) {
    return [];
  }

  const entries = await readdir(transcriptsDir, { withFileTypes: true }).catch(() => []);
  const files: Array<{
    sessionId: string;
    filePath: string;
    createdAtMs: number;
    updatedAtMs: number;
  }> = [];

  for (const entry of entries) {
    const sessionId = entry.name.replace(/\.jsonl$/i, "");
    let filePath: string | null = null;

    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      filePath = join(transcriptsDir, entry.name);
    } else if (entry.isDirectory()) {
      const nested = join(transcriptsDir, entry.name, `${entry.name}.jsonl`);
      if (await pathExists(nested)) {
        filePath = nested;
      } else {
        const nestedEntries = await readdir(join(transcriptsDir, entry.name), { withFileTypes: true }).catch(() => []);
        const nestedFile = nestedEntries.find((candidate) => candidate.isFile() && candidate.name.endsWith(".jsonl")) ?? null;
        if (nestedFile) {
          filePath = join(transcriptsDir, entry.name, nestedFile.name);
        }
      }
    }

    if (!filePath) {
      continue;
    }

    const fileStats = await stat(filePath).catch(() => null);
    if (!fileStats?.isFile()) {
      continue;
    }

    files.push({
      sessionId,
      filePath,
      createdAtMs: fileStats.birthtimeMs || fileStats.ctimeMs || fileStats.mtimeMs,
      updatedAtMs: fileStats.mtimeMs
    });
  }

  return files.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

export async function loadCursorWorkspaceEntries(limit = 50): Promise<CursorWorkspaceEntry[]> {
  const workspaceStorage = await cursorWorkspaceStorageDir();
  if (!workspaceStorage) {
    return [];
  }

  const entries = await readdir(workspaceStorage, { withFileTypes: true }).catch(() => []);
  const workspaces: CursorWorkspaceEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const storageDir = join(workspaceStorage, entry.name);
    const workspaceJsonPath = join(storageDir, "workspace.json");
    const stateFilePath = join(storageDir, "state.vscdb");
    const backupFilePath = join(storageDir, "state.vscdb.backup");
    if (!await pathExists(workspaceJsonPath) || !await pathExists(stateFilePath)) {
      continue;
    }

    try {
      const rawWorkspace = JSON.parse(await readFile(workspaceJsonPath, "utf8")) as { folder?: string };
      const root = decodeCursorWorkspaceFolderUri(rawWorkspace.folder);
      if (!root) {
        continue;
      }

      const stateStats = await stat(stateFilePath).catch(() => null);
      const backupStats = await stat(backupFilePath).catch(() => null);
      const workspaceStats = await stat(workspaceJsonPath).catch(() => null);
      const updatedAtMs = Math.max(
        stateStats?.mtimeMs ?? 0,
        backupStats?.mtimeMs ?? 0,
        workspaceStats?.mtimeMs ?? 0
      );

      workspaces.push({
        id: entry.name,
        root,
        label: projectLabelFromRoot(root),
        stateFilePath,
        backupFilePath,
        updatedAtMs
      });
    } catch {
      continue;
    }
  }

  return workspaces
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, limit);
}
