import { basename } from "node:path";

import { withAppServerClient } from "../app-server";
import { selectProjectThreadsWithParents } from "../local-thread-selection";
import { assembleProjectSnapshot } from "../services/snapshot-assembler";
import type { AdapterSnapshot, ProjectSource } from "../adapters";
import type {
  CloudTask,
  DashboardSnapshot,
  NeedsUserState,
  SnapshotOptions,
  CodexThread,
  DashboardEvent
} from "../types";

const DEFAULT_LOCAL_THREAD_LIMIT = 24;

export function filterProjectCloudTasks(tasks: CloudTask[], projectRoot: string): CloudTask[] {
  return tasks.filter((task) => {
    const label = task.environmentLabel?.toLowerCase();
    if (!label) {
      return false;
    }
    return label.includes(basename(projectRoot).toLowerCase());
  });
}

async function buildLocalAgents(
  projectRoot: string,
  localLimit: number,
  notes: string[],
  readThreads = true
): Promise<CodexThread[]> {
  try {
    return await withAppServerClient(async (client) => {
      const allThreads = await client.listThreads({
        cwd: projectRoot,
        limit: Math.max(localLimit * 4, 40)
      });
      const threads = selectProjectThreadsWithParents(projectRoot, allThreads, localLimit);
      if (!readThreads) {
        return threads;
      }
      return Promise.all(threads.map((thread) => client.readThread(thread.id)));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(`Local Codex app-server unavailable: ${message}`);
    return [];
  }
}

export async function buildDashboardSnapshotFromState(input: {
  projectRoot: string;
  threads: CodexThread[];
  cloudTasks?: CloudTask[];
  events?: DashboardEvent[];
  notes?: string[];
  needsUserByThreadId?: Map<string, NeedsUserState>;
  subscribedThreadIds?: Set<string>;
  stoppedAtByThreadId?: Map<string, number>;
  ongoingThreadIds?: Set<string>;
}): Promise<DashboardSnapshot> {
  const snapshotStartedAt = Date.now();
  const [
    { buildCodexLocalAdapterSnapshotFromState },
    { cloudTasksToAgents, codexCloudAdapter },
    { claudeAdapter },
    { cursorCloudAdapter },
    { cursorLocalAdapter },
    { openClawAdapter },
    { presenceAdapter }
  ] = await Promise.all([
    import("../adapters/codex-local"),
    import("../adapters/codex-cloud"),
    import("../adapters/claude"),
    import("../adapters/cursor-cloud"),
    import("../adapters/cursor-local"),
    import("../adapters/openclaw"),
    import("../adapters/presence")
  ]);

  const localSnapshotPromise = buildCodexLocalAdapterSnapshotFromState({
    projectRoot: input.projectRoot,
    threads: input.threads,
    events: input.events,
    notes: input.notes,
    needsUserByThreadId: input.needsUserByThreadId,
    subscribedThreadIds: input.subscribedThreadIds,
    stoppedAtByThreadId: input.stoppedAtByThreadId,
    ongoingThreadIds: input.ongoingThreadIds
  });

  const staticSourceContexts = {
    projectRoot: input.projectRoot,
    localLimit: DEFAULT_LOCAL_THREAD_LIMIT,
    readThreads: true
  };
  const sources: ProjectSource[] = [
    input.cloudTasks ? null : codexCloudAdapter.createSource(staticSourceContexts),
    claudeAdapter.createSource(staticSourceContexts),
    cursorLocalAdapter.createSource(staticSourceContexts),
    cursorCloudAdapter.createSource(staticSourceContexts),
    openClawAdapter.createSource(staticSourceContexts),
    presenceAdapter.createSource(staticSourceContexts)
  ].filter((source): source is ProjectSource => source !== null);

  const staticSnapshots = await Promise.all(sources.map(async (source) => {
    await source.warm();
    const snapshot = source.getCachedSnapshot();
    await source.dispose();
    return snapshot;
  }));

  const adapterSnapshots: AdapterSnapshot[] = [
    await localSnapshotPromise,
    ...(input.cloudTasks
      ? [{
        adapterId: "codex-cloud",
        source: "cloud" as const,
        generatedAt: new Date().toISOString(),
        agents: await cloudTasksToAgents(input.projectRoot, input.cloudTasks),
        events: [],
        notes: [],
        cloudTasks: input.cloudTasks,
        health: {
          status: "ready" as const,
          detail: null,
          lastUpdatedAt: new Date().toISOString()
        }
      }]
      : []),
    ...staticSnapshots
  ];

  return assembleProjectSnapshot({
    projectRoot: input.projectRoot,
    adapterSnapshots,
    currentnessNow: snapshotStartedAt
  });
}

export async function buildDashboardSnapshot(
  options: SnapshotOptions
): Promise<DashboardSnapshot> {
  const notes: string[] = [];
  const threads = await buildLocalAgents(
    options.projectRoot,
    options.localLimit ?? DEFAULT_LOCAL_THREAD_LIMIT,
    notes,
    options.readThreads !== false
  );
  const initialCloudTasks = options.includeCloud === false ? [] : undefined;
  return buildDashboardSnapshotFromState({
    projectRoot: options.projectRoot,
    threads,
    cloudTasks: initialCloudTasks,
    notes
  });
}
