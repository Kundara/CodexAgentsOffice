import type { DashboardSnapshot } from "@codex-agents-office/core";

export interface ProjectDescriptor {
  root: string;
  label: string;
}

export interface FleetResponse {
  generatedAt: string;
  projects: DashboardSnapshot[];
}

export interface LanOptions {
  enabled: boolean;
  discoveryPort: number;
  key: string | null;
}

export interface LanPeerDescriptor {
  id: string;
  label: string;
  addresses: string[];
  port: number;
  seenAt: string;
}

export interface LanStatus {
  enabled: boolean;
  peerId: string | null;
  discoveryPort: number | null;
  peers: LanPeerDescriptor[];
}

export interface ServerOptions {
  host: string;
  port: number;
  projects: ProjectDescriptor[];
  explicitProjects: boolean;
  lan: LanOptions;
}

export interface ServerMeta {
  pid: number;
  startedAt: string;
  buildAt: string;
  entry: string;
  host: string;
  port: number;
  explicitProjects: boolean;
  projects: ProjectDescriptor[];
  lan: LanStatus;
}
