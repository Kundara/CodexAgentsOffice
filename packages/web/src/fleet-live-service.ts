import type { ServerResponse } from "node:http";
import { hostname } from "node:os";

import {
  canonicalizeProjectPath,
  cycleAgentAppearance,
  discoverProjects,
  findRoomForPaths,
  listCloudTasks,
  ProjectLiveMonitor,
  scaffoldRoomsFile
} from "@codex-agents-office/core";
import type { CloudTask, DashboardAgent, DashboardEvent, DashboardSnapshot } from "@codex-agents-office/core";

import { buildFleetResponse } from "./server-metadata";
import { LanPeerService } from "./lan-peer-service";
import { buildProjectDescriptors } from "./server-options";
import type { FleetResponse, LanPeerDescriptor, LanStatus, ProjectDescriptor } from "./server-types";

function prefixedRemoteId(peerId: string, value: string | null | undefined): string | null {
  return value ? `lan:${peerId}:${value}` : null;
}

function remapPath(remoteProjectRoot: string, localProjectRoot: string, value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const normalizedValue = canonicalizeProjectPath(value);
  const normalizedRemoteRoot = canonicalizeProjectPath(remoteProjectRoot);
  const normalizedLocalRoot = canonicalizeProjectPath(localProjectRoot);
  if (!normalizedValue || !normalizedRemoteRoot || !normalizedLocalRoot) {
    return value;
  }
  if (normalizedValue === normalizedRemoteRoot) {
    return normalizedLocalRoot;
  }
  if (normalizedValue.startsWith(`${normalizedRemoteRoot}/`)) {
    return `${normalizedLocalRoot}${normalizedValue.slice(normalizedRemoteRoot.length)}`;
  }
  return value;
}

function remapPaths(remoteProjectRoot: string, localProjectRoot: string, paths: string[]): string[] {
  return Array.from(new Set(paths
    .map((path) => remapPath(remoteProjectRoot, localProjectRoot, path))
    .filter((path): path is string => typeof path === "string" && path.length > 0)));
}

function optionalString(value: string | null): string | undefined {
  return value ?? undefined;
}

function mergeLanAgent(
  localSnapshot: DashboardSnapshot,
  remoteSnapshot: DashboardSnapshot,
  agent: DashboardAgent,
  peer: LanPeerDescriptor
): DashboardAgent | null {
  if (agent.source === "cloud") {
    return null;
  }

  const cwd = remapPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.cwd);
  const paths = remapPaths(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.paths);
  return {
    ...agent,
    id: prefixedRemoteId(peer.id, agent.id) ?? agent.id,
    parentThreadId: prefixedRemoteId(peer.id, agent.parentThreadId),
    threadId: prefixedRemoteId(peer.id, agent.threadId),
    taskId: prefixedRemoteId(peer.id, agent.taskId),
    resumeCommand: null,
    cwd,
    paths,
    roomId: findRoomForPaths(localSnapshot.rooms, localSnapshot.projectRoot, paths.length > 0 ? paths : cwd ? [cwd] : []),
    activityEvent: agent.activityEvent
      ? {
        ...agent.activityEvent,
        path: remapPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.activityEvent.path)
      }
      : null,
    needsUser: agent.needsUser
      ? {
        ...agent.needsUser,
        cwd: optionalString(remapPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.needsUser.cwd)),
        grantRoot: optionalString(remapPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.needsUser.grantRoot))
      }
      : null,
    network: {
      transport: "lan",
      peerId: peer.id,
      peerLabel: peer.label,
      peerHost: peer.addresses[0] ?? null
    }
  };
}

function mergeLanEvent(
  localSnapshot: DashboardSnapshot,
  remoteSnapshot: DashboardSnapshot,
  event: DashboardEvent,
  peer: LanPeerDescriptor
): DashboardEvent {
  return {
    ...event,
    id: prefixedRemoteId(peer.id, event.id) ?? event.id,
    threadId: prefixedRemoteId(peer.id, event.threadId),
    path: remapPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, event.path),
    cwd: optionalString(remapPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, event.cwd)),
    grantRoot: optionalString(remapPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, event.grantRoot))
  };
}

function mergeLanSnapshot(
  localSnapshot: DashboardSnapshot,
  remoteSnapshot: DashboardSnapshot,
  peer: LanPeerDescriptor
): DashboardSnapshot {
  const remoteAgents = remoteSnapshot.agents
    .map((agent) => mergeLanAgent(localSnapshot, remoteSnapshot, agent, peer))
    .filter((agent): agent is DashboardAgent => Boolean(agent));
  const remoteEvents = remoteSnapshot.events.map((event) => mergeLanEvent(localSnapshot, remoteSnapshot, event, peer));
  const liveAgents = remoteAgents.filter((agent) => agent.isCurrent).length;
  const lanNote = `LAN ${peer.label}${peer.addresses[0] ? ` @ ${peer.addresses[0]}` : ""} · ${liveAgents} live agent${liveAgents === 1 ? "" : "s"}`;

  return {
    ...localSnapshot,
    agents: [...localSnapshot.agents, ...remoteAgents],
    events: [...localSnapshot.events, ...remoteEvents].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    notes: localSnapshot.notes.includes(lanNote) ? localSnapshot.notes : [...localSnapshot.notes, lanNote]
  };
}

