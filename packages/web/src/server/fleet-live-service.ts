import type { ServerResponse } from "node:http";

import {
  canonicalizeProjectPath,
  cycleAgentAppearance,
  describeCursorIntegrationSettings,
  discoverProjects,
  listCloudTasks,
  ProjectLiveMonitor,
  scaffoldRoomsFile,
  setStoredCursorApiKey
} from "@codex-agents-office/core";
import type { CloudTask } from "@codex-agents-office/core";

import { buildFleetResponse } from "./server-metadata";
import { buildProjectDescriptors } from "./server-options";
import type { FleetResponse, IntegrationSettingsResponse, MultiplayerStatus, ProjectDescriptor } from "./server-types";

export class FleetLiveService {
  private static readonly PROJECT_SET_REFRESH_INTERVAL_MS = 4000;
  private static readonly CLOUD_REFRESH_INTERVAL_MS = 30000;
  private static readonly CLOUD_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
  private readonly monitors = new Map<string, ProjectLiveMonitor>();
  private readonly clients = new Set<ServerResponse>();
  private projects: ProjectDescriptor[] = [];
  private fleet: FleetResponse | null = null;
  private lastProjectSetRefreshAt = 0;
  private sharedCloudTasks: CloudTask[] = [];
  private sharedCloudErrorMessage: string | null = null;
  private cloudTimer: NodeJS.Timeout | null = null;
  private cloudBackoffUntil = 0;

  constructor(
    private readonly seedProjects: ProjectDescriptor[],
    private readonly explicitProjects: boolean
  ) {}

  async start(): Promise<void> {
    this.projects = [...this.seedProjects];
    this.fleet = buildFleetResponse(this.projects, new Map());
    this.cloudTimer = setInterval(() => {
      void this.refreshSharedCloudTasks();
    }, FleetLiveService.CLOUD_REFRESH_INTERVAL_MS);
    await this.ensureProjectSet(true);
    await this.refreshSharedCloudTasks();
    await this.publish();
  }

  async stop(): Promise<void> {
    if (this.cloudTimer) {
      clearInterval(this.cloudTimer);
      this.cloudTimer = null;
    }
    for (const monitor of this.monitors.values()) {
      await monitor.stop();
    }
    this.monitors.clear();
    for (const response of this.clients) {
      response.end();
    }
    this.clients.clear();
  }

  async getFleet(): Promise<FleetResponse> {
    if (!this.fleet) {
      await this.publish(true);
    }
    return this.fleet ?? buildFleetResponse(this.projects, new Map());
  }

  getMultiplayerStatus(): MultiplayerStatus {
    return {
      enabled: false,
      transport: null,
      secure: false,
      peerCount: 0,
      note: "Multiplayer transport not configured."
    };
  }

  async getProjects(): Promise<ProjectDescriptor[]> {
    await this.ensureProjectSet();
    return [...this.projects];
  }

  async refreshAll(): Promise<FleetResponse> {
    await this.ensureProjectSet(true);
    await this.refreshSharedCloudTasks();
    await Promise.all(Array.from(this.monitors.values()).map((monitor) => monitor.refreshNow()));
    await this.publish();
    return this.getFleet();
  }

  async cycleAppearance(projectRoot: string, agentId: string): Promise<void> {
    await cycleAgentAppearance(projectRoot, agentId);
    await this.monitors.get(projectRoot)?.refreshNow();
    await this.publish();
  }

  async scaffoldRooms(projectRoot: string): Promise<string> {
    const filePath = await scaffoldRoomsFile(projectRoot);
    await this.monitors.get(projectRoot)?.refreshNow();
    await this.publish();
    return filePath;
  }

  getIntegrationSettings(): IntegrationSettingsResponse {
    return {
      cursor: describeCursorIntegrationSettings()
    };
  }

  async setCursorApiKey(apiKey: string | null): Promise<IntegrationSettingsResponse> {
    await setStoredCursorApiKey(apiKey);
    await Promise.all(Array.from(this.monitors.values()).map((monitor) => monitor.refreshNow()));
    await this.publish();
    return this.getIntegrationSettings();
  }

