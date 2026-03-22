import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { CloudTask } from "./types";

const execFileAsync = promisify(execFile);

interface RawCloudTask {
  id: string;
  url: string;
  title: string;
  status: string;
  updated_at: string;
  environment_id: string | null;
  environment_label: string | null;
  summary?: {
    files_changed?: number;
    lines_added?: number;
    lines_removed?: number;
  };
  is_review?: boolean;
  attempt_total?: number;
}

interface RawCloudListResponse {
  tasks?: RawCloudTask[];
}

export async function listCloudTasks(limit = 12): Promise<CloudTask[]> {
  const { stdout } = await execFileAsync("codex", ["cloud", "list", "--json", "--limit", String(limit)]);
  const parsed = JSON.parse(stdout) as RawCloudListResponse;
  return (parsed.tasks ?? []).map((task) => ({
    id: task.id,
    url: task.url,
    title: task.title,
    status: task.status,
    updatedAt: task.updated_at,
    environmentId: task.environment_id ?? null,
    environmentLabel: task.environment_label ?? null,
    summary: {
      filesChanged: task.summary?.files_changed ?? 0,
      linesAdded: task.summary?.lines_added ?? 0,
      linesRemoved: task.summary?.lines_removed ?? 0
    },
    isReview: Boolean(task.is_review),
    attemptTotal: task.attempt_total ?? 0
  }));
}
