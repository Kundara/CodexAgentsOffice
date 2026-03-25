import { basename, resolve } from "node:path";
import { cwd, env } from "node:process";

import type { ProjectDescriptor, ServerOptions } from "./server-types";

const DEFAULT_LAN_DISCOVERY_PORT = 41819;

export function buildProjectDescriptors(projectRoots: string[]): ProjectDescriptor[] {
  const baseLabels = projectRoots.map((projectRoot) => basename(projectRoot) || projectRoot);
  const counts = new Map<string, number>();
  const used = new Map<string, number>();

  for (const label of baseLabels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return projectRoots.map((projectRoot, index) => {
    const baseLabel = baseLabels[index];
    if ((counts.get(baseLabel) ?? 0) === 1) {
      return { root: projectRoot, label: baseLabel };
    }

    const nextIndex = (used.get(baseLabel) ?? 0) + 1;
    used.set(baseLabel, nextIndex);
    return {
      root: projectRoot,
      label: `${baseLabel} ${nextIndex}`
    };
  });
}

export function parseArgs(argv: string[]): ServerOptions {
  const projects: string[] = [];
  let port = Number.parseInt(env.CODEX_AGENTS_OFFICE_PORT ?? "4181", 10);
  let host = env.CODEX_AGENTS_OFFICE_HOST ?? "127.0.0.1";
  let lanEnabled = /^(1|true|yes|on)$/i.test(env.CODEX_AGENTS_OFFICE_LAN ?? "");
  let lanDiscoveryPort = Number.parseInt(env.CODEX_AGENTS_OFFICE_LAN_PORT ?? `${DEFAULT_LAN_DISCOVERY_PORT}`, 10);
  let lanKey = env.CODEX_AGENTS_OFFICE_LAN_KEY?.trim() || null;
  let hostExplicit = typeof env.CODEX_AGENTS_OFFICE_HOST === "string" && env.CODEX_AGENTS_OFFICE_HOST.trim().length > 0;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--lan") {
      lanEnabled = true;
      continue;
    }

    if (arg === "--lan-port" && argv[index + 1]) {
      lanDiscoveryPort = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (arg === "--lan-key" && argv[index + 1]) {
      lanKey = argv[index + 1].trim() || null;
      index += 1;
      continue;
    }

    if (arg === "--project" && argv[index + 1]) {
      projects.push(resolve(argv[index + 1]));
      index += 1;
      continue;
    }

    if (arg === "--port" && argv[index + 1]) {
      port = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (arg === "--host" && argv[index + 1]) {
      host = argv[index + 1];
      hostExplicit = true;
      index += 1;
      continue;
    }

    if (!arg.startsWith("--")) {
      projects.push(resolve(arg));
    }
  }

  if (lanEnabled && !hostExplicit && host === "127.0.0.1") {
    host = "0.0.0.0";
  }

  const explicitProjects = projects.length > 0;
  const uniqueProjects = Array.from(new Set(projects.length > 0 ? projects : [cwd()]));
  return {
    host,
    port: Number.isFinite(port) ? port : 4181,
    projects: buildProjectDescriptors(uniqueProjects),
    explicitProjects,
    lan: {
      enabled: lanEnabled,
      discoveryPort: Number.isFinite(lanDiscoveryPort) ? lanDiscoveryPort : DEFAULT_LAN_DISCOVERY_PORT,
      key: lanKey
    }
  };
}
