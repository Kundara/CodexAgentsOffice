import { EventEmitter } from "node:events";
import { watch, watchFile, unwatchFile, type FSWatcher } from "node:fs";

import {
  type AppServerNotification,
  type AppServerServerRequest,
  CodexAppServerClient
} from "./app-server";
import { listCloudTasks } from "./cloud";
import { canonicalizeProjectPath, filterThreadsForProject } from "./project-paths";
import { getRoomsFilePath } from "./room-config";
import {
  buildDashboardSnapshotFromState,
  filterProjectCloudTasks,
  isOngoingThread,
  parentThreadIdForThread
} from "./snapshot";
import { selectProjectThreadsWithParents } from "./local-thread-selection";
import type {
  CloudTask,
  CodexThread,
  DashboardEvent,
  DashboardSnapshot,
  NeedsUserState
} from "./types";
import {
  asRecord,
  asString,
  buildDashboardEventFromAppServerMessage,
  buildNeedsUserStateFromServerRequest,
  buildThreadReadAgentMessageEvent,
  collectPaths,
  extractThreadId,
  hasEquivalentRecentMessageEvent,
  latestThreadAgentMessage,
  type PendingUserRequest,
  shouldMarkThreadLiveFromAppServerNotification,
  shouldMarkThreadStoppedFromAppServerNotification,
  shouldStopDormantThreadAfterAppServerNotification
} from "./live-monitor-lib/events";
import {
  buildRolloutHookEvent,
  parseApplyPatchInput,
  readRecentRolloutHookEvents
} from "./live-monitor-lib/rollout-hooks";
import { RECENT_DONE_GRACE_MS } from "./workload";

export {
  buildDashboardEventFromAppServerMessage,
  buildThreadReadAgentMessageEvent,
  hasEquivalentRecentMessageEvent,
  parseApplyPatchInput,
  buildRolloutHookEvent,
  shouldMarkThreadLiveFromAppServerNotification,
  shouldMarkThreadStoppedFromAppServerNotification
};

const DISCOVERY_INTERVAL_MS = 4000;
const CLOUD_REFRESH_INTERVAL_MS = 30000;
const FILE_WATCH_INTERVAL_MS = 250;
const SNAPSHOT_DEBOUNCE_MS = 60;
const THREAD_READ_DEBOUNCE_MS = 80;
const ACTIVE_SUBSCRIPTION_WINDOW_MS = 10 * 60 * 1000;
const MAX_SUBSCRIBED_THREADS = 8;
const MAX_RECENT_EVENTS = 64;
const RECENT_EVENT_RETENTION_MS = 90 * 1000;
// Desktop-backed threads can take noticeably longer to resume than simple CLI
// sessions, and a too-short timeout drops the live item stream we need for
// `item/agentMessage/*` notifications.
// Desktop-backed thread attaches can easily take 20s+ on large rollouts.
// Keep a wider budget so live subscriptions don't flap back to read-only.
const APP_SERVER_SUBSCRIPTION_TIMEOUT_MS = 60000;
const CLOUD_NOTE_LEGACY_PREFIX = "Codex cloud list unavailable:";
const CLOUD_NOTE_PREFIX = "Codex cloud ";
const STOPPED_THREAD_REMOVAL_BUFFER_MS = 1000;
const NOT_LOADED_STOP_DEBOUNCE_MS = 3000;
const DEFAULT_LOCAL_THREAD_LIMIT = 24;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      promise.finally(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
    })
  ]);
}

export interface ProjectLiveMonitorOptions {
  projectRoot: string;
  localLimit?: number;
  includeCloud?: boolean;
}

