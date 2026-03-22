import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { cwd, env } from "node:process";
import { basename, extname, normalize, resolve } from "node:path";

import {
  canonicalizeProjectPath,
  cycleAgentAppearance,
  discoverCodexProjects,
  ProjectLiveMonitor,
  scaffoldRoomsFile,
  type DashboardSnapshot
} from "@codex-agents-office/core";

interface ProjectDescriptor {
  root: string;
  label: string;
}

interface FleetResponse {
  generatedAt: string;
  projects: DashboardSnapshot[];
}

interface ServerOptions {
  host: string;
  port: number;
  projects: ProjectDescriptor[];
}

const WEB_PUBLIC_DIR = resolve(__dirname, "../public");

const PIXEL_OFFICE_MANIFEST = {
  sheetUrl: "/assets/pixel-office/PixelOfficeAssets.png",
  sheetSize: { width: 256, height: 160 },
  avatars: [
    { id: "nova", x: 0, y: 80, w: 16, h: 32 },
    { id: "lex", x: 16, y: 80, w: 16, h: 32 },
    { id: "mira", x: 32, y: 80, w: 16, h: 32 },
    { id: "atlas", x: 0, y: 112, w: 16, h: 32 },
    { id: "echo", x: 16, y: 112, w: 16, h: 32 },
    { id: "pico", x: 32, y: 112, w: 16, h: 32 }
  ],
  chairs: [
    { x: 6, y: 41, w: 11, h: 22 },
    { x: 19, y: 41, w: 11, h: 22 },
    { x: 32, y: 41, w: 11, h: 22 },
    { x: 45, y: 41, w: 11, h: 22 },
    { x: 58, y: 41, w: 11, h: 22 },
    { x: 71, y: 41, w: 11, h: 22 }
  ],
  props: {
    sky: { x: 0, y: 0, w: 256, h: 38 },
    floorStrip: { x: 3, y: 68, w: 73, h: 24 },
    counter: { x: 171, y: 44, w: 79, h: 17 },
    deskWide: { x: 115, y: 47, w: 40, h: 16 },
    deskSmall: { x: 85, y: 47, w: 26, h: 16 },
    cabinet: { x: 84, y: 70, w: 26, h: 20 },
    cubicleWall: { x: 171, y: 44, w: 79, h: 17 },
    cubiclePanelLeft: { x: 188, y: 63, w: 17, h: 19 },
    cubiclePanelRight: { x: 213, y: 63, w: 17, h: 19 },
    cubiclePost: { x: 207, y: 63, w: 4, h: 27 },
    windowLeft: { x: 59, y: 96, w: 26, h: 21 },
    windowRight: { x: 88, y: 96, w: 26, h: 21 },
    boothDoor: { x: 98, y: 120, w: 16, h: 31 },
    sofaGray: { x: 119, y: 66, w: 33, h: 15 },
    sofaBlue: { x: 120, y: 83, w: 33, h: 16 },
    sofaGreen: { x: 120, y: 102, w: 33, h: 16 },
    sofaOrange: { x: 120, y: 121, w: 33, h: 16 },
    vending: { x: 159, y: 123, w: 24, h: 34 },
    bookshelf: { x: 184, y: 126, w: 24, h: 31 },
    plant: { x: 170, y: 65, w: 14, h: 19 },
    calendar: { x: 234, y: 81, w: 17, h: 11 },
    workstation: { x: 233, y: 106, w: 15, h: 19 },
    cooler: { x: 147, y: 140, w: 9, h: 17 },
    tower: { x: 240, y: 128, w: 6, h: 19 },
    clock: { x: 159, y: 108, w: 19, h: 6 },
    mug: { x: 159, y: 91, w: 7, h: 11 },
    artWarm: { x: 179, y: 94, w: 12, h: 9 },
    artUk: { x: 193, y: 94, w: 12, h: 9 },
    artUs: { x: 207, y: 94, w: 12, h: 9 },
    filePurple: { x: 211, y: 119, w: 11, h: 8 },
    fileBlue: { x: 211, y: 129, w: 11, h: 8 },
    fileGreen: { x: 211, y: 140, w: 11, h: 8 },
    badge: { x: 200, y: 107, w: 9, h: 9 },
    paper: { x: 239, y: 94, w: 11, h: 8 },
    socket: { x: 211, y: 151, w: 10, h: 6 },
    catBlack: { x: 65, y: 129, w: 13, h: 13 },
    catSleep: { x: 59, y: 146, w: 24, h: 11 }
  }
} as const;

function contentTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ase":
    case ".aseprite":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

async function sendStaticAsset(response: ServerResponse, assetPath: string, method: string): Promise<void> {
  const normalizedAssetPath = normalize(assetPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(WEB_PUBLIC_DIR, normalizedAssetPath);
  if (!filePath.startsWith(WEB_PUBLIC_DIR)) {
    notFound(response);
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypeForPath(filePath),
      "cache-control": "public, max-age=3600"
    });
    if (method === "HEAD") {
      response.end();
      return;
    }
    response.end(body);
  } catch {
    notFound(response);
  }
}

