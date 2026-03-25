import { statSync } from "node:fs";
import { resolve } from "node:path";

import type { DashboardSnapshot } from "@codex-agents-office/core";

import type { FleetResponse, LanStatus, ProjectDescriptor, ServerMeta, ServerOptions } from "./server-types";

const SERVER_ENTRY = resolve(__dirname, "server.js");
const SERVER_STARTED_AT = new Date().toISOString();
const SERVER_BUILD_AT = statSync(SERVER_ENTRY).mtime.toISOString();

function createStartupSnapshot(project: ProjectDescriptor): DashboardSnapshot {
  const generatedAt = new Date().toISOString();
  return {
    projectRoot: project.root,
    projectLabel: project.label,
    projectIdentity: null,
    generatedAt,
    rooms: {
      version: 1,
      generated: true,
      filePath: "",
      rooms: []
    },
    agents: [],
    cloudTasks: [],
    events: [],
    notes: [`Project ${project.label} is starting up.`]
  };
}

export function buildFleetResponse(
  projects: ProjectDescriptor[],
  snapshotsByRoot: Map<string, DashboardSnapshot>
): FleetResponse {
  return {
    generatedAt: new Date().toISOString(),
    projects: projects.map((project) => {
      const snapshot = snapshotsByRoot.get(project.root);
      return snapshot ?? createStartupSnapshot(project);
    })
  };
}

export function buildServerMeta(
  options: ServerOptions,
  projects = options.projects,
  lan: LanStatus = {
    enabled: options.lan.enabled,
    peerId: null,
    discoveryPort: options.lan.enabled ? options.lan.discoveryPort : null,
    peers: []
  }
): ServerMeta {
  return {
    pid: process.pid,
    startedAt: SERVER_STARTED_AT,
    buildAt: SERVER_BUILD_AT,
    entry: SERVER_ENTRY,
    host: options.host,
    port: options.port,
    explicitProjects: options.explicitProjects,
    projects,
    lan
  };
}