export class ProjectLiveMonitor extends EventEmitter {
  private readonly projectRoot: string;
  private readonly localLimit: number;
  private readonly includeCloud: boolean;
  private readonly threads = new Map<string, CodexThread>();
  private readonly threadWatchers = new Map<string, FSWatcher>();
  private readonly threadReadTimers = new Map<string, NodeJS.Timeout>();
  private readonly threadPaths = new Map<string, string>();
  private readonly notes = new Set<string>();
  private readonly roomConfigPath: string;
  private readonly pendingUserRequests = new Map<string, PendingUserRequest>();
  private readonly subscribedThreadIds = new Set<string>();
  private readonly ongoingThreadIds = new Set<string>();
  private readonly stoppedAtByThreadId = new Map<string, number>();
  private readonly hydratedThreadIds = new Set<string>();
  private readonly threadRemovalTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingNotLoadedStopTimers = new Map<string, NodeJS.Timeout>();
  private roomWatcher: FSWatcher | null = null;
  private snapshot: DashboardSnapshot | null = null;
  private cloudTasks: CloudTask[] = [];
  private client: CodexAppServerClient | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private cloudTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private recentEvents: DashboardEvent[] = [];
  private unsubscribeNotifications: (() => void) | null = null;
  private unsubscribeServerRequests: (() => void) | null = null;
  private subscriptionSyncPromise: Promise<void> | null = null;
  private subscriptionSyncQueued = false;

  constructor(options: ProjectLiveMonitorOptions) {
    super();
    this.projectRoot = options.projectRoot;
    this.localLimit = options.localLimit ?? DEFAULT_LOCAL_THREAD_LIMIT;
    this.includeCloud = options.includeCloud !== false;
    this.roomConfigPath = getRoomsFilePath(this.projectRoot);
  }

  getSnapshot(): DashboardSnapshot | null {
    return this.snapshot;
  }

  async start(): Promise<void> {
    await this.ensureClient();
    await this.discoverThreads();
    this.watchRoomsFile();
    this.discoveryTimer = setInterval(() => {
      void this.discoverThreads();
    }, DISCOVERY_INTERVAL_MS);

    if (this.includeCloud) {
      void this.refreshCloudTasks();
      this.cloudTimer = setInterval(() => {
        void this.refreshCloudTasks();
      }, CLOUD_REFRESH_INTERVAL_MS);
    }

    await this.rebuildSnapshot();
  }

  async refreshNow(): Promise<void> {
    if (this.includeCloud) {
      await this.refreshCloudTasks();
    }
    await this.discoverThreads();
    await this.rebuildSnapshot();
  }

  setSharedCloudTasks(tasks: CloudTask[], errorMessage: string | null): void {
    this.cloudTasks = filterProjectCloudTasks(tasks, this.projectRoot);
    this.setCloudErrorNote(errorMessage);
    this.scheduleSnapshot();
  }

