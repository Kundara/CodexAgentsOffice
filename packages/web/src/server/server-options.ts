import { basename, resolve } from "node:path";
import { cwd, env } from "node:process";

import { humanizeProjectLabel } from "@codex-agents-office/core";

import type { ProjectDescriptor, ServerOptions } from "./server-types";

export function buildProjectDescriptors(projectRoots: string[]): ProjectDescriptor[] {
  const baseLabels = projectRoots.map((projectRoot) => humanizeProjectLabel(basename(projectRoot) || projectRoot));
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

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
      index += 1;
      continue;
    }

    if (!arg.startsWith("--")) {
      projects.push(resolve(arg));
    }
  }

  const explicitProjects = projects.length > 0;
  const uniqueProjects = Array.from(new Set(projects.length > 0 ? projects : [cwd()]));
  return {
    host,
    port: Number.isFinite(port) ? port : 4181,
    projects: buildProjectDescriptors(uniqueProjects),
    explicitProjects
  };
}