export class FleetLiveService {
  private static readonly PROJECT_SET_REFRESH_INTERVAL_MS = 4000;
  private static readonly CLOUD_REFRESH_INTERVAL_MS = 30000;
  private static readonly CLOUD_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
  private static readonly LAN_REFRESH_INTERVAL_MS = 5000;
  private readonly monitors = new Map<string, ProjectLiveMonitor>();
  private readonly clients = new Set<ServerResponse>();
  private readonly lanService: LanPeerService | null;
  private projects: ProjectDescriptor[] = [];
  private fleet: FleetResponse | null = null;
  private lastProjectSetRefreshAt = 0;
  private sharedCloudTasks: CloudTask[] = [];
  private sharedCloudErrorMessage: string | null = null;
  private remotePeerFleets = new Map<string, { peer: LanPeerDescriptor; fleet: FleetResponse }>();
  private cloudTimer: NodeJS.Timeout | null = null;
  private lanTimer: NodeJS.Timeout | null = null;
  private cloudBackoffUntil = 0;

  constructor(
    private readonly seedProjects: ProjectDescriptor[],
    private readonly explicitProjects: boolean,
    host: string,
    port: number,
    lanOptions: { enabled: boolean; discoveryPort: number; key: string | null; }
  ) {
    this.lanService = lanOptions.enabled
      ? new LanPeerService(lanOptions, host, port, hostname())
      : null;
  }

  async start(): Promise<void> {
    await this.ensureProjectSet(true);
    await this.refreshSharedCloudTasks();
    await this.lanService?.start();
    this.cloudTimer = setInterval(() => {
      void this.refreshSharedCloudTasks();
    }, FleetLiveService.CLOUD_REFRESH_INTERVAL_MS);
    if (this.lanService) {
      await this.refreshLanPeers();
      this.lanTimer = setInterval(() => {
        void this.refreshLanPeers();
      }, FleetLiveService.LAN_REFRESH_INTERVAL_MS);
    }
    await this.publish();
  }

  async stop(): Promise<void> {
    if (this.cloudTimer) {
      clearInterval(this.cloudTimer);
      this.cloudTimer = null;
    }
    if (this.lanTimer) {
      clearInterval(this.lanTimer);
      this.lanTimer = null;
    }
    await this.lanService?.stop();
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

  async getLanExportFleet(): Promise<FleetResponse> {
    await this.ensureProjectSet();
    return buildFleetResponse(this.projects, this.collectLocalSnapshots());
  }

  getLanStatus(): LanStatus {
    return {
      enabled: Boolean(this.lanService?.enabled),
      peerId: this.lanService?.id ?? null,
      discoveryPort: this.lanService?.discoveryPort ?? null,
      peers: this.lanService?.getPeers() ?? []
    };
  }

  async getProjects(): Promise<ProjectDescriptor[]> {
    await this.ensureProjectSet();
    return [...this.projects];
  }

  async refreshAll(): Promise<FleetResponse> {
    await this.ensureProjectSet(true);
    await this.refreshSharedCloudTasks();
    await this.refreshLanPeers();
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
    this.fleet = this.buildFederatedFleet(this.collectLocalSnapshots());

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

  private async refreshLanPeers(): Promise<void> {
    if (!this.lanService) {
      return;
    }

    const results = await this.lanService.fetchPeerFleets();
    const next = new Map<string, { peer: LanPeerDescriptor; fleet: FleetResponse }>();
    for (const result of results) {
      next.set(result.peer.id, result);
    }
    this.remotePeerFleets = next;
    await this.publish();
  }

  private collectLocalSnapshots(): Map<string, DashboardSnapshot> {
    const snapshotsByRoot = new Map<string, DashboardSnapshot>();
    for (const project of this.projects) {
      const snapshot = this.monitors.get(project.root)?.getSnapshot();
      if (snapshot) {
        snapshotsByRoot.set(project.root, snapshot);
      }
    }
    return snapshotsByRoot;
  }

  private buildFederatedFleet(localSnapshotsByRoot: Map<string, DashboardSnapshot>): FleetResponse {
    if (this.remotePeerFleets.size === 0) {
      return buildFleetResponse(this.projects, localSnapshotsByRoot);
    }

    const mergedSnapshots = new Map(localSnapshotsByRoot);
    const localIdentityToRoot = new Map<string, string>();
    for (const [projectRoot, snapshot] of mergedSnapshots.entries()) {
      if (snapshot.projectIdentity?.key) {
        localIdentityToRoot.set(snapshot.projectIdentity.key, projectRoot);
      }
    }

    for (const { peer, fleet } of this.remotePeerFleets.values()) {
      for (const remoteSnapshot of fleet.projects) {
        const identityKey = remoteSnapshot.projectIdentity?.key;
        if (!identityKey) {
          continue;
        }
        const localRoot = localIdentityToRoot.get(identityKey);
        if (!localRoot) {
          continue;
        }
        const localSnapshot = mergedSnapshots.get(localRoot);
        if (!localSnapshot) {
          continue;
        }
        mergedSnapshots.set(localRoot, mergeLanSnapshot(localSnapshot, remoteSnapshot, peer));
      }
    }

    return buildFleetResponse(this.projects, mergedSnapshots);
  }
}