function buildProjectDescriptors(projectRoots: string[]): ProjectDescriptor[] {
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

function parseArgs(argv: string[]): ServerOptions {
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

  const uniqueProjects = Array.from(new Set(projects.length > 0 ? projects : [cwd()]));
  return {
    host,
    port: Number.isFinite(port) ? port : 4181,
    projects: buildProjectDescriptors(uniqueProjects)
  };
}

function buildFleetResponse(
  projects: ProjectDescriptor[],
  snapshotsByRoot: Map<string, DashboardSnapshot>
): FleetResponse {
  return {
    generatedAt: new Date().toISOString(),
    projects: projects.map((project) => snapshotsByRoot.get(project.root) ?? {
      projectRoot: project.root,
      generatedAt: new Date().toISOString(),
      rooms: {
        version: 1,
        generated: true,
        filePath: "",
        rooms: []
      },
      agents: [],
      cloudTasks: [],
      notes: [`Project ${project.label} is starting up.`]
    })
  };
}

class FleetLiveService {
  private readonly monitors = new Map<string, ProjectLiveMonitor>();
  private readonly clients = new Set<ServerResponse>();
  private projects: ProjectDescriptor[] = [];
  private fleet: FleetResponse | null = null;

  constructor(private readonly seedProjects: ProjectDescriptor[]) {}

  async start(): Promise<void> {
    await this.refreshProjectSet();
    await this.publish();
  }

  async stop(): Promise<void> {
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
      await this.publish();
    }
    return this.fleet ?? buildFleetResponse(this.projects, new Map());
  }

  async refreshAll(): Promise<FleetResponse> {
    await this.refreshProjectSet();
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

  private async publish(): Promise<void> {
    await this.refreshProjectSet();
    const snapshotsByRoot = new Map<string, DashboardSnapshot>();
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

  private async refreshProjectSet(): Promise<void> {
    const discoveredProjects = await discoverCodexProjects(50).catch(() => []);
    const normalizedSeeds = this.seedProjects
      .map((project) => {
        const root = canonicalizeProjectPath(project.root);
        return root ? { root, label: project.label } : null;
      })
      .filter((project): project is ProjectDescriptor => Boolean(project));

    const nextProjects = buildProjectDescriptors(
      discoveredProjects.length > 0
        ? discoveredProjects.map((project) => project.root)
        : normalizedSeeds.map((project) => project.root)
    );

    const nextRoots = new Set(nextProjects.map((project) => project.root));

    for (const project of nextProjects) {
      if (this.monitors.has(project.root)) {
        continue;
      }

      const monitor = new ProjectLiveMonitor({
        projectRoot: project.root,
        includeCloud: true
      });
      monitor.on("snapshot", () => {
        void this.publish();
      });
      this.monitors.set(project.root, monitor);
      await monitor.start();
    }

    for (const [projectRoot, monitor] of Array.from(this.monitors.entries())) {
      if (nextRoots.has(projectRoot)) {
        continue;
      }
      await monitor.stop();
      this.monitors.delete(projectRoot);
    }

    this.projects = nextProjects;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

function notFound(response: ServerResponse): void {
  response.writeHead(404, {
    "content-type": "text/plain; charset=utf-8"
  });
  response.end("Not found");
}

function renderHtml(options: ServerOptions): string {
  const projectsJson = JSON.stringify(options.projects);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Codex Agents Office</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b100f;
        --bg-soft: #111917;
        --panel: rgba(18, 28, 24, 0.94);
        --panel-strong: rgba(24, 38, 32, 0.98);
        --border: #29453b;
        --border-bright: #4a7b69;
        --text: #f2ead7;
        --muted: #a7bbb1;
        --accent: #4bd69f;
        --accent-2: #f5b74f;
        --danger: #f06d5e;
        --tile: 24px;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        color: var(--text);
        font-family: "IBM Plex Mono", "Cascadia Code", monospace;
        background:
          radial-gradient(circle at 20% 0%, rgba(75, 214, 159, 0.16), transparent 24%),
          radial-gradient(circle at 80% 0%, rgba(245, 183, 79, 0.1), transparent 18%),
          linear-gradient(180deg, #08100e 0%, #101816 100%);
      }

      button, select {
        font: inherit;
        color: var(--text);
        background: var(--panel-strong);
        border: 1px solid var(--border);
        padding: 8px 10px;
      }

      button:hover, select:hover {
        border-color: var(--border-bright);
      }

      a { color: #98d8ff; }

      .page {
        padding: 18px;
        display: grid;
        gap: 14px;
      }

      .hero {
        border: 1px solid var(--border);
        background:
          linear-gradient(180deg, rgba(20, 32, 27, 0.94) 0%, rgba(13, 21, 18, 0.98) 100%);
        padding: 18px;
        display: grid;
        gap: 14px;
      }

      .hero-top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }

      .hero-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }

      .view-toggle {
        display: inline-flex;
        border: 1px solid var(--border);
      }

      .view-toggle button {
        border: 0;
        border-right: 1px solid var(--border);
      }

      .view-toggle button:last-child {
        border-right: 0;
      }

      .view-toggle button.active {
        background: rgba(75, 214, 159, 0.18);
        color: var(--text);
      }

      .toggle-button.active {
        border-color: var(--accent);
        background: rgba(75, 214, 159, 0.12);
        box-shadow: inset 0 0 0 1px rgba(75, 214, 159, 0.2);
      }

      .kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 10px;
      }

      .kpi {
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.03);
        padding: 10px 12px;
      }

      .kpi strong {
        display: block;
        font-size: 26px;
        margin-top: 4px;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 360px;
        gap: 14px;
        align-items: start;
      }

      .panel {
        border: 1px solid var(--border);
        background: var(--panel);
        min-height: 220px;
      }

      .panel-header {
        padding: 12px 14px;
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
      }

      .panel-body {
        padding: 14px;
      }

      .session-list, .fleet-grid {
        display: grid;
        gap: 10px;
      }

      .session-card, .fleet-card {
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.03);
        padding: 12px;
      }

      .muted { color: var(--muted); font-size: 12px; }

      .tabs-shell {
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.02);
        padding: 12px;
        display: grid;
        gap: 10px;
        position: sticky;
        top: 12px;
        z-index: 8;
        backdrop-filter: blur(12px);
      }

      .tabs-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }

      .project-tabs {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .tabs-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }

      .project-tab {
        min-width: 0;
      }

      .project-tab.active {
        border-color: var(--accent);
        background: rgba(75, 214, 159, 0.12);
        box-shadow: inset 0 0 0 1px rgba(75, 214, 159, 0.2);
      }

      .scene-shell {
        display: grid;
        gap: 12px;
      }

      .scene-fit {
        position: relative;
        width: 100%;
        min-height: 520px;
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        overflow: hidden;
      }

      .scene-fit.compact {
        min-height: 280px;
      }

      .scene-grid {
        flex: 0 0 auto;
        position: relative;
        border: 1px dashed rgba(255,255,255,0.12);
        min-height: 520px;
        overflow: hidden;
        background:
          radial-gradient(circle at 12% 0%, rgba(255,255,255,0.06), transparent 20%),
          radial-gradient(circle at 88% 8%, rgba(75, 214, 159, 0.08), transparent 18%),
          linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
          linear-gradient(180deg, rgba(7, 18, 15, 0.92), rgba(11, 21, 18, 0.98));
        background-size: var(--tile) var(--tile);
        transform-origin: top left;
        will-change: transform;
      }

      .scene-grid.compact {
        min-height: 0;
      }

      .room {
        position: absolute;
        border: 3px solid #4a7b69;
        background:
          linear-gradient(180deg, #9fcbfa 0 30%, #d8ecff 30% 31%, #c7d6e8 31% 52%, #31a2ea 52% 53%, #1c7bc4 53% 100%);
        overflow: hidden;
        box-shadow:
          0 10px 0 rgba(0, 0, 0, 0.22),
          inset 0 0 0 2px rgba(255, 255, 255, 0.08);
      }

      .room-head {
        padding: 0;
        border-bottom: 0;
        background: none;
      }

      .room::after {
        content: "";
        position: absolute;
        inset: 26px 0 0;
        background:
          linear-gradient(180deg, transparent 0 20%, rgba(13, 24, 20, 0.08) 20% 21%, transparent 21% 100%),
          repeating-linear-gradient(180deg, rgba(255,255,255,0.06) 0 3px, rgba(255,255,255,0) 3px 22px);
        opacity: 0.45;
        pointer-events: none;
      }

      .room-stage {
        position: absolute;
        inset: 26px 0 0;
        overflow: hidden;
      }

      .room-mural {
        position: absolute;
        left: 8px;
        right: 8px;
        top: 8px;
        height: 34%;
        background: linear-gradient(180deg, rgba(120, 189, 247, 0.58), rgba(214, 238, 255, 0.08));
        opacity: 0.7;
        pointer-events: none;
      }

      .room-floor {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 48%;
        background:
          linear-gradient(180deg, rgba(0,0,0,0.06), rgba(0,0,0,0)),
          repeating-linear-gradient(180deg, #2aa3e5 0 10px, #1b8fd0 10px 20px);
      }

      .role-banner {
        position: absolute;
        z-index: 2;
        min-width: 44px;
        padding: 2px 5px;
        border: 2px solid rgba(13, 24, 20, 0.55);
        background: rgba(243, 234, 215, 0.88);
        color: #1f2e29;
        font-size: 9px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        box-shadow: 2px 2px 0 rgba(0,0,0,0.25);
      }

      .booth {
        position: absolute;
        z-index: 3;
        outline: none;
      }

      .booth:hover,
      .booth:focus-within {
        z-index: 8;
      }

      .booth.lead {
        filter: drop-shadow(0 0 10px rgba(245, 183, 79, 0.22));
      }

      .booth.entering {
        animation: booth-enter 0.36s linear both;
      }

      .booth.departing {
        opacity: 0.8;
        animation: booth-exit 0.36s linear forwards;
        pointer-events: none;
      }

      .lead-banner {
        position: absolute;
        z-index: 3;
        max-width: 220px;
        min-width: 80px;
        padding: 3px 6px;
        border: 2px solid rgba(13,24,20,0.65);
        background: rgba(18, 28, 24, 0.82);
        color: #f5efdd;
        font-size: 10px;
        line-height: 1.2;
        box-shadow: 2px 2px 0 rgba(0,0,0,0.25);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .station-tag {
        position: absolute;
        z-index: 4;
        max-width: 180px;
        min-width: 52px;
        padding: 2px 5px;
        border: 2px solid rgba(13, 24, 20, 0.55);
        background: color-mix(in srgb, var(--station-tone, #f2ead7) 30%, rgba(243, 234, 215, 0.96));
        color: #1f2e29;
        font-size: 9px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        box-shadow: 2px 2px 0 rgba(0,0,0,0.22);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .rec-room {
        position: absolute;
        border: 3px solid #b98b36;
        background:
          linear-gradient(180deg, #f6dba0 0 26%, #ead0a0 26% 27%, #b9884b 27% 100%);
        overflow: hidden;
        box-shadow:
          0 10px 0 rgba(0, 0, 0, 0.22),
          inset 0 0 0 2px rgba(255,255,255,0.14);
      }

      .rec-room::after {
        content: "";
        position: absolute;
        inset: 22px 0 0;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.22), transparent 26%),
          repeating-linear-gradient(180deg, rgba(255,255,255,0.1) 0 3px, rgba(255,255,255,0) 3px 18px);
        opacity: 0.55;
        pointer-events: none;
      }

      .rec-room .room-meta {
        background: rgba(71, 45, 12, 0.7);
      }

      .booth-wall {
        position: absolute;
        left: 0;
        top: 0;
        right: 8px;
        height: 16px;
        background: #dce7ef;
        border: 2px solid #5e7d92;
        border-bottom: 0;
        box-shadow: inset 0 2px 0 rgba(255,255,255,0.55);
      }

      .booth-divider {
        position: absolute;
        top: 10px;
        right: 0;
        width: 14px;
        bottom: 6px;
        background: #dce7ef;
        border: 2px solid #5e7d92;
      }

      .booth-desk {
        position: absolute;
        left: 6px;
        right: 18px;
        bottom: 10px;
        height: 14px;
        background: #f0f4f8;
        border: 2px solid #4b7088;
        box-shadow:
          inset 0 2px 0 rgba(255,255,255,0.72),
          0 2px 0 rgba(0,0,0,0.2);
      }

      .booth-monitor {
        position: absolute;
        width: 20px;
        height: 14px;
        left: 14px;
        bottom: 22px;
        border: 2px solid #1e2b35;
        background: linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0.04)), #0f1920;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.04);
      }

      .booth-monitor.state-active {
        background: linear-gradient(180deg, rgba(255,255,255,0.24), rgba(255,255,255,0.06)), #36d59d;
        box-shadow: 0 0 0 2px rgba(75,214,159,0.18), 0 0 10px rgba(75,214,159,0.2);
      }

      .booth-keyboard {
        position: absolute;
        width: 16px;
        height: 4px;
        left: 16px;
        bottom: 14px;
        background: #56788d;
      }

      .booth-plaque {
        position: absolute;
        right: 12px;
        bottom: 12px;
        width: 10px;
        height: 20px;
        background: var(--booth-accent, #4bd69f);
        border: 2px solid rgba(0,0,0,0.34);
      }

      .office-sprite {
        position: absolute;
        background-image: url("/assets/pixel-office/PixelOfficeAssets.png");
        background-repeat: no-repeat;
        image-rendering: pixelated;
        pointer-events: none;
      }

      .office-avatar {
        position: absolute;
        z-index: 4;
        background-image: url("/assets/pixel-office/PixelOfficeAssets.png");
        background-repeat: no-repeat;
        image-rendering: pixelated;
        transform-origin: 50% 100%;
        filter: drop-shadow(0 3px 0 rgba(0,0,0,0.24));
      }

      .office-avatar::after {
        content: "";
        position: absolute;
        left: 3px;
        right: 3px;
        bottom: -5px;
        height: 4px;
        background: var(--appearance-shadow, rgba(0,0,0,0.25));
        opacity: 0.55;
      }

      .office-avatar::before {
        content: "";
        position: absolute;
        left: -4px;
        top: 2px;
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--appearance-body, #4bd69f);
        border: 2px solid rgba(18,28,24,0.8);
      }

      .office-avatar.state-editing,
      .office-avatar.state-running,
      .office-avatar.state-validating,
      .office-avatar.state-scanning,
      .office-avatar.state-thinking,
      .office-avatar.state-planning,
      .office-avatar.state-delegating {
        animation: worker-bob 1s steps(2, end) infinite;
      }

      .office-avatar.state-idle,
      .office-avatar.state-done {
        animation: worker-idle 1.6s steps(2, end) infinite;
      }

      .office-avatar.state-blocked {
        outline: 2px solid rgba(240, 109, 94, 0.65);
        animation: worker-alert 0.9s steps(2, end) infinite;
      }

      .office-avatar.state-waiting {
        outline: 2px solid rgba(245, 183, 79, 0.55);
        animation: worker-idle 1.6s steps(2, end) infinite;
      }

      .office-avatar.state-cloud {
        outline: 2px solid rgba(152, 216, 255, 0.55);
        animation: worker-cloud 1.2s steps(2, end) infinite;
      }

      .speech-bubble {
        position: absolute;
        z-index: 5;
        padding: 2px 5px;
        border: 2px solid rgba(13, 24, 20, 0.65);
        background: rgba(255,255,255,0.92);
        color: #1d2c26;
        font-size: 10px;
        line-height: 1;
        box-shadow: 2px 2px 0 rgba(0,0,0,0.2);
        transform: translateX(-50%);
        white-space: nowrap;
      }

      .speech-bubble.waiting {
        background: rgba(255, 241, 201, 0.96);
      }

      .speech-bubble.blocked {
        background: rgba(255, 224, 219, 0.96);
      }

      .speech-bubble.resting {
        background: rgba(227, 244, 237, 0.96);
      }

      .agent-hover,
      .waiting-hover,
      .lounge-hover {
        position: absolute;
        left: 50%;
        bottom: calc(100% + 8px);
        z-index: 9;
        width: min(220px, max-content);
        min-width: 150px;
        max-width: 240px;
        padding: 6px 7px;
        border: 2px solid rgba(13, 24, 20, 0.7);
        background: rgba(9, 17, 14, 0.95);
        color: #f4efdf;
        box-shadow: 4px 4px 0 rgba(0,0,0,0.28);
        opacity: 0;
        pointer-events: none;
        transform: translate(-50%, 6px);
        transition: opacity 90ms linear, transform 90ms linear;
      }

      .booth:hover .agent-hover,
      .booth:focus-within .agent-hover,
      .waiting-agent:hover .waiting-hover,
      .waiting-agent:focus-within .waiting-hover,
      .lounge-agent:hover .lounge-hover,
      .lounge-agent:focus-within .lounge-hover {
        opacity: 1;
        transform: translate(-50%, 0);
      }

      .agent-hover-title {
        font-size: 10px;
        line-height: 1.3;
        color: #fff7df;
        margin-bottom: 6px;
      }

      .agent-hover-title strong {
        display: block;
        margin-bottom: 2px;
      }

      .agent-hover-row {
        display: grid;
        grid-template-columns: 48px minmax(0, 1fr);
        gap: 6px;
        align-items: start;
        font-size: 10px;
        line-height: 1.25;
      }

      .agent-hover-row + .agent-hover-row {
        margin-top: 4px;
      }

      .agent-hover-key {
        color: rgba(244, 239, 223, 0.62);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .agent-hover-value {
        min-width: 0;
        color: #f4efdf;
        overflow-wrap: anywhere;
      }

      .room-empty {
        position: absolute;
        left: 12px;
        right: 12px;
        top: 44%;
        z-index: 3;
        padding: 8px;
        border: 2px dashed rgba(0,0,0,0.25);
        background: rgba(255,255,255,0.24);
        color: rgba(20,32,27,0.82);
        font-size: 11px;
        text-align: center;
      }

      .waiting-lane {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 12px;
        height: 86px;
      }

      .lounge-zone {
        position: absolute;
        left: 10px;
        right: 10px;
        top: 10px;
        height: 104px;
      }

      .lounge-rug {
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 18px;
        height: 36px;
        border: 2px solid rgba(112, 84, 37, 0.46);
        background:
          linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0)),
          repeating-linear-gradient(90deg, #dbb26e 0 8px, #c89b55 8px 16px);
        box-shadow: inset 0 0 0 2px rgba(255,255,255,0.08);
        opacity: 0.92;
      }

      .waiting-agent {
        position: absolute;
        z-index: 4;
        width: 52px;
        height: 72px;
        outline: none;
      }

      .waiting-agent:hover,
      .waiting-agent:focus-within {
        z-index: 8;
      }

      .lounge-agent {
        position: absolute;
        z-index: 4;
        width: 52px;
        height: 72px;
        outline: none;
      }

      .lounge-agent:hover,
      .lounge-agent:focus-within {
        z-index: 8;
      }

      .pixel-asset {
        position: absolute;
        image-rendering: pixelated;
        pointer-events: none;
      }

      .legend {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        font-size: 12px;
      }

      .legend span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        display: inline-block;
      }

      .card-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
      }

      .inline-code {
        font-size: 12px;
        color: var(--muted);
        overflow-wrap: anywhere;
      }

      .empty {
        color: var(--muted);
        padding: 18px;
        border: 1px dashed rgba(255,255,255,0.12);
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.03);
        font-size: 12px;
      }

      .status-pill::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: currentColor;
      }

      .status-pill.state-live {
        color: var(--accent);
      }

      .status-pill.state-connecting,
      .status-pill.state-reconnecting,
      .status-pill.state-snapshot {
        color: var(--accent-2);
      }

      .status-pill.state-offline {
        color: var(--danger);
      }

      .room-meta {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        padding: 4px 6px;
        font-size: 11px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        background: rgba(13, 24, 20, 0.7);
      }

      .room-head {
        padding: 0;
        border-bottom: 0;
        background: none;
      }

      .terminal-shell {
        border: 1px solid rgba(255,255,255,0.08);
        background: #07100d;
        color: #b7ffdd;
        font-size: 12px;
        line-height: 1.55;
        padding: 14px;
        min-height: 520px;
        overflow: auto;
        white-space: pre-wrap;
      }

      .workspace-scroll {
        display: grid;
        gap: 14px;
        max-height: 68vh;
        overflow: auto;
        padding-right: 4px;
        align-content: start;
      }

      .workspace-card {
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.03);
        padding: 12px;
        display: grid;
        gap: 12px;
      }

      .workspace-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .workspace-title {
        display: grid;
        gap: 4px;
      }

      .workspace-title strong {
        font-size: 16px;
      }

      .workspace-card.compact {
        gap: 10px;
        padding: 10px;
      }

      .workspace-card.compact .workspace-title strong {
        font-size: 14px;
      }

      .terminal-dim {
        color: #7aa18e;
      }

      .terminal-hot {
        color: #f5b74f;
      }

      .terminal-warn {
        color: #ff9f95;
      }

      @keyframes worker-bob {
        0% { transform: translateY(0); }
        50% { transform: translateY(-2px); }
        100% { transform: translateY(0); }
      }

      @keyframes worker-idle {
        0% { transform: translateY(0); opacity: 1; }
        50% { transform: translateY(-1px); opacity: 0.82; }
        100% { transform: translateY(0); opacity: 1; }
      }

      @keyframes worker-alert {
        0% { transform: translateX(0); }
        25% { transform: translateX(-1px); }
        75% { transform: translateX(1px); }
        100% { transform: translateX(0); }
      }

      @keyframes worker-cloud {
        0% { transform: translateY(0); opacity: 1; }
        50% { transform: translateY(-2px); opacity: 0.75; }
        100% { transform: translateY(0); opacity: 1; }
      }

      @keyframes booth-enter {
        0% { transform: translate(-72px, 10px); opacity: 0; }
        35% { transform: translate(-42px, 6px); opacity: 1; }
        70% { transform: translate(-16px, 2px); opacity: 1; }
        100% { transform: translate(0, 0); opacity: 1; }
      }

      @keyframes booth-exit {
        0% { transform: translate(0, 0); opacity: 1; }
        30% { transform: translate(14px, 2px); opacity: 1; }
        100% { transform: translate(82px, 10px); opacity: 0; }
      }

      @media (max-width: 1240px) {
        .layout {
          grid-template-columns: 1fr;
        }

        .kpis {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 640px) {
        .page {
          padding: 12px;
        }

        .kpis {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <section class="hero">
        <div class="hero-top">
          <div>
            <div class="muted">Codex activity observer</div>
            <h1 style="margin: 4px 0 0;">Codex Agents Office</h1>
            <div id="stamp" class="muted">Loading…</div>
          </div>
          <div class="hero-actions">
            <div class="view-toggle">
              <button id="map-view-button" data-view="map">Map</button>
              <button id="terminal-view-button" data-view="terminal">Terminal</button>
            </div>
            <button id="refresh-button">Refresh</button>
            <button id="scaffold-button">Scaffold Rooms XML</button>
            <div id="connection-pill" class="status-pill state-connecting">Connecting</div>
          </div>
        </div>
        <div id="kpis" class="kpis"></div>
        <div class="tabs-shell">
          <div class="tabs-head">
            <strong>Workspaces</strong>
            <div class="tabs-actions">
              <button id="active-only-button" class="toggle-button">Current only</button>
              <span class="muted" id="project-count"></span>
            </div>
          </div>
          <div id="project-tabs" class="project-tabs"></div>
        </div>
      </section>

      <section class="layout">
        <main class="panel">
          <div class="panel-header">
            <strong id="center-title">Fleet</strong>
            <div class="legend">
              <span><i class="dot" style="background:#4bd69f"></i>active</span>
              <span><i class="dot" style="background:#f5b74f"></i>waiting</span>
              <span><i class="dot" style="background:#f06d5e"></i>blocked</span>
              <span><i class="dot" style="background:#98d8ff"></i>cloud</span>
            </div>
          </div>
          <div class="panel-body">
            <div id="center-content"></div>
          </div>
        </main>

        <aside class="panel">
          <div class="panel-header">
            <strong>Sessions</strong>
            <span id="rooms-path" class="muted"></span>
          </div>
          <div id="session-list" class="panel-body session-list"></div>
        </aside>
      </section>
    </div>

    <script>
      const configuredProjects = ${projectsJson};
      const pixelOffice = ${JSON.stringify(PIXEL_OFFICE_MANIFEST)};
      const params = new URLSearchParams(window.location.search);
      const initialProject = params.get("project") || "all";
      const initialView = params.get("view") || "map";
      const initialActiveOnly = params.get("history") !== "1" && params.get("active") !== "0";
      const screenshotMode = params.get("screenshot") === "1";
      const state = {
        fleet: null,
        selected: initialProject,
        view: initialView === "terminal" ? "terminal" : "map",
        activeOnly: initialActiveOnly,
        connection: screenshotMode ? "snapshot" : "connecting"
      };
      let events = null;
      const liveAgentMemory = new Map();
      let enteringAgentKeys = new Set();
      let departingAgents = [];

      const projectMetaByRoot = new Map(configuredProjects.map((project) => [project.root, project]));
      function projectInfo(projectRoot) {
        return projectMetaByRoot.get(projectRoot) || {
          root: projectRoot,
          label: projectRoot.split(/[\\\\/]/).filter(Boolean).pop() || projectRoot
        };
      }

      function projectLabel(projectRoot) {
        return projectInfo(projectRoot).label;
      }

      function agentKey(projectRoot, agent) {
        return \`\${projectRoot}::\${agent.id}\`;
      }

      const mapViewButton = document.getElementById("map-view-button");
      const terminalViewButton = document.getElementById("terminal-view-button");
      const activeOnlyButton = document.getElementById("active-only-button");
      const refreshButton = document.getElementById("refresh-button");
      const scaffoldButton = document.getElementById("scaffold-button");
      const connectionPill = document.getElementById("connection-pill");
      const stamp = document.getElementById("stamp");
      const kpis = document.getElementById("kpis");
      const projectCount = document.getElementById("project-count");
      const projectTabs = document.getElementById("project-tabs");
      const centerTitle = document.getElementById("center-title");
      const centerContent = document.getElementById("center-content");
      const sessionList = document.getElementById("session-list");
      const roomsPath = document.getElementById("rooms-path");

      function syncUrl() {
        const url = new URL(window.location.href);
        if (state.selected === "all") url.searchParams.delete("project");
        else url.searchParams.set("project", state.selected);
        if (state.view === "map") url.searchParams.delete("view");
        else url.searchParams.set("view", state.view);
        url.searchParams.delete("active");
        if (state.activeOnly) url.searchParams.delete("history");
        else url.searchParams.set("history", "1");
        window.history.replaceState({}, "", url);
      }

      function setSelection(nextSelection) {
        state.selected = nextSelection;
        syncUrl();
        render();
      }

      function setView(nextView) {
        state.view = nextView === "terminal" ? "terminal" : "map";
        syncUrl();
        render();
      }

      function setActiveOnly(nextValue) {
        state.activeOnly = Boolean(nextValue);
        syncUrl();
        render();
      }

      function setConnection(nextConnection) {
        state.connection = nextConnection;
        if (!connectionPill) return;
        connectionPill.className = \`status-pill state-\${nextConnection}\`;
        connectionPill.textContent =
          nextConnection === "live" ? "Live stream"
          : nextConnection === "snapshot" ? "Snapshot mode"
          : nextConnection === "offline" ? "Offline"
          : nextConnection === "reconnecting" ? "Reconnecting"
          : "Connecting";
      }

      function countsForSnapshot(snapshot) {
        const counters = { total: snapshot.agents.length, active: 0, waiting: 0, blocked: 0, cloud: 0 };
        for (const agent of snapshot.agents) {
          if (agent.state === "waiting") counters.waiting += 1;
          else if (agent.state === "blocked") counters.blocked += 1;
          else if (agent.state === "cloud") counters.cloud += 1;
          else if (agent.state !== "done" && agent.state !== "idle") counters.active += 1;
        }
        return counters;
      }

      function isBusyAgent(agent) {
        return agent.isCurrent === true;
      }

      function busyCount(snapshot) {
        return snapshot.agents.filter(isBusyAgent).length;
      }

      function viewSnapshot(snapshot) {
        if (!state.activeOnly) {
          return snapshot;
        }

        return {
          ...snapshot,
          agents: snapshot.agents.filter(isBusyAgent)
        };
      }

      function visibleProjects(fleet) {
        return fleet.projects;
      }

      function fleetCounts(fleet) {
        return fleet.projects.reduce((acc, snapshot) => {
          const next = countsForSnapshot(snapshot);
          acc.total += next.total;
          acc.active += next.active;
          acc.waiting += next.waiting;
          acc.blocked += next.blocked;
          acc.cloud += next.cloud;
          return acc;
        }, { total: 0, active: 0, waiting: 0, blocked: 0, cloud: 0 });
      }

      function stableHash(input) {
        let hash = 2166136261;
        for (const char of String(input)) {
          hash ^= char.charCodeAt(0);
          hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0);
      }

      function agentRole(agent) {
        if (agent.role) {
          return String(agent.role).toLowerCase();
        }
        return agent.source === "cloud" ? "cloud" : "default";
      }

      function titleCaseWords(value) {
        return String(value)
          .split(/\s+/)
          .filter(Boolean)
          .map((word) => word[0] ? word[0].toUpperCase() + word.slice(1) : word)
          .join(" ");
      }

      function pluralizeWord(word, count) {
        if (count === 1) {
          return word;
        }
        if (/[^aeiou]y$/i.test(word)) {
          return word.slice(0, -1) + "ies";
        }
        if (/(s|x|z|ch|sh)$/i.test(word)) {
          return word + "es";
        }
        return word + "s";
      }

      function pluralizePhrase(phrase, count) {
        if (count === 1) {
          return phrase;
        }
        const words = String(phrase).split(/\s+/).filter(Boolean);
        if (words.length === 0) {
          return phrase;
        }
        words[words.length - 1] = pluralizeWord(words[words.length - 1], count);
        return words.join(" ");
      }

      function agentRoleLabel(agent) {
        return titleCaseWords(agentRole(agent).replace(/[_-]+/g, " "));
      }

      function childAgentsFor(snapshot, parentThreadId) {
        return snapshot.agents.filter((agent) => agent.parentThreadId === parentThreadId);
      }

      function isLeadSession(snapshot, agent) {
        return agent.source !== "cloud"
          && !agent.parentThreadId
          && (agent.isCurrent === true || childAgentsFor(snapshot, agent.id).length > 0);
      }

      function agentRankLabel(snapshot, agent) {
        if (isLeadSession(snapshot, agent)) {
          return "mini-boss";
        }
        if (agent.parentThreadId) {
          return "subagent";
        }
        return agent.sourceKind || agentRole(agent);
      }

      function parentLabelFor(snapshot, agent) {
        if (!agent.parentThreadId) {
          return null;
        }
        return snapshot.agents.find((candidate) => candidate.id === agent.parentThreadId)?.label ?? null;
      }

      function stationRoleLabel(role, count) {
        const normalized = String(role || "default").trim().toLowerCase().replace(/[_-]+/g, " ");
        const base =
          normalized === "default" ? "generalist"
          : normalized === "cloud" ? "cloud operator"
          : normalized;
        return titleCaseWords(pluralizePhrase(base, count));
      }

      function groupAgentsByRole(agents) {
        const buckets = new Map();
        for (const agent of agents) {
          const role = agentRole(agent);
          const list = buckets.get(role) || [];
          list.push(agent);
          buckets.set(role, list);
        }

        return [...buckets.entries()]
          .map(([role, roleAgents]) => ({
            role,
            agents: [...roleAgents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          }))
          .sort((left, right) => {
            if (right.agents.length !== left.agents.length) {
              return right.agents.length - left.agents.length;
            }
            return stationRoleLabel(left.role, left.agents.length)
              .localeCompare(stationRoleLabel(right.role, right.agents.length));
          });
      }

      function roleTone(role) {
        const normalized = String(role || "default").toLowerCase();
        switch (normalized) {
          case "boss":
            return "#ffcf4d";
          case "worker":
            return "#4bd69f";
          case "explorer":
            return "#f5b74f";
          case "cloud":
            return "#98d8ff";
          case "default":
            return "#f2ead7";
          default:
            if (normalized.includes("design") || normalized.includes("copy") || normalized.includes("writer")) {
              return "#ff9a7a";
            }
            if (normalized.includes("map") || normalized.includes("research") || normalized.includes("docs")) {
              return "#8cd5ff";
            }
            if (normalized.includes("review") || normalized.includes("qa")) {
              return "#ffd479";
            }
            return "#d7b7ff";
        }
      }

      function avatarForAgent(agent) {
        const roster = pixelOffice.avatars;
        return roster[stableHash(\`\${agent.appearance.id}:\${agentRole(agent)}:\${agent.id}\`) % roster.length];
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function relativeLocation(projectRoot, location) {
        if (!location) return "";
        if (/^https?:\\/\\//.test(location)) return location;
        if (location === projectRoot) return ".";
        if (location.startsWith(projectRoot + "/")) {
          return location.slice(projectRoot.length + 1);
        }
        return location;
      }

      function cleanReportedPath(projectRoot, location) {
        if (!location) {
          return "";
        }
        return relativeLocation(projectRoot, String(location));
      }

      function primaryFocusPath(snapshot, agent) {
        const focusPath = Array.isArray(agent.paths) && agent.paths.length > 0
          ? agent.paths.find((entry) => typeof entry === "string" && entry.length > 0) || null
          : null;
        if (focusPath) {
          return cleanReportedPath(snapshot.projectRoot, focusPath);
        }
        if (agent.cwd) {
          const cwd = cleanReportedPath(snapshot.projectRoot, agent.cwd);
          return cwd === "." ? null : cwd;
        }
        return null;
      }

      function formatUpdatedAt(value) {
        const updatedAt = Date.parse(value);
        if (!Number.isFinite(updatedAt)) {
          return value;
        }
        const deltaSeconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
        if (deltaSeconds < 60) {
          return \`\${deltaSeconds}s ago\`;
        }
        const deltaMinutes = Math.round(deltaSeconds / 60);
        if (deltaMinutes < 60) {
          return \`\${deltaMinutes}m ago\`;
        }
        const deltaHours = Math.round(deltaMinutes / 60);
        if (deltaHours < 24) {
          return \`\${deltaHours}h ago\`;
        }
        const deltaDays = Math.round(deltaHours / 24);
        return \`\${deltaDays}d ago\`;
      }

      function renderAgentHover(snapshot, agent) {
        const lead = parentLabelFor(snapshot, agent);
        const focus = primaryFocusPath(snapshot, agent);
        const branch = agent.git && agent.git.branch ? agent.git.branch : null;
        const rows = [
          ["Now", agent.detail],
          ["Type", \`\${agentRankLabel(snapshot, agent)} · \${agentRoleLabel(agent)}\`]
        ];
        if (focus) {
          rows.push(["Focus", focus]);
        }
        if (lead) {
          rows.push(["Lead", lead]);
        }
        if (branch) {
          rows.push(["Branch", branch]);
        }
        rows.push(["Source", agent.source === "cloud" ? "Codex Cloud" : titleCaseWords(agent.sourceKind || agent.source)]);
        rows.push(["Updated", formatUpdatedAt(agent.updatedAt)]);

        return \`<div class="agent-hover"><div class="agent-hover-title"><strong>\${escapeHtml(agent.label)}</strong><span>\${escapeHtml(agent.appearance.label)}</span></div>\${rows.map(([key, value]) => \`<div class="agent-hover-row"><span class="agent-hover-key">\${escapeHtml(key)}</span><span class="agent-hover-value">\${escapeHtml(value)}</span></div>\`).join("")}</div>\`;
      }

      function flattenRooms(rooms) {
        const output = [];
        const queue = [...rooms];
        while (queue.length > 0) {
          const room = queue.shift();
          output.push(room);
          if (Array.isArray(room.children)) queue.unshift(...room.children);
        }
        return output.sort((left, right) => (right.width * right.height) - (left.width * left.height));
      }

      function renderSprite(sprite, x, y, scale, className, extraStyle = "", title = "", options = {}) {
        const sheetUrl = options.sheetUrl || pixelOffice.sheetUrl;
        const sheetWidth = options.sheetWidth || pixelOffice.sheetSize.width;
        const sheetHeight = options.sheetHeight || pixelOffice.sheetSize.height;
        const width = Math.round(sprite.w * scale);
        const height = Math.round(sprite.h * scale);
        const style = [
          \`left:\${Math.round(x)}px\`,
          \`top:\${Math.round(y)}px\`,
          \`width:\${width}px\`,
          \`height:\${height}px\`,
          \`background-image:url(\${sheetUrl})\`,
          \`background-size:\${sheetWidth * scale}px \${sheetHeight * scale}px\`,
          \`background-position:-\${sprite.x * scale}px -\${sprite.y * scale}px\`,
          extraStyle
        ].filter(Boolean).join(";");
        const titleAttr = title ? \` title="\${escapeHtml(title)}"\` : "";
        return \`<div class="\${className}"\${titleAttr} style="\${style}"></div>\`;
      }

      function fitSpriteToWidth(sprite, width, minScale, maxScale) {
        return Math.max(minScale, Math.min(maxScale, width / sprite.w));
      }

      function chairSpriteForAgent(agent) {
        return pixelOffice.chairs[stableHash(agent.id) % pixelOffice.chairs.length];
      }

      function wallArtForRole(role) {
        switch (role) {
          case "explorer":
          case "office_mapper":
            return pixelOffice.props.artUs;
          case "worker":
          case "engineer":
          case "implementer":
            return pixelOffice.props.artUk;
          case "content_designer":
          case "designer":
          case "writer":
            return pixelOffice.props.artWarm;
          default:
            return pixelOffice.props.artWarm;
        }
      }

      function fileSpriteForRole(role) {
        switch (role) {
          case "explorer":
          case "office_mapper":
            return pixelOffice.props.fileBlue;
          case "worker":
          case "engineer":
          case "implementer":
            return pixelOffice.props.fileGreen;
          default:
            return pixelOffice.props.filePurple;
        }
      }

      function sofaSpriteAt(index) {
        const sofas = [
          pixelOffice.props.sofaOrange,
          pixelOffice.props.sofaGray,
          pixelOffice.props.sofaBlue,
          pixelOffice.props.sofaGreen
        ];
        return sofas[index % sofas.length];
      }

      function roomSkyHtml(roomPixelWidth, compact) {
        const scale = fitSpriteToWidth(pixelOffice.props.sky, roomPixelWidth - 16, compact ? 0.62 : 0.74, compact ? 0.86 : 1.08);
        return renderSprite(pixelOffice.props.sky, 8, 8, scale, "office-sprite", "z-index:1; opacity:0.94;");
      }

      function buildLeadClusters(occupants) {
        const ordered = [...occupants].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const byId = new Map(ordered.map((agent) => [agent.id, agent]));
        const buckets = new Map();
        const leads = [];

        for (const agent of ordered) {
          if (agent.parentThreadId && byId.has(agent.parentThreadId)) {
            const list = buckets.get(agent.parentThreadId) || [];
            list.push(agent);
            buckets.set(agent.parentThreadId, list);
            continue;
          }
          leads.push(agent);
        }

        return leads.map((lead) => ({
          lead,
          children: [...(buckets.get(lead.id) || [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        }));
      }

      function buildClusterLayout(cluster, compact, leadBoothWidth, leadBoothHeight, childBoothWidth, childBoothHeight) {
        const labelHeight = compact ? 12 : 14;
        const roleGapX = compact ? 8 : 12;
        const roleGapY = compact ? 8 : 10;
        const boothGap = 6;
        const childCols = 2;
        let rightY = 0;
        let rightWidth = 0;
        const roleGroups = groupAgentsByRole(cluster.children);

        const groups = roleGroups.map((group) => {
          const columns = Math.max(1, Math.min(childCols, group.agents.length));
          const rows = Math.max(1, Math.ceil(group.agents.length / childCols));
          const showLabel = group.agents.length > 1 || group.role !== "default" || roleGroups.length > 1;
          const visibleLabelHeight = showLabel ? labelHeight + 4 : 0;
          const width = columns * childBoothWidth + (columns - 1) * boothGap;
          const height = visibleLabelHeight + rows * childBoothHeight + (rows - 1) * boothGap;
          const layout = {
            ...group,
            x: leadBoothWidth + roleGapX,
            y: rightY,
            width,
            height,
            columns,
            labelHeight,
            showLabel,
            labelOffset: visibleLabelHeight
          };
          rightY += height + roleGapY;
          rightWidth = Math.max(rightWidth, width);
          return layout;
        });

        if (groups.length > 0) {
          rightY -= roleGapY;
        }

        return {
          lead: cluster.lead,
          children: cluster.children,
          groups,
          width: leadBoothWidth + (groups.length > 0 ? roleGapX + rightWidth : 0),
          height: Math.max(leadBoothHeight, rightY)
        };
      }

      function restingAgentsFor(snapshot, compact, liveOnly) {
        if (liveOnly) {
          return [];
        }

        return snapshot.agents
          .filter((agent) => agent.source !== "cloud" && (agent.state === "idle" || agent.state === "done"))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, compact ? 4 : 6);
      }

      function loungeMetaLabel(waitingCount, restingCount) {
        const parts = [];
        if (waitingCount > 0) {
          parts.push(\`\${waitingCount} waiting\`);
        }
        if (restingCount > 0) {
          parts.push(\`\${restingCount} resting\`);
        }
        return parts.length > 0 ? parts.join(" · ") : "no breaks";
      }

      function loungeSlotAt(index, compact, recRoomWidth) {
        const slots = compact
          ? [
              { x: 16, y: 34, flip: false, bubble: "zz", settle: true },
              { x: 38, y: 34, flip: true, bubble: null, settle: true },
              { x: 84, y: 40, flip: false, bubble: "sip", settle: false },
              { x: 116, y: 34, flip: true, bubble: "sip", settle: false },
              { x: recRoomWidth - 56, y: 38, flip: true, bubble: null, settle: false }
            ]
          : [
              { x: 22, y: 48, flip: false, bubble: "zz", settle: true },
              { x: 50, y: 48, flip: true, bubble: null, settle: true },
              { x: 116, y: 54, flip: false, bubble: "sip", settle: false },
              { x: 156, y: 48, flip: true, bubble: "sip", settle: false },
              { x: recRoomWidth - 60, y: 50, flip: true, bubble: null, settle: false },
              { x: 88, y: 70, flip: stableHash(index) % 2 === 0, bubble: null, settle: false }
            ];
        return slots[index % slots.length];
      }

      function boothPose(agent, boothWidth, boothHeight, avatar, avatarScale) {
        const avatarWidth = avatar.w * avatarScale;
        const avatarHeight = avatar.h * avatarScale;
        const seated = {
          x: Math.max(10, Math.round(boothWidth * 0.38)),
          y: Math.max(2, Math.round(boothHeight - avatarHeight + 2)),
          flip: false,
          bubble: null
        };
        const aisle = {
          x: Math.max(8, Math.round(boothWidth - avatarWidth - 4)),
          y: Math.max(0, Math.round(boothHeight - avatarHeight + 8)),
          flip: true,
          bubble: null
        };
        switch (agent.state) {
          case "editing":
          case "thinking":
          case "planning":
          case "scanning":
          case "delegating":
            return seated;
          case "running":
          case "validating":
            return {
              ...aisle,
              y: Math.max(0, aisle.y - 6),
              bubble: agent.state === "validating" ? "ok" : null
            };
          case "waiting":
            return { ...aisle, bubble: "..." };
          case "blocked":
            return { ...aisle, bubble: "!" };
          case "cloud":
            return { ...aisle, bubble: "cloud" };
          case "done":
          case "idle":
          default:
            return {
              ...aisle,
              x: Math.max(6, Math.round(boothWidth * 0.52)),
              flip: stableHash(agent.id) % 2 === 0
            };
        }
      }

      function renderBooth(snapshot, agent, role, x, y, boothWidth, boothHeight, compact, options = {}) {
        const avatar = avatarForAgent(agent);
        const avatarScale = compact ? 1.25 : 1.5;
        const pose = boothPose(agent, boothWidth, boothHeight, avatar, avatarScale);
        const avatarWidth = avatar.w * avatarScale;
        const avatarHeight = avatar.h * avatarScale;
        const chair = chairSpriteForAgent(agent);
        const art = wallArtForRole(role);
        const files = fileSpriteForRole(role);
        const wall = pixelOffice.props.cubicleWall;
        const panelLeft = pixelOffice.props.cubiclePanelLeft;
        const panelRight = pixelOffice.props.cubiclePanelRight;
        const wallScale = fitSpriteToWidth(wall, boothWidth * (options.lead ? 0.88 : 0.82), compact ? 0.7 : 0.82, compact ? 0.88 : 1.02);
        const chairScale = compact ? 1.14 : (options.lead ? 1.34 : 1.22);
        const workstationScale = fitSpriteToWidth(pixelOffice.props.workstation, boothWidth * (options.lead ? 0.28 : 0.24), compact ? 1.78 : 2.02, compact ? 2.12 : 2.42);
        const towerScale = compact ? 1.1 : 1.24;
        const panelScale = compact ? 1.08 : 1.22;
        const plantScale = compact ? 0.92 : 1.06;
        const wallWidth = wall.w * wallScale;
        const wallHeight = wall.h * wallScale;
        const wallX = Math.round((boothWidth - wallWidth) / 2);
        const wallY = compact ? 2 : 4;
        const artScale = compact ? 0.96 : 1.06;
        const artX = Math.max(4, wallX + Math.round(wallWidth * 0.34));
        const artY = wallY + Math.max(2, Math.round(wallHeight * 0.58));
        const workstationWidth = pixelOffice.props.workstation.w * workstationScale;
        const workstationHeight = pixelOffice.props.workstation.h * workstationScale;
        const workstationX = Math.round((boothWidth - workstationWidth) / 2);
        const workstationY = Math.round(boothHeight - workstationHeight - (compact ? 6 : 8));
        const chairX = Math.max(2, workstationX - chair.w * chairScale + Math.round(workstationWidth * 0.22));
        const chairY = Math.round(boothHeight - chair.h * chairScale - (compact ? 1 : 2));
        const towerX = Math.min(boothWidth - pixelOffice.props.tower.w * towerScale - 4, workstationX + workstationWidth - pixelOffice.props.tower.w * towerScale + (compact ? 1 : 2));
        const towerY = Math.max(wallY + wallHeight + 2, workstationY + workstationHeight - pixelOffice.props.tower.h * towerScale - (compact ? 1 : 2));
        const panelY = Math.max(wallY + wallHeight + (compact ? 1 : 2), workstationY - panelLeft.h * panelScale + Math.round(workstationHeight * 0.44));
        const panelLeftX = Math.max(4, workstationX - panelLeft.w * panelScale + Math.round(workstationWidth * 0.16));
        const panelRightX = Math.min(boothWidth - panelRight.w * panelScale - 4, workstationX + workstationWidth - Math.round(workstationWidth * 0.18));
        const fileScale = compact ? 1.1 : 1.22;
        const fileX = Math.min(boothWidth - files.w * fileScale - 4, workstationX + workstationWidth + (compact ? 2 : 4));
        const fileY = Math.max(wallY + wallHeight + 2, workstationY + workstationHeight - files.h * fileScale - (compact ? 2 : 3));
        const plantX = Math.max(4, wallX + wallWidth - pixelOffice.props.plant.w * plantScale - 4);
        const plantY = Math.max(wallY + wallHeight + 2, workstationY + workstationHeight - pixelOffice.props.plant.h * plantScale - (compact ? 2 : 4));
        const mugScale = compact ? 1.04 : 1.16;
        const mugX = Math.max(5, workstationX + Math.round(workstationWidth * 0.7));
        const mugY = Math.max(wallY + wallHeight + 4, workstationY + Math.round(workstationHeight * 0.5));
        const deskShell = [
          renderSprite(wall, wallX, wallY, wallScale, "office-sprite", "z-index:1; opacity:0.98;"),
          renderSprite(art, artX, artY, artScale, "office-sprite", "z-index:2;"),
          renderSprite(panelLeft, panelLeftX, panelY, panelScale, "office-sprite", "z-index:3; opacity:0.96;"),
          renderSprite(panelRight, panelRightX, panelY, panelScale, "office-sprite", "z-index:3; opacity:0.96;"),
          options.lead
            ? renderSprite(pixelOffice.props.plant, plantX, plantY, plantScale, "office-sprite", "z-index:2;")
            : renderSprite(files, fileX, fileY, fileScale, "office-sprite", "z-index:2; opacity:0.96;"),
          renderSprite(chair, chairX, chairY, chairScale, "office-sprite", "z-index:2;"),
          renderSprite(pixelOffice.props.workstation, workstationX, workstationY, workstationScale, "office-sprite", "z-index:5;"),
          renderSprite(pixelOffice.props.tower, towerX, towerY, towerScale, "office-sprite", "z-index:4;"),
          renderSprite(pixelOffice.props.mug, mugX, mugY, mugScale, "office-sprite", "z-index:6;")
        ].join("");
        const bubbleClass = agent.state === "blocked" ? "speech-bubble blocked"
          : agent.state === "waiting" ? "speech-bubble waiting"
          : "speech-bubble";
        const bubble = pose.bubble
          ? \`<div class="\${bubbleClass}" style="left:\${Math.round(pose.x + avatarWidth / 2)}px; top:\${Math.max(0, Math.round(pose.y - 12))}px;">\${escapeHtml(pose.bubble)}</div>\`
          : "";
        const avatarStyle = [
          \`left:\${Math.round(pose.x)}px\`,
          \`top:\${Math.round(pose.y)}px\`,
          \`width:\${Math.round(avatarWidth)}px\`,
          \`height:\${Math.round(avatarHeight)}px\`,
          \`background-size:\${256 * avatarScale}px \${160 * avatarScale}px\`,
          \`background-position:-\${avatar.x * avatarScale}px -\${avatar.y * avatarScale}px\`,
          \`--appearance-body:\${agent.appearance.body}\`,
          \`--appearance-shadow:\${agent.appearance.shadow}\`,
          pose.flip ? "transform: scaleX(-1)" : ""
        ].filter(Boolean).join(";");
        const monitorClass = isBusyAgent(agent) && agent.state !== "waiting" && agent.state !== "blocked"
          ? "booth-monitor state-active"
          : "booth-monitor";

        const screenGlow = monitorClass.includes("state-active")
          ? \`<div style="position:absolute;left:\${Math.round(workstationX + workstationWidth * 0.18)}px;top:\${Math.round(workstationY + workstationHeight * 0.12)}px;width:\${Math.max(8, Math.round(workstationWidth * 0.38))}px;height:\${Math.max(6, Math.round(workstationHeight * 0.18))}px;background:rgba(75,214,159,0.3);box-shadow:0 0 10px rgba(75,214,159,0.28);pointer-events:none;z-index:7;"></div>\`
          : "";
        const key = agentKey(snapshot.projectRoot, agent);
        const classes = ["booth"];
        if (options.lead) classes.push("lead");
        if (options.liveOnly && enteringAgentKeys.has(key)) classes.push("entering");
        if (options.departing) classes.push("departing");

        return \`<div class="\${classes.join(" ")}" tabindex="0" style="left:\${Math.round(x)}px; top:\${Math.round(y)}px; width:\${boothWidth}px; height:\${boothHeight}px; --booth-accent:\${roleTone(role)};">\${deskShell}\${screenGlow}<div class="office-avatar state-\${agent.state}" style="\${avatarStyle}"></div>\${bubble}\${renderAgentHover(snapshot, agent)}</div>\`;
      }

      function renderWaitingAvatar(snapshot, agent, x, y, compact) {
        const avatar = avatarForAgent(agent);
        const avatarScale = compact ? 1.25 : 1.5;
        const avatarWidth = avatar.w * avatarScale;
        const avatarHeight = avatar.h * avatarScale;
        const avatarStyle = [
          "left:0",
          "top:0",
          \`width:\${Math.round(avatarWidth)}px\`,
          \`height:\${Math.round(avatarHeight)}px\`,
          \`background-size:\${256 * avatarScale}px \${160 * avatarScale}px\`,
          \`background-position:-\${avatar.x * avatarScale}px -\${avatar.y * avatarScale}px\`,
          \`--appearance-body:\${agent.appearance.body}\`,
          \`--appearance-shadow:\${agent.appearance.shadow}\`
        ].join(";");
        return \`<div class="waiting-agent" tabindex="0" style="left:\${Math.round(x)}px; top:\${Math.round(y)}px;"><div class="office-avatar state-waiting" style="\${avatarStyle}"></div><div class="speech-bubble waiting" style="left:\${Math.round(avatarWidth / 2)}px; top:-10px;">...</div>\${renderAgentHover(snapshot, agent).replace("agent-hover", "waiting-hover")}</div>\`;
      }

      function renderRestingAvatar(snapshot, agent, index, compact, recRoomWidth) {
        const avatar = avatarForAgent(agent);
        const avatarScale = compact ? 1.25 : 1.5;
        const avatarWidth = avatar.w * avatarScale;
        const avatarHeight = avatar.h * avatarScale;
        const slot = loungeSlotAt(index, compact, recRoomWidth);
        const transforms = [];
        if (slot.settle) {
          transforms.push("translateY(3px)");
        }
        if (slot.flip) {
          transforms.push("scaleX(-1)");
        }
        const avatarStyle = [
          "left:0",
          "top:0",
          \`width:\${Math.round(avatarWidth)}px\`,
          \`height:\${Math.round(avatarHeight)}px\`,
          \`background-size:\${256 * avatarScale}px \${160 * avatarScale}px\`,
          \`background-position:-\${avatar.x * avatarScale}px -\${avatar.y * avatarScale}px\`,
          \`--appearance-body:\${agent.appearance.body}\`,
          \`--appearance-shadow:\${agent.appearance.shadow}\`,
          transforms.length > 0 ? \`transform:\${transforms.join(" ")}\` : ""
        ].filter(Boolean).join(";");
        const bubble = slot.bubble
          ? \`<div class="speech-bubble resting" style="left:\${Math.round(avatarWidth / 2)}px; top:-10px;">\${escapeHtml(slot.bubble)}</div>\`
          : "";
        return \`<div class="lounge-agent" tabindex="0" style="left:\${Math.round(slot.x)}px; top:\${Math.round(slot.y)}px;"><div class="office-avatar state-\${agent.state}" style="\${avatarStyle}"></div>\${bubble}\${renderAgentHover(snapshot, agent).replace("agent-hover", "lounge-hover")}</div>\`;
      }

      function renderRoomScene(snapshot, options = {}) {
        const rooms = flattenRooms(snapshot.rooms.rooms);
        if (rooms.length === 0) {
          return '<div class="empty">No rooms configured.</div>';
        }

        const compact = options.compact === true;
        const tile = compact ? 18 : 24;
        const baseMaxX = Math.max(...rooms.map((room) => room.x + room.width), 24);
        const maxY = Math.max(...rooms.map((room) => room.y + room.height), 16);
        const waitingAgents = snapshot.agents.filter((agent) => agent.state === "waiting" && agent.source !== "cloud");
        const restingAgents = restingAgentsFor(snapshot, compact, options.liveOnly === true);
        const restingAgentIds = new Set(restingAgents.map((agent) => agent.id));
        const loungeVisibleCount = waitingAgents.length + restingAgents.length;
        const recRoomWidth = loungeVisibleCount === 0
          ? 0
          : restingAgents.length > 0
          ? (compact ? 12 * tile : 14 * tile)
          : (compact ? 9 * tile : 10 * tile);
        const recRoomHeight = Math.max(compact ? 126 : 168, 6 * tile);
        const sceneWidth = baseMaxX * tile + (recRoomWidth > 0 ? recRoomWidth + tile : 0);

        const html = rooms.map((room) => {
          const occupants = snapshot.agents.filter(
            (agent) => agent.roomId === room.id
              && agent.source !== "cloud"
              && agent.state !== "waiting"
              && !restingAgentIds.has(agent.id)
          );
          const roomPixelWidth = room.width * tile;
          const roomPixelHeight = room.height * tile;
          const stageHeight = roomPixelHeight - 26;
          const leadBoothWidth = compact ? 78 : 104;
          const leadBoothHeight = compact ? 54 : 72;
          const childBoothWidth = compact ? 52 : 70;
          const childBoothHeight = compact ? 40 : 52;
          const gapX = compact ? 8 : 12;
          const gapY = compact ? 10 : 14;
          const paddingX = compact ? 8 : 12;
          const childBottom = Array.isArray(room.children) && room.children.length > 0
            ? Math.max(...room.children.map((child) => ((child.y - room.y) + child.height) * tile))
            : 0;
          const basePaddingTop = compact ? 40 : 52;
          const clusterLabels = [];
          const boothHtml = [];
          const clusterLayouts = buildLeadClusters(occupants)
            .map((cluster) => buildClusterLayout(cluster, compact, leadBoothWidth, leadBoothHeight, childBoothWidth, childBoothHeight));
          const centerSingleCluster = clusterLayouts.length === 1;
          const maxClusterHeight = clusterLayouts.length > 0
            ? Math.max(...clusterLayouts.map((cluster) => cluster.height))
            : leadBoothHeight;
          const paddingTop = Math.min(
            Math.max(basePaddingTop, childBottom + (compact ? 18 : 24)),
            Math.max(basePaddingTop, stageHeight - maxClusterHeight - 10)
          );
          let cursorX = paddingX;
          let cursorY = paddingTop;
          let rowHeight = 0;

          clusterLayouts.forEach((cluster) => {
            if (cursorX > paddingX && cursorX + cluster.width > roomPixelWidth - paddingX) {
              cursorX = paddingX;
              cursorY += rowHeight + gapY;
              rowHeight = 0;
            }

            const clusterX = centerSingleCluster
              ? Math.round((roomPixelWidth - cluster.width) / 2)
              : cursorX;
            const clusterY = cursorY;
            const leadY = clusterY + Math.max(0, cluster.height - leadBoothHeight);
            cursorX += centerSingleCluster ? 0 : cluster.width + gapX;
            rowHeight = Math.max(rowHeight, cluster.height);

            clusterLabels.push(
              \`<div class="lead-banner" style="left:\${clusterX}px; top:\${Math.max(8, clusterY - (compact ? 18 : 22))}px; border-color:\${roleTone(agentRole(cluster.lead))};">\${escapeHtml(cluster.lead.label)} · \${escapeHtml(agentRankLabel(snapshot, cluster.lead))}</div>\`
            );
            boothHtml.push(
              renderBooth(
                snapshot,
                cluster.lead,
                agentRole(cluster.lead),
                clusterX,
                leadY,
                leadBoothWidth,
                leadBoothHeight,
                compact,
                { lead: true, liveOnly: options.liveOnly }
              )
            );

            cluster.groups.forEach((group) => {
              const tagX = clusterX + group.x;
              const tagY = clusterY + group.y;
              const stationLabel = \`\${stationRoleLabel(group.role, group.agents.length)}\${group.agents.length > 1 ? \` ×\${group.agents.length}\` : ""}\`;
              if (group.showLabel) {
                clusterLabels.push(
                  \`<div class="station-tag" style="left:\${tagX}px; top:\${tagY}px; --station-tone:\${roleTone(group.role)};">\${escapeHtml(stationLabel)}</div>\`
                );
              }

              group.agents.forEach((child, childIndex) => {
                const childColumn = childIndex % group.columns;
                const childRow = Math.floor(childIndex / group.columns);
                const childX = tagX + childColumn * (childBoothWidth + 6);
                const childY = tagY + group.labelOffset + childRow * (childBoothHeight + 6);
                boothHtml.push(
                  renderBooth(
                    snapshot,
                    child,
                    agentRole(child),
                    childX,
                    childY,
                    childBoothWidth,
                    childBoothHeight,
                    compact,
                    { liveOnly: options.liveOnly }
                  )
                );
              });
            });
          });

          const ghosts = departingAgents.filter(
            (ghost) => ghost.projectRoot === snapshot.projectRoot && ghost.roomId === room.id && ghost.expiresAt > Date.now()
          );
          ghosts.forEach((ghost, index) => {
            boothHtml.push(
              renderBooth(
                snapshot,
                ghost.agent,
                agentRole(ghost.agent),
                paddingX + index * (compact ? 18 : 22),
                Math.max(paddingTop, stageHeight - (compact ? 54 : 72)),
                compact ? 58 : 76,
                compact ? 44 : 56,
                compact,
                { departing: true }
              )
            );
          });

          const decor = [roomSkyHtml(roomPixelWidth, compact)];
          const windowScale = compact ? 0.82 : 0.96;
          const calendarScale = compact ? 0.94 : 1.08;
          const plantScale = compact ? 0.9 : 1.06;
          const bookshelfScale = compact ? 0.74 : 0.88;
          if (room.width >= 7) {
            decor.push(renderSprite(pixelOffice.props.windowLeft, 18, compact ? 12 : 16, windowScale, "office-sprite", "z-index:2; opacity:0.92;"));
          }
          if (room.width >= 8) {
            decor.push(renderSprite(pixelOffice.props.windowRight, 18 + pixelOffice.props.windowLeft.w * windowScale + 8, compact ? 12 : 16, windowScale, "office-sprite", "z-index:2; opacity:0.92;"));
          }
          if (room.width >= 9) {
            decor.push(renderSprite(pixelOffice.props.calendar, roomPixelWidth - pixelOffice.props.calendar.w * calendarScale - 14, compact ? 12 : 16, calendarScale, "office-sprite", "z-index:2;"));
          }
          if (room.width >= 10) {
            decor.push(renderSprite(pixelOffice.props.plant, roomPixelWidth - pixelOffice.props.plant.w * plantScale - 16, compact ? 26 : 34, plantScale, "office-sprite", "z-index:2;"));
          }
          if (room.width >= 12) {
            decor.push(renderSprite(pixelOffice.props.bookshelf, roomPixelWidth - pixelOffice.props.bookshelf.w * bookshelfScale - 18, compact ? 40 : 52, bookshelfScale, "office-sprite", "z-index:2; opacity:0.96;"));
          }

          const empty = occupants.length === 0
            ? (options.liveOnly
              ? '<div class="room-empty">No live agent activity here right now.</div>'
              : '<div class="room-empty">No mapped agent activity here yet.</div>')
            : "";

          return \`<div class="room" style="left:\${room.x * tile}px; top:\${room.y * tile}px; width:\${roomPixelWidth}px; height:\${roomPixelHeight}px;"><div class="room-meta"><div class="room-head">\${escapeHtml(room.name)} <span class="muted">[\${escapeHtml(room.path)}]</span></div><span class="muted">\${occupants.length} active agent\${occupants.length === 1 ? "" : "s"}</span></div><div class="room-stage"><div class="room-mural"></div><div class="room-floor"></div>\${decor.join("")}\${clusterLabels.join("")}\${boothHtml.join("")}\${empty}</div></div>\`;
        }).join("");

        const recRoomHtml = loungeVisibleCount === 0
          ? ""
          : \`<div class="rec-room" style="left:\${baseMaxX * tile + tile}px; top:\${tile}px; width:\${recRoomWidth}px; height:\${recRoomHeight}px;"><div class="room-meta"><div class="room-head">Rec Room</div><span class="muted">\${escapeHtml(loungeMetaLabel(waitingAgents.length, restingAgents.length))}</span></div><div class="room-stage"><div class="room-floor" style="height:68%; background:repeating-linear-gradient(180deg, #2aa3e5 0 10px, #1b8fd0 10px 20px);"></div><div class="lounge-rug"></div><div class="lounge-zone">\${roomSkyHtml(recRoomWidth - 20, compact)}\${renderSprite(pixelOffice.props.bookshelf, 8, compact ? 22 : 28, compact ? 0.92 : 1.08, "office-sprite", "z-index:2;")}\${renderSprite(pixelOffice.props.cooler, compact ? 58 : 72, compact ? 34 : 42, compact ? 1.6 : 1.9, "office-sprite", "z-index:3;")}\${renderSprite(pixelOffice.props.deskWide, compact ? 84 : 108, compact ? 36 : 48, compact ? 1.2 : 1.48, "office-sprite", "z-index:3;")}\${renderSprite(pixelOffice.props.mug, compact ? 110 : 140, compact ? 30 : 37, compact ? 1.2 : 1.36, "office-sprite", "z-index:4;")}\${renderSprite(pixelOffice.props.badge, compact ? 127 : 160, compact ? 31 : 38, compact ? 1.18 : 1.36, "office-sprite", "z-index:4;")}\${renderSprite(pixelOffice.props.windowRight, compact ? 92 : 116, compact ? 14 : 18, compact ? 0.92 : 1.05, "office-sprite", "z-index:2; opacity:0.9;")}\${renderSprite(pixelOffice.props.plant, compact ? 156 : 196, compact ? 30 : 40, compact ? 1 : 1.12, "office-sprite", "z-index:3;")}\${renderSprite(pixelOffice.props.sofaOrange, recRoomWidth - (compact ? 110 : 132), compact ? 34 : 44, compact ? 1.6 : 1.88, "office-sprite", "z-index:2;")}\${renderSprite(pixelOffice.props.vending, recRoomWidth - (compact ? 48 : 60), compact ? 22 : 28, compact ? 1.1 : 1.28, "office-sprite", "z-index:3;")}\${restingAgents.map((agent, index) => renderRestingAvatar(snapshot, agent, index, compact, recRoomWidth)).join("")}</div><div class="waiting-lane">\${waitingAgents.map((agent, index) => renderWaitingAvatar(snapshot, agent, 12 + index * (compact ? 34 : 42), compact ? 42 : 52, compact)).join("")}</div></div></div>\`;

        const hint = options.showHint === false
          ? ""
          : (options.liveOnly
            ? '<div class="muted">Showing current workload only. Active parent sessions act as mini-boss desks and live subagents cluster under them.</div>'
            : '<div class="muted">Room shells come from the project XML, while booths are generated live from Codex sessions and grouped by parent session and subagent role.</div>');
        const sceneClass = compact ? "scene-grid compact" : "scene-grid";

        return \`<div class="scene-shell">\${hint}<div class="scene-fit \${compact ? "compact" : ""}" data-scene-fit><div class="\${sceneClass}" data-scene-grid style="width:\${sceneWidth}px; height:\${maxY * tile}px;">\${html}\${recRoomHtml}</div></div></div>\`;
      }

      function renderTerminalSnapshot(snapshot) {
        const rooms = flattenRooms(snapshot.rooms.rooms);
        const lines = [
          \`$ codex-agents-office watch \${projectLabel(snapshot.projectRoot)}\`,
          "",
          \`PROJECT \${projectLabel(snapshot.projectRoot)}\`,
          \`UPDATED \${snapshot.generatedAt}\`,
          ""
        ];

        for (const room of rooms) {
          const occupants = snapshot.agents.filter((agent) => agent.roomId === room.id);
          lines.push(\`ROOM \${room.id}  path=\${room.path}  size=\${room.width}x\${room.height}  occupants=\${occupants.length}\`);
          if (occupants.length === 0) {
            lines.push("  (empty)");
          } else {
            for (const agent of occupants) {
              const leader = parentLabelFor(snapshot, agent);
              lines.push(\`  [\${agent.state}] \${agentRankLabel(snapshot, agent)}/\${agentRole(agent)} :: \${agent.label} :: \${agent.detail}\${leader ? \` :: lead=\${leader}\` : ""}\`);
            }
          }
          lines.push("");
        }

        const cloudAgents = snapshot.agents.filter((agent) => agent.source === "cloud");
        lines.push(\`CLOUD \${cloudAgents.length}\`);
        if (cloudAgents.length === 0) {
          lines.push("  (none)");
        } else {
          for (const agent of cloudAgents) {
            lines.push(\`  [cloud] \${agentRole(agent)} :: \${agent.label} :: \${agent.detail}\`);
          }
        }

        if (snapshot.notes.length > 0) {
          lines.push("", "NOTES");
          for (const note of snapshot.notes) {
            lines.push(\`  ! \${note}\`);
          }
        }

        const html = lines.map((line) => {
          const className = line.startsWith("$ ") ? "terminal-hot"
            : line.startsWith("  ! ") ? "terminal-warn"
            : /^[A-Z]/.test(line) ? "terminal-dim"
            : "";
          return \`<div class="\${className}">\${escapeHtml(line)}</div>\`;
        }).join("");

        return \`<div class="terminal-shell">\${html}</div>\`;
      }

      function renderWorkspaceScroll(projects) {
        if (projects.length === 0) {
          return '<div class="empty">No tracked workspaces right now.</div>';
        }

        return \`<div class="workspace-scroll">\${projects.map((snapshot) => {
          const counts = countsForSnapshot(snapshot);
          const body = state.view === "terminal"
            ? renderTerminalSnapshot(snapshot)
            : renderRoomScene(snapshot, { showHint: false, compact: true, liveOnly: state.activeOnly });
          const notes = snapshot.notes.join(" | ");
          return \`<section class="workspace-card compact"><div class="workspace-head"><div class="workspace-title"><strong title="\${escapeHtml(snapshot.projectRoot)}">\${escapeHtml(projectLabel(snapshot.projectRoot))}</strong><div class="muted">\${counts.total} agents · \${counts.active} active · \${counts.waiting} waiting · \${counts.blocked} blocked · \${counts.cloud} cloud</div>\${notes ? \`<div class="muted">\${escapeHtml(notes)}</div>\` : ""}</div><button data-project-root="\${escapeHtml(snapshot.projectRoot)}" data-action="select-project">Open</button></div>\${body}</section>\`;
        }).join("")}</div>\`;
      }

      function renderFleetTerminal(fleet) {
        const lines = ["$ codex-agents-office fleet", ""];
        for (const snapshot of fleet.projects) {
          const counts = countsForSnapshot(snapshot);
          lines.push(\`PROJECT \${projectLabel(snapshot.projectRoot)}\`);
          lines.push(\`  total=\${counts.total} active=\${counts.active} waiting=\${counts.waiting} blocked=\${counts.blocked} cloud=\${counts.cloud}\`);
          if (snapshot.notes.length > 0) {
            for (const note of snapshot.notes) {
              lines.push(\`  ! \${note}\`);
            }
          }
          lines.push("");
        }

        return \`<div class="terminal-shell">\${lines.map((line) => {
          const className = line.startsWith("$ ") ? "terminal-hot"
            : line.startsWith("  ! ") ? "terminal-warn"
            : /^[A-Z]/.test(line) ? "terminal-dim"
            : "";
          return \`<div class="\${className}">\${escapeHtml(line)}</div>\`;
        }).join("")}</div>\`;
      }

      function renderSessions(snapshot) {
        if (!snapshot || snapshot.agents.length === 0) {
          return state.activeOnly
            ? '<div class="empty">No live sessions in the selected workspace right now.</div>'
            : '<div class="empty">No sessions found for the selected project.</div>';
        }

        const sorted = [...snapshot.agents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        return sorted.map((agent) => {
          const primaryAction = agent.threadId
            ? \`<button data-action="copy-resume" data-command="\${escapeHtml(agent.resumeCommand || "")}">Copy resume</button>\`
            : agent.url
            ? \`<a href="\${escapeHtml(agent.url)}" target="_blank" rel="noreferrer"><button>Open task</button></a>\`
            : '<span class="muted">No jump target</span>';
          const appearanceAction = \`<button data-action="cycle-look" data-project-root="\${escapeHtml(snapshot.projectRoot)}" data-agent-id="\${escapeHtml(agent.id)}">Cycle look</button>\`;

          const location = relativeLocation(snapshot.projectRoot, agent.cwd || agent.url || "");
          const parentLabel = parentLabelFor(snapshot, agent);
          const leaderText = parentLabel ? \` · lead=\${escapeHtml(parentLabel)}\` : "";
          return \`<article class="session-card"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start;"><div><strong>\${escapeHtml(agent.label)}</strong><div class="muted">\${escapeHtml(agentRankLabel(snapshot, agent))} · \${escapeHtml(agentRole(agent))} · [\${escapeHtml(agent.state)}] \${escapeHtml(agent.detail)}</div></div><span class="muted">\${escapeHtml(agent.appearance.label)}</span></div><div class="inline-code" style="margin-top:8px;">\${escapeHtml(location)}</div><div class="inline-code" style="margin-top:6px;">room=\${escapeHtml(agent.roomId || "cloud")} · source=\${escapeHtml(agent.sourceKind)}\${leaderText}</div><div class="inline-code" style="margin-top:6px;">updated=\${escapeHtml(agent.updatedAt)}</div><div class="card-actions">\${primaryAction}\${appearanceAction}</div></article>\`;
        }).join("");
      }

      function renderFleetSessions(projects) {
        const entries = projects.flatMap((snapshot) =>
          snapshot.agents.map((agent) => ({ snapshot, agent }))
        );

        if (entries.length === 0) {
          return state.activeOnly
            ? '<div class="empty">No live sessions across the tracked workspaces right now.</div>'
            : '<div class="empty">No sessions found across the tracked workspaces.</div>';
        }

        entries.sort((left, right) => right.agent.updatedAt.localeCompare(left.agent.updatedAt));
        return entries.map(({ snapshot, agent }) => {
          const primaryAction = agent.threadId
            ? \`<button data-action="copy-resume" data-command="\${escapeHtml(agent.resumeCommand || "")}">Copy resume</button>\`
            : agent.url
            ? \`<a href="\${escapeHtml(agent.url)}" target="_blank" rel="noreferrer"><button>Open task</button></a>\`
            : '<span class="muted">No jump target</span>';
          const appearanceAction = \`<button data-action="cycle-look" data-project-root="\${escapeHtml(snapshot.projectRoot)}" data-agent-id="\${escapeHtml(agent.id)}">Cycle look</button>\`;
          const location = relativeLocation(snapshot.projectRoot, agent.cwd || agent.url || "");
          const parentLabel = parentLabelFor(snapshot, agent);
          const leaderText = parentLabel ? \` · lead=\${escapeHtml(parentLabel)}\` : "";
          return \`<article class="session-card"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start;"><div><strong>\${escapeHtml(agent.label)}</strong><div class="muted">\${escapeHtml(projectLabel(snapshot.projectRoot))} · \${escapeHtml(agentRankLabel(snapshot, agent))} · \${escapeHtml(agentRole(agent))} · [\${escapeHtml(agent.state)}] \${escapeHtml(agent.detail)}</div></div><span class="muted">\${escapeHtml(agent.appearance.label)}</span></div><div class="inline-code" style="margin-top:8px;">\${escapeHtml(location)}</div><div class="inline-code" style="margin-top:6px;">room=\${escapeHtml(agent.roomId || "cloud")} · source=\${escapeHtml(agent.sourceKind)}\${leaderText}</div><div class="inline-code" style="margin-top:6px;">updated=\${escapeHtml(agent.updatedAt)}</div><div class="card-actions">\${primaryAction}\${appearanceAction}</div></article>\`;
        }).join("");
      }

      function syncLiveAgentState(projects) {
        if (!state.activeOnly) {
          enteringAgentKeys = new Set();
          liveAgentMemory.clear();
          departingAgents = [];
          return;
        }

        const now = Date.now();
        const previousKeys = new Set(liveAgentMemory.keys());
        const nextMemory = new Map();

        for (const snapshot of projects) {
          for (const agent of snapshot.agents) {
            const key = agentKey(snapshot.projectRoot, agent);
            nextMemory.set(key, {
              key,
              projectRoot: snapshot.projectRoot,
              roomId: agent.state === "waiting" ? "__rec_room__" : agent.roomId,
              agent
            });
          }
        }

        enteringAgentKeys = new Set(
          [...nextMemory.keys()].filter((key) => !previousKeys.has(key))
        );

        for (const [key, entry] of liveAgentMemory.entries()) {
          if (!nextMemory.has(key)) {
            departingAgents.push({
              ...entry,
              expiresAt: now + 420
            });
          }
        }

        departingAgents = departingAgents.filter((ghost) => ghost.expiresAt > now && !nextMemory.has(ghost.key));
        liveAgentMemory.clear();
        for (const [key, entry] of nextMemory.entries()) {
          liveAgentMemory.set(key, entry);
        }
      }

      function fitScenes() {
        const wrappers = document.querySelectorAll("[data-scene-fit]");
        wrappers.forEach((wrapper) => {
          const grid = wrapper.querySelector("[data-scene-grid]");
          if (!(wrapper instanceof HTMLElement) || !(grid instanceof HTMLElement)) {
            return;
          }

          const rawWidth = Number.parseFloat(grid.style.width || "0");
          const rawHeight = Number.parseFloat(grid.style.height || "0");
          if (!rawWidth || !rawHeight) {
            return;
          }

          const availableWidth = Math.max(wrapper.clientWidth - 4, 1);
          const availableHeight = Math.max(
            window.innerHeight * (wrapper.classList.contains("compact") ? 0.34 : 0.68),
            220
          );
          const scale = Math.min(availableWidth / rawWidth, availableHeight / rawHeight);
          const boundedScale = Number.isFinite(scale) && scale > 0
            ? Math.min(Math.max(scale, 0.2), 3.5)
            : 1;

          wrapper.style.height = \`\${Math.max(160, Math.round(rawHeight * boundedScale))}px\`;
          grid.style.transform = \`scale(\${boundedScale})\`;
        });
      }

      async function postJson(path, payload = {}) {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        return response.json();
      }

      function currentSnapshot() {
        if (!state.fleet) return null;
        if (state.selected === "all") return null;
        return state.fleet.projects.find((snapshot) => snapshot.projectRoot === state.selected) || null;
      }

      function ingestFleet(fleet) {
        state.fleet = fleet;
        if (state.selected !== "all") {
          const exists = state.fleet.projects.some((project) => project.projectRoot === state.selected);
          if (!exists) {
            state.selected = "all";
            syncUrl();
          }
        }
        render();
      }

      function render() {
        if (!state.fleet) return;

        const fleet = state.fleet;
        const displayedProjects = visibleProjects(fleet).map(viewSnapshot);
        const selectedRawSnapshot = currentSnapshot();
        const snapshot = selectedRawSnapshot ? viewSnapshot(selectedRawSnapshot) : null;
        syncLiveAgentState(displayedProjects);
        const counts = fleetCounts({ projects: displayedProjects });

        stamp.textContent = \`Updated \${fleet.generatedAt}\`;
        projectCount.textContent = state.activeOnly
          ? \`\${fleet.projects.length} tracked · \${displayedProjects.filter((project) => busyCount(project) > 0).length} live\`
          : \`\${fleet.projects.length} tracked\`;
        mapViewButton.classList.toggle("active", state.view === "map");
        terminalViewButton.classList.toggle("active", state.view === "terminal");
        activeOnlyButton.classList.toggle("active", state.activeOnly);
        setConnection(state.connection);

        kpis.innerHTML = [
          ["Agents", counts.total],
          ["Active", counts.active],
          ["Waiting", counts.waiting],
          ["Blocked", counts.blocked],
          ["Cloud", counts.cloud]
        ].map(([label, value]) => \`<div class="kpi"><div class="muted">\${label}</div><strong>\${value}</strong></div>\`).join("");

        projectTabs.innerHTML = [
          \`<button class="project-tab\${state.selected === "all" ? " active" : ""}" data-action="select-project" data-project-root="all">All</button>\`,
          ...visibleProjects(fleet).map((project) => {
            const counts = countsForSnapshot(viewSnapshot(project));
            const activeClass = project.projectRoot === state.selected ? " active" : "";
            const badge = state.activeOnly ? busyCount(project) : counts.total;
            return \`<button class="project-tab\${activeClass}" data-action="select-project" data-project-root="\${escapeHtml(project.projectRoot)}" title="\${escapeHtml(project.projectRoot)}">\${escapeHtml(projectLabel(project.projectRoot))} <span class="muted">\${badge}</span></button>\`;
          })
        ].join("");

        if (!snapshot) {
          centerTitle.textContent = "All Workspaces";
          centerContent.innerHTML = renderWorkspaceScroll(displayedProjects);
          sessionList.innerHTML = renderFleetSessions(displayedProjects);
          roomsPath.textContent = state.activeOnly ? "Current workload across tracked workspaces" : "All workspaces";
          fitScenes();
          return;
        }

        centerTitle.textContent = projectLabel(snapshot.projectRoot);
        centerContent.innerHTML = state.view === "terminal"
          ? renderTerminalSnapshot(snapshot)
          : renderRoomScene(snapshot, { liveOnly: state.activeOnly });
        sessionList.innerHTML = renderSessions(snapshot);
        roomsPath.textContent = snapshot.rooms.generated ? "Auto rooms" : ".codex-agents/rooms.xml";
        fitScenes();
      }

      async function refreshFleet() {
        const response = await fetch("/api/fleet");
        ingestFleet(await response.json());
      }

      function connectEvents() {
        if (events) {
          events.close();
        }

        setConnection("connecting");
        events = new EventSource("/api/events");
        events.addEventListener("open", () => {
          setConnection("live");
        });
        events.addEventListener("fleet", (event) => {
          ingestFleet(JSON.parse(event.data));
          setConnection("live");
        });
        events.addEventListener("error", () => {
          setConnection(navigator.onLine === false ? "offline" : "reconnecting");
        });
      }

      document.body.addEventListener("click", async (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest("[data-action], [data-view]") : null;
        if (!(target instanceof HTMLElement)) return;

        if (target.dataset.view) {
          setView(target.dataset.view);
          return;
        }

        const action = target.dataset.action;
        if (action === "select-project" && target.dataset.projectRoot) {
          setSelection(target.dataset.projectRoot);
          return;
        }

        if (action === "copy-resume" && target.dataset.command) {
          await navigator.clipboard.writeText(target.dataset.command);
          target.textContent = "Copied";
          setTimeout(() => { target.textContent = "Copy resume"; }, 1200);
          return;
        }

        if (action === "cycle-look" && target.dataset.projectRoot && target.dataset.agentId) {
          await postJson("/api/appearance/cycle", {
            projectRoot: target.dataset.projectRoot,
            agentId: target.dataset.agentId
          });
        }
      });

      refreshButton.addEventListener("click", async () => {
        ingestFleet(await postJson("/api/refresh"));
      });
      activeOnlyButton.addEventListener("click", () => {
        setActiveOnly(!state.activeOnly);
      });
      scaffoldButton.addEventListener("click", async () => {
        const snapshot = currentSnapshot();
        const projectRoot = snapshot ? snapshot.projectRoot : configuredProjects[0]?.root;
        if (!projectRoot) return;
        await postJson("/api/rooms/scaffold", { projectRoot });
        ingestFleet(await postJson("/api/refresh"));
      });

      if (!screenshotMode) {
        window.addEventListener("online", () => setConnection("reconnecting"));
        window.addEventListener("offline", () => setConnection("offline"));
      }
      window.addEventListener("resize", () => fitScenes());

      refreshFleet()
        .then(() => {
          if (screenshotMode) {
            setConnection("snapshot");
            return;
          }
          connectEvents();
        })
        .catch(() => setConnection("offline"));
    </script>
  </body>
</html>`;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServerOptions,
  service: FleetLiveService
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/assets/")) {
    await sendStaticAsset(response, url.pathname.slice("/assets/".length), request.method);
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
    if (request.method === "HEAD") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end();
      return;
    }

    sendHtml(response, renderHtml(options));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/fleet") {
    sendJson(response, 200, await service.getFleet());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    service.registerSse(response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/appearance/cycle") {
    const payload = await readJsonBody(request);
    if (typeof payload.projectRoot !== "string" || typeof payload.agentId !== "string") {
      sendJson(response, 400, { error: "projectRoot and agentId are required" });
      return;
    }

    await service.cycleAppearance(payload.projectRoot, payload.agentId);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/rooms/scaffold") {
    const payload = await readJsonBody(request);
    if (typeof payload.projectRoot !== "string") {
      sendJson(response, 400, { error: "projectRoot is required" });
      return;
    }

    const filePath = await service.scaffoldRooms(payload.projectRoot);
    sendJson(response, 200, { ok: true, filePath });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/refresh") {
    sendJson(response, 200, await service.refreshAll());
    return;
  }

  notFound(response);
}

export async function startWebServer(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const service = new FleetLiveService(options.projects);
  await service.start();
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, service).catch((error) => {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(options.port, options.host, () => {
      resolvePromise();
    });
  });

  console.log(
    `Codex Agents Office web listening on http://${options.host}:${options.port} for ${options.projects
      .map((project) => project.root)
      .join(", ")}`
  );

  const shutdown = () => {
    void service.stop().finally(() => {
      server.close();
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (require.main === module) {
  void startWebServer();
}