  registerSse(response: ServerResponse): void {
    const heartbeat = setInterval(() => {
      response.write(": ping\n\n");
    }, 15000);

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    response.write(": connected\n\n");
    this.clients.add(response);

    if (this.fleet) {
      response.write(`event: fleet\ndata: ${JSON.stringify(this.fleet)}\n\n`);
    }

    response.on("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(response);
    });
  }

  private async publish(forceProjectRefresh = false): Promise<void> {
    await this.ensureProjectSet(forceProjectRefresh);
    const snapshotsByRoot = new Map();
    for (const project of this.projects) {
      const snapshot = this.monitors.get(project.root)?.getSnapshot();
      if (snapshot) {
        snapshotsByRoot.set(project.root, snapshot);
      }
    }

    this.fleet = buildFleetResponse(this.projects, snapshotsByRoot);

    for (const response of this.clients) {
      response.write(`event: fleet\ndata: ${JSON.stringify(this.fleet)}\n\n`);
    }
  }

  private async ensureProjectSet(force = false): Promise<void> {
    const stale = Date.now() - this.lastProjectSetRefreshAt >= FleetLiveService.PROJECT_SET_REFRESH_INTERVAL_MS;
    if (!force && this.projects.length > 0 && !stale) {
      return;
    }
    await this.refreshProjectSet();
  }

  private async refreshProjectSet(): Promise<void> {
    const discoveredProjects: ProjectDescriptor[] = this.explicitProjects
      ? []
      : await discoverProjects(10).catch(() => []);
    const normalizedSeeds = this.seedProjects
      .map((project) => {
        const root = canonicalizeProjectPath(project.root);
        return root ? { root, label: project.label } : null;
      })
      .filter((project): project is ProjectDescriptor => Boolean(project));

    const nextProjectRoots = this.explicitProjects
      ? normalizedSeeds.map((project) => project.root)
      : (
        discoveredProjects.length > 0
          ? discoveredProjects.map((project) => project.root)
          : normalizedSeeds.map((project) => project.root)
      );
    const nextProjects = buildProjectDescriptors(nextProjectRoots);
    const nextRoots = new Set(nextProjects.map((project) => project.root));

    const newMonitors: ProjectLiveMonitor[] = [];

    for (const project of nextProjects) {
      if (this.monitors.has(project.root)) {
        continue;
      }

      const monitor = new ProjectLiveMonitor({
        projectRoot: project.root,
        includeCloud: false
      });
      monitor.on("snapshot", () => {
        void this.publish();
      });
      monitor.setSharedCloudTasks(this.sharedCloudTasks, this.sharedCloudErrorMessage);
      this.monitors.set(project.root, monitor);
      newMonitors.push(monitor);
    }

    await Promise.all(newMonitors.map((monitor) => monitor.start()));

    for (const [projectRoot, monitor] of Array.from(this.monitors.entries())) {
      if (nextRoots.has(projectRoot)) {
        continue;
      }
      await monitor.stop();
      this.monitors.delete(projectRoot);
    }

    this.projects = nextProjects;
    this.lastProjectSetRefreshAt = Date.now();
  }

  private async refreshSharedCloudTasks(): Promise<void> {
    if (Date.now() < this.cloudBackoffUntil) {
      this.applySharedCloudTasksToMonitors();
      return;
    }

    try {
      this.sharedCloudTasks = await listCloudTasks(10);
      this.sharedCloudErrorMessage = null;
      this.cloudBackoffUntil = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sharedCloudTasks = [];
      const rateLimited = /429|rate limit/i.test(message);
      if (rateLimited) {
        this.cloudBackoffUntil = Date.now() + FleetLiveService.CLOUD_RATE_LIMIT_BACKOFF_MS;
        this.sharedCloudErrorMessage = "Codex cloud temporarily rate-limited; retrying in 5 minutes.";
      } else {
        this.sharedCloudErrorMessage = message;
      }
    }

    this.applySharedCloudTasksToMonitors();
  }

  private applySharedCloudTasksToMonitors(): void {
    let emittedSharedError = false;
    for (const monitor of this.monitors.values()) {
      const errorMessage: string | null = this.sharedCloudErrorMessage && !emittedSharedError
        ? this.sharedCloudErrorMessage
        : null;
      monitor.setSharedCloudTasks(this.sharedCloudTasks, errorMessage);
      emittedSharedError = emittedSharedError || Boolean(errorMessage);
    }
  }
}