  async stop(): Promise<void> {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }
    if (this.cloudTimer) {
      clearInterval(this.cloudTimer);
    }
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
    }
    if (this.roomWatcher) {
      this.roomWatcher.close();
    }
    unwatchFile(this.roomConfigPath);
    for (const timer of this.threadReadTimers.values()) {
      clearTimeout(timer);
    }
    this.threadReadTimers.clear();
    for (const timer of this.threadRemovalTimers.values()) {
      clearTimeout(timer);
    }
    this.threadRemovalTimers.clear();
    for (const timer of this.pendingNotLoadedStopTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingNotLoadedStopTimers.clear();
    for (const [threadId, watcher] of this.threadWatchers.entries()) {
      watcher.close();
      const path = this.threadPaths.get(threadId);
      if (path) {
        unwatchFile(path);
      }
    }
    this.threadWatchers.clear();
    this.threadPaths.clear();
    this.unsubscribeNotifications?.();
    this.unsubscribeNotifications = null;
    this.unsubscribeServerRequests?.();
    this.unsubscribeServerRequests = null;
    this.client?.close();
    this.client = null;
    this.ongoingThreadIds.clear();
    this.subscribedThreadIds.clear();
  }

  private async ensureClient(): Promise<void> {
    if (this.client) {
      return;
    }

    try {
      this.client = await CodexAppServerClient.create();
      this.unsubscribeNotifications?.();
      this.unsubscribeServerRequests?.();
      this.unsubscribeNotifications = this.client.onNotification((notification) => {
        this.handleAppServerNotification(notification);
      });
      this.unsubscribeServerRequests = this.client.onServerRequest((request) => {
        this.handleAppServerServerRequest(request);
      });
      this.clearMatchingNote("Local Codex app-server unavailable:");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Local Codex app-server unavailable: ${message}`);
    }
  }

  private addNote(note: string): void {
    this.notes.add(note);
  }

  private clearMatchingNote(prefix: string): void {
    for (const note of this.notes) {
      if (note.startsWith(prefix)) {
        this.notes.delete(note);
      }
    }
  }

  private setCloudErrorNote(errorMessage: string | null): void {
    this.clearMatchingNote(CLOUD_NOTE_LEGACY_PREFIX);
    this.clearMatchingNote(CLOUD_NOTE_PREFIX);
    if (!errorMessage) {
      return;
    }
    this.addNote(
      errorMessage.startsWith(CLOUD_NOTE_PREFIX)
        ? errorMessage
        : `${CLOUD_NOTE_LEGACY_PREFIX} ${errorMessage}`
    );
  }

  private async discoverThreads(): Promise<void> {
    await this.ensureClient();
    if (!this.client) {
      return;
    }

    try {
      const allThreads = await this.client.listThreads({
        limit: Math.max(this.localLimit * 4, 40)
      });
      const projectThreads = filterThreadsForProject(this.projectRoot, allThreads);
      const projectThreadsById = new Map(projectThreads.map((thread) => [thread.id, thread]));
      const trackedThreads = new Map(
        selectProjectThreadsWithParents(this.projectRoot, allThreads, this.localLimit)
          .map((thread) => [thread.id, thread])
      );
      const pendingAncestors = [...trackedThreads.values()];
      while (pendingAncestors.length > 0) {
        const thread = pendingAncestors.shift();
        if (!thread) {
          continue;
        }
        const parentThreadId = parentThreadIdForThread(thread);
        if (!parentThreadId || trackedThreads.has(parentThreadId)) {
          continue;
        }
        let parentThread = projectThreadsById.get(parentThreadId) ?? this.threads.get(parentThreadId) ?? null;
        if (!parentThread) {
          try {
            parentThread = await this.client.readThread(parentThreadId);
          } catch {
            parentThread = null;
          }
        }
        if (!parentThread) {
          continue;
        }
        projectThreadsById.set(parentThread.id, parentThread);
        trackedThreads.set(parentThread.id, parentThread);
        pendingAncestors.push(parentThread);
      }
      for (const threadId of Array.from(this.threads.keys())) {
        if (trackedThreads.has(threadId)) {
          continue;
        }
        const knownThread = projectThreadsById.get(threadId);
        if (knownThread) {
          trackedThreads.set(threadId, knownThread);
        }
      }
      this.clearMatchingNote("Local Codex app-server unavailable:");
      await Promise.all(
        [...trackedThreads.values()].map(async (listedThread) => {
          const known = this.threads.get(listedThread.id);
          if (!known || known.updatedAt !== listedThread.updatedAt || known.path !== listedThread.path) {
            await this.refreshThread(listedThread.id);
            return;
          }

          if (listedThread.status.type === "active") {
            this.markThreadLive(listedThread.id);
          }
          this.threads.set(listedThread.id, {
            ...known,
            status: listedThread.status,
            updatedAt: listedThread.updatedAt,
            path: listedThread.path ?? known.path
          });
          this.ensureThreadWatcher(listedThread.id, listedThread.path ?? known.path);
        })
      );

      for (const threadId of Array.from(this.threads.keys())) {
        if (!projectThreadsById.has(threadId)) {
          this.markThreadStopped(threadId);
        }
      }

      if (this.snapshot === null) {
        await this.syncThreadSubscriptions();
      } else {
        this.scheduleThreadSubscriptions();
      }
      this.scheduleSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Local Codex app-server unavailable: ${message}`);
      this.client?.close();
      this.client = null;
      this.subscribedThreadIds.clear();
      this.scheduleSnapshot();
    }
  }

  private scheduleThreadSubscriptions(): void {
    if (this.subscriptionSyncPromise) {
      this.subscriptionSyncQueued = true;
      return;
    }

    this.subscriptionSyncPromise = this.syncThreadSubscriptions()
      .catch(() => {
        /* notes are handled inside syncThreadSubscriptions */
      })
      .finally(() => {
        this.subscriptionSyncPromise = null;
        if (this.subscriptionSyncQueued) {
          this.subscriptionSyncQueued = false;
          this.scheduleThreadSubscriptions();
        }
      });
  }

  private async syncThreadSubscriptions(): Promise<void> {
    if (!this.client) {
      return;
    }

    this.clearMatchingNote("Live subscription sync degraded:");
    this.clearMatchingNote("Thread subscribe failed (");

    const now = Date.now();
    const candidates = [...this.threads.values()]
      .filter((thread) => (
        !this.stoppedAtByThreadId.has(thread.id)
        && (
        thread.status.type === "active"
        || (now - thread.updatedAt * 1000) <= ACTIVE_SUBSCRIPTION_WINDOW_MS
        )
      ))
      .sort((left, right) => {
        const leftActive = left.status.type === "active" ? 1 : 0;
        const rightActive = right.status.type === "active" ? 1 : 0;
        return rightActive - leftActive || right.updatedAt - left.updatedAt;
      })
      .slice(0, MAX_SUBSCRIBED_THREADS);

    const targetIds = new Set(candidates.map((thread) => thread.id));
    const loadedThreadIds = new Set(
      await withTimeout(
        this.client.listLoadedThreads().catch(() => []),
        APP_SERVER_SUBSCRIPTION_TIMEOUT_MS,
        "thread/loaded/list"
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.addNote(`Live subscription sync degraded: ${message}`);
        return [];
      })
    );

    await Promise.all(
      [...targetIds]
        .filter((candidateId) => !this.subscribedThreadIds.has(candidateId))
        .map(async (threadId) => {
          try {
            await withTimeout(
              this.client?.resumeThread(threadId) ?? Promise.reject(new Error("client unavailable")),
              APP_SERVER_SUBSCRIPTION_TIMEOUT_MS,
              `thread/resume ${threadId.slice(0, 8)}`
            );
            this.subscribedThreadIds.add(threadId);
            loadedThreadIds.add(threadId);
            await this.refreshThread(threadId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.addNote(`Thread subscribe failed (${threadId.slice(0, 8)}): ${message}`);
          }
        })
    );

    await Promise.all(
      [...this.subscribedThreadIds]
        .filter((candidateId) => !targetIds.has(candidateId))
        .map(async (threadId) => {
          try {
            await withTimeout(
              this.client?.unsubscribeThread(threadId) ?? Promise.reject(new Error("client unavailable")),
              APP_SERVER_SUBSCRIPTION_TIMEOUT_MS,
              `thread/unsubscribe ${threadId.slice(0, 8)}`
            );
          } catch {
            /* ignore unsubscribe failures */
          }
          this.subscribedThreadIds.delete(threadId);
        })
    );

    for (const threadId of [...this.subscribedThreadIds]) {
      if (!loadedThreadIds.has(threadId)) {
        this.scheduleThreadRefresh(threadId);
      }
    }

    this.scheduleSnapshot();
  }

  private scheduleThreadRefresh(threadId: string): void {
    const existing = this.threadReadTimers.get(threadId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.threadReadTimers.delete(threadId);
      void this.refreshThread(threadId);
    }, THREAD_READ_DEBOUNCE_MS);
    this.threadReadTimers.set(threadId, timer);
  }

  private ensureThreadWatcher(threadId: string, path: string | null): void {
    if (!path) {
      return;
    }

    const currentPath = this.threadPaths.get(threadId);
    if (currentPath === path) {
      return;
    }

    if (currentPath) {
      this.threadWatchers.get(threadId)?.close();
      unwatchFile(currentPath);
    }

    this.threadPaths.set(threadId, path);
    try {
      const watcher = watch(path, () => {
        this.scheduleThreadRefresh(threadId);
      });
      this.threadWatchers.set(threadId, watcher);
    } catch {
      /* ignore and rely on watchFile below */
    }

    watchFile(
      path,
      { interval: FILE_WATCH_INTERVAL_MS },
      () => {
        this.scheduleThreadRefresh(threadId);
      }
    );
  }

  private removeThread(threadId: string): void {
    this.threads.delete(threadId);
    const watcher = this.threadWatchers.get(threadId);
    watcher?.close();
    this.threadWatchers.delete(threadId);

    const timer = this.threadReadTimers.get(threadId);
    if (timer) {
      clearTimeout(timer);
      this.threadReadTimers.delete(threadId);
    }

    const path = this.threadPaths.get(threadId);
    if (path) {
      unwatchFile(path);
      this.threadPaths.delete(threadId);
    }

    for (const [requestId, request] of this.pendingUserRequests.entries()) {
      if (request.threadId === threadId) {
        this.pendingUserRequests.delete(requestId);
      }
    }
    const removalTimer = this.threadRemovalTimers.get(threadId);
    if (removalTimer) {
      clearTimeout(removalTimer);
      this.threadRemovalTimers.delete(threadId);
    }
    this.clearPendingNotLoadedStop(threadId);
    this.ongoingThreadIds.delete(threadId);
    this.stoppedAtByThreadId.delete(threadId);
    this.hydratedThreadIds.delete(threadId);
    this.subscribedThreadIds.delete(threadId);
  }

  private belongsToProject(message: AppServerNotification | AppServerServerRequest): boolean {
    const threadId = extractThreadId(message.params);
    if (threadId && this.threads.has(threadId)) {
      return true;
    }

    const projectPaths = [...collectPaths(message.params)];
    return projectPaths.some((path) => path === this.projectRoot || path.startsWith(`${this.projectRoot}/`));
  }

  private pushRecentEvent(event: DashboardEvent): void {
    const now = Date.now();
    const createdAtMs = Date.parse(event.createdAt);
    if (Number.isFinite(createdAtMs) && createdAtMs < now - RECENT_EVENT_RETENTION_MS) {
      return;
    }

    this.recentEvents.unshift(event);
    const seen = new Set<string>();
    this.recentEvents = this.recentEvents.filter((entry) => {
      const entryCreatedAtMs = Date.parse(entry.createdAt);
      if (Number.isFinite(entryCreatedAtMs) && entryCreatedAtMs < now - RECENT_EVENT_RETENTION_MS) {
        return false;
      }
      if (seen.has(entry.id)) {
        return false;
      }
      seen.add(entry.id);
      return true;
    }).slice(0, MAX_RECENT_EVENTS);
  }

  private handleAppServerNotification(notification: AppServerNotification): void {
    if (!this.belongsToProject(notification)) {
      return;
    }

    const threadId = extractThreadId(notification.params);
    if (threadId) {
      const knownThread = this.threads.get(threadId) ?? null;
      const wasOngoing =
        this.ongoingThreadIds.has(threadId)
        || (knownThread ? isOngoingThread(knownThread) : false);
      const status = notification.method === "thread/status/changed"
        ? asRecord(asRecord(notification.params)?.status)
        : null;
      const statusType = asString(status?.type);
      if (knownThread && notification.method === "thread/status/changed" && statusType) {
        const nextStatus =
          statusType === "active"
            ? {
              type: "active" as const,
              activeFlags: Array.isArray(status?.activeFlags)
                ? status.activeFlags.filter((flag): flag is string => typeof flag === "string")
                : knownThread.status.type === "active" ? knownThread.status.activeFlags : undefined
            }
            : statusType === "notLoaded" ? { type: "notLoaded" as const }
            : statusType === "idle" ? { type: "idle" as const }
            : statusType === "systemError" ? { type: "systemError" as const }
            : null;
        if (nextStatus) {
          this.threads.set(threadId, {
            ...knownThread,
            status: nextStatus
          });
        }
      }
      if (shouldMarkThreadLiveFromAppServerNotification(notification.method, statusType)) {
        this.markThreadLive(threadId);
      } else if (shouldMarkThreadStoppedFromAppServerNotification(notification.method, statusType)) {
        this.markThreadStopped(threadId);
      } else if (shouldStopDormantThreadAfterAppServerNotification({
          method: notification.method,
          statusType,
          wasOngoing
        })) {
        if (notification.method === "thread/status/changed" && statusType === "notLoaded") {
          this.schedulePendingNotLoadedStop(threadId);
        } else {
          this.markThreadStopped(threadId);
        }
      }
      if (
        notification.method === "thread/closed"
        || (notification.method === "thread/status/changed" && statusType === "notLoaded")
      ) {
        this.scheduleThreadSubscriptions();
      }
    }

    if (notification.method === "serverRequest/resolved") {
      const params = asRecord(notification.params) ?? {};
      const requestId = asString(params.requestId);
      const pendingRequest = requestId ? this.pendingUserRequests.get(requestId) ?? null : null;
      if (requestId) {
        this.pendingUserRequests.delete(requestId);
      }
      const event = buildDashboardEventFromAppServerMessage(
        { projectRoot: this.projectRoot, pendingRequest },
        notification
      );
      if (event) {
        this.pushRecentEvent(event);
      }
    } else {
      const event = buildDashboardEventFromAppServerMessage({ projectRoot: this.projectRoot }, notification);
      if (event) {
        this.pushRecentEvent(event);
      }
    }

    if (threadId) {
      this.scheduleThreadRefresh(threadId);
    } else {
      void this.discoverThreads();
    }
    this.scheduleSnapshot();
  }

  private handleAppServerServerRequest(request: AppServerServerRequest): void {
    if (!this.belongsToProject(request)) {
      return;
    }

    const needsUser = buildNeedsUserStateFromServerRequest(request);
    if (needsUser) {
      this.pendingUserRequests.set(needsUser.requestId, needsUser);
    }

    const event = buildDashboardEventFromAppServerMessage(
      { projectRoot: this.projectRoot, pendingRequest: needsUser },
      request
    );
    if (event) {
      this.pushRecentEvent(event);
    }

    const threadId = extractThreadId(request.params);
    if (threadId) {
      this.markThreadLive(threadId);
      this.scheduleThreadRefresh(threadId);
    } else {
      void this.discoverThreads();
    }
    this.scheduleSnapshot();
  }

  private async refreshThread(threadId: string): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const wasHydrated = this.hydratedThreadIds.has(threadId);
      const hasLiveSubscription = this.subscribedThreadIds.has(threadId);
      const previousThread = this.threads.get(threadId) ?? null;
      const thread = await this.client.readThread(threadId);
      this.clearMatchingNote(`Thread refresh failed (${threadId.slice(0, 8)}):`);
      this.threads.set(threadId, thread);
      if (isOngoingThread(thread)) {
        this.markThreadLive(threadId);
      } else if (previousThread && isOngoingThread(previousThread)) {
        const pendingNotLoadedStop =
          thread.status.type === "notLoaded" && this.pendingNotLoadedStopTimers.has(threadId);
        if (!pendingNotLoadedStop) {
          this.markThreadStopped(threadId);
        }
      }
      const previousMessage = previousThread ? latestThreadAgentMessage(previousThread) : null;
      const nextMessage = latestThreadAgentMessage(thread);
      if (
        wasHydrated
        && !hasLiveSubscription
        && nextMessage
        && (
          nextMessage.itemId !== previousMessage?.itemId
          || nextMessage.text !== previousMessage?.text
        )
      ) {
        const messageEvent = buildThreadReadAgentMessageEvent({ projectRoot: this.projectRoot }, thread);
        if (messageEvent && !hasEquivalentRecentMessageEvent(this.recentEvents, messageEvent)) {
          this.pushRecentEvent(messageEvent);
        }
      }
      this.ensureThreadWatcher(threadId, thread.path);
      const rolloutEvents = await readRecentRolloutHookEvents(this.projectRoot, threadId, thread.path, thread.updatedAt);
      for (const event of rolloutEvents) {
        this.pushRecentEvent(event);
      }
      this.hydratedThreadIds.add(threadId);
      this.scheduleSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Thread refresh failed (${threadId.slice(0, 8)}): ${message}`);
      this.scheduleSnapshot();
    }
  }

  private watchRoomsFile(): void {
    try {
      this.roomWatcher = watch(this.roomConfigPath, () => {
        this.scheduleSnapshot();
      });
    } catch {
      this.roomWatcher = null;
    }

    watchFile(
      this.roomConfigPath,
      { interval: FILE_WATCH_INTERVAL_MS },
      () => {
        this.scheduleSnapshot();
      }
    );
  }

  private async refreshCloudTasks(): Promise<void> {
    if (!this.includeCloud) {
      this.cloudTasks = [];
      return;
    }

    try {
      const listed = await listCloudTasks(10);
      this.cloudTasks = filterProjectCloudTasks(listed, this.projectRoot);
      this.setCloudErrorNote(null);
      this.scheduleSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setCloudErrorNote(message);
      this.scheduleSnapshot();
    }
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
    }

    this.snapshotTimer = setTimeout(() => {
      void this.rebuildSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  private async rebuildSnapshot(): Promise<void> {
    this.snapshotTimer = null;
    const needsUserByThreadId = new Map<string, NeedsUserState>();
    for (const pending of this.pendingUserRequests.values()) {
      needsUserByThreadId.set(pending.threadId, pending);
    }

    this.snapshot = await buildDashboardSnapshotFromState({
      projectRoot: this.projectRoot,
      threads: Array.from(this.threads.values()),
      cloudTasks: this.cloudTasks,
      events: this.recentEvents,
      notes: Array.from(this.notes),
      needsUserByThreadId,
      subscribedThreadIds: this.subscribedThreadIds,
      stoppedAtByThreadId: this.stoppedAtByThreadId,
      ongoingThreadIds: this.ongoingThreadIds
    });
    this.emit("snapshot", this.snapshot);
  }

  private markThreadLive(threadId: string): void {
    this.clearPendingNotLoadedStop(threadId);
    this.ongoingThreadIds.add(threadId);
    this.stoppedAtByThreadId.delete(threadId);
    const removalTimer = this.threadRemovalTimers.get(threadId);
    if (removalTimer) {
      clearTimeout(removalTimer);
      this.threadRemovalTimers.delete(threadId);
    }
  }

  private markThreadStopped(threadId: string): void {
    if (!this.threads.has(threadId)) {
      return;
    }
    if (this.stoppedAtByThreadId.has(threadId)) {
      return;
    }

    this.clearPendingNotLoadedStop(threadId);
    this.ongoingThreadIds.delete(threadId);
    this.stoppedAtByThreadId.set(threadId, Date.now());
    const removalTimer = this.threadRemovalTimers.get(threadId);
    if (removalTimer) {
      clearTimeout(removalTimer);
    }
    this.threadRemovalTimers.set(threadId, setTimeout(() => {
      this.threadRemovalTimers.delete(threadId);
      this.removeThread(threadId);
      this.scheduleSnapshot();
    }, RECENT_DONE_GRACE_MS + STOPPED_THREAD_REMOVAL_BUFFER_MS));
  }

  private clearPendingNotLoadedStop(threadId: string): void {
    const timer = this.pendingNotLoadedStopTimers.get(threadId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.pendingNotLoadedStopTimers.delete(threadId);
  }

  private schedulePendingNotLoadedStop(threadId: string): void {
    if (!this.threads.has(threadId)) {
      return;
    }
    this.clearPendingNotLoadedStop(threadId);
    const timer = setTimeout(() => {
      this.pendingNotLoadedStopTimers.delete(threadId);
      void this.confirmDormantNotLoadedThread(threadId);
    }, NOT_LOADED_STOP_DEBOUNCE_MS);
    this.pendingNotLoadedStopTimers.set(threadId, timer);
  }

  private async confirmDormantNotLoadedThread(threadId: string): Promise<void> {
    if (!this.threads.has(threadId)) {
      return;
    }

    await this.refreshThread(threadId);
    const thread = this.threads.get(threadId) ?? null;
    if (!thread || isOngoingThread(thread)) {
      return;
    }
    if (thread.status.type !== "notLoaded") {
      return;
    }

    this.markThreadStopped(threadId);
    this.scheduleSnapshot();
  }
}
