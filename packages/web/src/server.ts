import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { cwd, env } from "node:process";
import { basename, extname, normalize, resolve } from "node:path";

import {
  canonicalizeProjectPath,
  cycleAgentAppearance,
  discoverProjects,
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
  explicitProjects: boolean;
}

interface ServerMeta {
  pid: number;
  startedAt: string;
  buildAt: string;
  entry: string;
  host: string;
  port: number;
  explicitProjects: boolean;
  projects: ProjectDescriptor[];
}

const WEB_PUBLIC_DIR = resolve(__dirname, "../public");
const SERVER_STARTED_AT = new Date().toISOString();
const SERVER_BUILD_AT = statSync(__filename).mtime.toISOString();

interface PixelSprite {
  url: string;
  w: number;
  h: number;
}

const PIXEL_OFFICE_SPRITES_DIR = "/assets/pixel-office/sprites";

function pixelOfficeSprite(group: string, name: string, w: number, h: number): PixelSprite {
  return {
    url: `${PIXEL_OFFICE_SPRITES_DIR}/${group}/${name}.png`,
    w,
    h
  };
}

const PIXEL_OFFICE_MANIFEST = {
  avatars: [
    { id: "nova", ...pixelOfficeSprite("avatars", "nova", 15, 23) },
    { id: "lex", ...pixelOfficeSprite("avatars", "lex", 19, 24) },
    { id: "mira", ...pixelOfficeSprite("avatars", "mira", 13, 21) },
    { id: "atlas", ...pixelOfficeSprite("avatars", "atlas", 17, 23) },
    { id: "echo", ...pixelOfficeSprite("avatars", "echo", 17, 23) }
  ],
  chairs: [
    pixelOfficeSprite("chairs", "chair-1", 11, 22),
    pixelOfficeSprite("chairs", "chair-2", 11, 22),
    pixelOfficeSprite("chairs", "chair-3", 11, 22),
    pixelOfficeSprite("chairs", "chair-4", 11, 22),
    pixelOfficeSprite("chairs", "chair-5", 11, 22),
    pixelOfficeSprite("chairs", "chair-6", 11, 22)
  ],
  props: {
    sky: pixelOfficeSprite("props", "sky", 256, 38),
    floorStrip: pixelOfficeSprite("props", "floorStrip", 73, 24),
    deskWide: pixelOfficeSprite("props", "deskWide", 40, 16),
    deskSmall: pixelOfficeSprite("props", "deskSmall", 26, 16),
    counter: pixelOfficeSprite("props", "deskWide", 40, 16),
    cabinet: pixelOfficeSprite("props", "cabinet", 26, 20),
    cubiclePanelLeft: pixelOfficeSprite("props", "cubiclePanelLeft", 17, 19),
    cubiclePanelRight: pixelOfficeSprite("props", "cubiclePanelRight", 17, 19),
    cubiclePost: pixelOfficeSprite("props", "cubiclePost", 4, 27),
    windowLeft: pixelOfficeSprite("props", "windowLeft", 26, 21),
    windowRight: pixelOfficeSprite("props", "windowRight", 26, 21),
    boothDoor: pixelOfficeSprite("props", "boothDoor", 16, 31),
    sofaGray: pixelOfficeSprite("props", "sofaGray", 33, 15),
    sofaBlue: pixelOfficeSprite("props", "sofaBlue", 33, 16),
    sofaGreen: pixelOfficeSprite("props", "sofaGreen", 33, 16),
    sofaOrange: pixelOfficeSprite("props", "sofaOrange", 33, 16),
    vending: pixelOfficeSprite("props", "vending", 24, 34),
    bookshelf: pixelOfficeSprite("props", "bookshelf", 24, 31),
    plant: pixelOfficeSprite("props", "plant", 14, 19),
    calendar: pixelOfficeSprite("props", "calendar", 17, 11),
    workstation: pixelOfficeSprite("props", "workstation", 15, 19),
    cooler: pixelOfficeSprite("props", "cooler", 9, 17),
    tower: pixelOfficeSprite("props", "tower", 6, 19),
    clock: pixelOfficeSprite("props", "clock", 19, 6),
    mug: pixelOfficeSprite("props", "mug", 7, 11),
    artWarm: pixelOfficeSprite("props", "artWarm", 12, 9),
    artUk: pixelOfficeSprite("props", "artUk", 12, 9),
    artUs: pixelOfficeSprite("props", "artUs", 12, 9),
    filePurple: pixelOfficeSprite("props", "filePurple", 11, 8),
    fileBlue: pixelOfficeSprite("props", "fileBlue", 11, 8),
    fileGreen: pixelOfficeSprite("props", "fileGreen", 11, 8),
    badge: pixelOfficeSprite("props", "badge", 9, 9),
    paper: pixelOfficeSprite("props", "paper", 11, 8),
    socket: pixelOfficeSprite("props", "socket", 10, 6),
    catBlack: pixelOfficeSprite("props", "catBlack", 13, 13),
    catSleep: pixelOfficeSprite("props", "catSleep", 24, 11)
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

  const explicitProjects = projects.length > 0;
  const uniqueProjects = Array.from(new Set(projects.length > 0 ? projects : [cwd()]));
  return {
    host,
    port: Number.isFinite(port) ? port : 4181,
    projects: buildProjectDescriptors(uniqueProjects),
    explicitProjects
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

function buildServerMeta(options: ServerOptions): ServerMeta {
  return {
    pid: process.pid,
    startedAt: SERVER_STARTED_AT,
    buildAt: SERVER_BUILD_AT,
    entry: __filename,
    host: options.host,
    port: options.port,
    explicitProjects: options.explicitProjects,
    projects: options.projects
  };
}

class FleetLiveService {
  private readonly monitors = new Map<string, ProjectLiveMonitor>();
  private readonly clients = new Set<ServerResponse>();
  private projects: ProjectDescriptor[] = [];
  private fleet: FleetResponse | null = null;

  constructor(
    private readonly seedProjects: ProjectDescriptor[],
    private readonly explicitProjects: boolean
  ) {}

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
    const discoveredProjects = await discoverProjects(50).catch(() => []);
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

function isPreviewableImage(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(filePath);
}

async function sendProjectFile(
  response: ServerResponse,
  projectRoot: string,
  filePath: string,
  method: string
): Promise<void> {
  const normalizedRoot = canonicalizeProjectPath(projectRoot) ?? resolve(projectRoot);
  const candidate = filePath.startsWith("/")
    ? resolve(filePath)
    : resolve(normalizedRoot, filePath);
  const insideProject = candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`);

  if (!insideProject || !isPreviewableImage(candidate)) {
    notFound(response);
    return;
  }

  try {
    const body = await readFile(candidate);
    response.writeHead(200, {
      "content-type": contentTypeForPath(candidate),
      "cache-control": "no-store"
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

      .session-card {
        transition: border-color 120ms linear, background 120ms linear;
      }

      .session-card:hover,
      .session-card:focus-within {
        border-color: rgba(75, 214, 159, 0.36);
        background: rgba(75, 214, 159, 0.06);
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

      .scene-notifications {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 50;
        overflow: hidden;
      }

      .agent-toast {
        position: absolute;
        display: inline-flex;
        align-items: baseline;
        gap: 5px;
        max-width: 260px;
        padding: 2px 8px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 999px;
        background: rgba(20, 30, 26, 0.8);
        color: var(--text);
        box-shadow: 0 4px 14px rgba(0,0,0,0.18);
        transform: translate(-50%, calc(-100% - 4px));
        transform-origin: bottom center;
        animation: agent-toast-float 2200ms ease-out forwards;
      }

      .agent-toast.edit {
        border-color: rgba(75, 214, 159, 0.22);
        color: #baf6dc;
      }

      .agent-toast.create {
        border-color: rgba(245, 183, 79, 0.28);
        color: #ffe1a2;
      }

      .agent-toast.run {
        border-color: rgba(115, 196, 255, 0.24);
        color: #bee8ff;
      }

      .agent-toast.waiting {
        border-color: rgba(245, 183, 79, 0.24);
        color: #ffe1a2;
      }

      .agent-toast.blocked {
        border-color: rgba(255, 120, 120, 0.28);
        color: #ffb3b3;
      }

      .agent-toast.update {
        border-color: rgba(214, 183, 255, 0.22);
        color: #ead7ff;
      }

      .agent-toast.image {
        min-width: 120px;
        padding: 3px 7px;
        gap: 6px;
      }

      .agent-toast-preview {
        width: 42px;
        height: 42px;
        flex: 0 0 42px;
        border: 2px solid rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.05);
        object-fit: cover;
        image-rendering: pixelated;
      }

      .agent-toast-copy {
        display: inline-flex;
        align-items: baseline;
        gap: 5px;
        min-width: 0;
      }

      .agent-toast-label {
        font-size: 11px;
        line-height: 1.2;
        color: currentColor;
        font-weight: 700;
      }

      .agent-toast-title {
        font-size: 11px;
        line-height: 1.2;
        color: rgba(255,255,255,0.9);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 176px;
      }

      @keyframes agent-toast-float {
        0% {
          opacity: 0;
          transform: translate(-50%, calc(-78% - 1px)) scale(0.94);
        }
        12% {
          opacity: 1;
          transform: translate(-50%, calc(-100% - 10px)) scale(1);
        }
        78% {
          opacity: 1;
          transform: translate(-50%, calc(-165% - 32px)) scale(1);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, calc(-195% - 44px)) scale(0.96);
        }
      }

      .scene-fit.compact {
        min-height: 280px;
      }

      .scene-grid {
        flex: 0 0 auto;
        position: relative;
        border: 2px solid rgba(46, 92, 123, 0.72);
        border-radius: 14px;
        min-height: 520px;
        overflow: hidden;
        box-shadow:
          inset 0 0 0 2px rgba(255,255,255,0.05),
          0 18px 40px rgba(0,0,0,0.28);
        background:
          radial-gradient(circle at 14% 8%, rgba(255,255,255,0.08), transparent 22%),
          radial-gradient(circle at 82% 4%, rgba(153, 215, 255, 0.1), transparent 20%),
          linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(180deg, #102235, #0b1b2b 62%, #071522);
        background-size: var(--tile) var(--tile);
        transform-origin: top left;
        will-change: transform;
      }

      .scene-grid.compact {
        min-height: 0;
      }

      .room {
        position: absolute;
        border: 3px solid #365a76;
        border-radius: 10px;
        background:
          linear-gradient(180deg, #96cdf9 0 15%, #dceefe 15% 16%, #ecf4fb 16% 24%, #3aa1eb 24% 25%, #1f7fcf 25% 100%);
        overflow: hidden;
        box-shadow:
          0 10px 0 rgba(0, 0, 0, 0.22),
          0 18px 28px rgba(0, 0, 0, 0.18),
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
          repeating-linear-gradient(180deg, rgba(255,255,255,0.05) 0 3px, rgba(255,255,255,0) 3px 22px);
        opacity: 0.34;
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
        background: linear-gradient(180deg, rgba(157, 214, 255, 0.48), rgba(214, 238, 255, 0.04));
        opacity: 0.52;
        pointer-events: none;
      }

      .room-floor {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 76%;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 18%),
          repeating-linear-gradient(180deg, #48a7ee 0 22px, #7eeaff 22px 24px, #2f8fdf 24px 46px, #63b6ff 46px 48px);
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
        z-index: var(--stack-order, 3);
        outline: none;
      }

      .booth:hover,
      .booth:focus-within {
        z-index: calc(var(--stack-order, 3) + 200);
      }

      .booth.lead {
        filter: drop-shadow(0 0 10px rgba(245, 183, 79, 0.22));
      }

      .cubicle-cell {
        position: absolute;
        inset: 0 auto auto 0;
        z-index: 3;
        outline: none;
      }

      .cubicle-cell:hover,
      .cubicle-cell:focus-within {
        z-index: 20;
      }

      .cubicle-cell.entering {
        z-index: 16;
      }

      .cubicle-cell.departing {
        z-index: 16;
        pointer-events: none;
      }

      .desk-shell {
        position: absolute;
        inset: 0;
      }

      .cubicle-cell.entering .desk-shell {
        animation: workstation-spawn 260ms steps(1, end) both;
      }

      .cubicle-cell.departing .desk-shell {
        animation: workstation-despawn 220ms steps(1, end) forwards;
      }

      .snapshot-mode .cubicle-cell.entering .desk-shell,
      .snapshot-mode .cubicle-cell.departing .desk-shell {
        animation: none;
        opacity: 1;
        transform: none;
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
        border-radius: 10px;
        background:
          linear-gradient(180deg, #f6dba0 0 24%, #efd8ab 24% 25%, #ffe7bc 25% 46%, #c99457 46% 47%, #b1783a 47% 100%);
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

      .rec-room.inset {
        z-index: 8;
        box-shadow:
          0 8px 0 rgba(0, 0, 0, 0.2),
          0 14px 24px rgba(0, 0, 0, 0.18),
          inset 0 0 0 2px rgba(255,255,255,0.14);
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
        background-repeat: no-repeat;
        background-position: 0 0;
        background-size: 100% 100%;
        image-rendering: pixelated;
        pointer-events: none;
      }

      .office-avatar-shell {
        position: absolute;
        z-index: 4;
        transform-origin: 50% 100%;
        transform: scaleX(var(--avatar-flip, 1));
        will-change: transform, opacity;
      }

      .office-avatar-shell.entering {
        z-index: 12;
        animation: avatar-arrive 480ms steps(6, end) both;
      }

      .office-avatar-shell.departing {
        z-index: 12;
        animation: avatar-leave 420ms steps(6, end) forwards;
      }

      .snapshot-mode .office-avatar-shell.entering,
      .snapshot-mode .office-avatar-shell.departing {
        animation: none;
        opacity: 1;
        transform: scaleX(var(--avatar-flip, 1));
      }

      .office-avatar {
        position: absolute;
        inset: 0;
        z-index: 6;
        background-repeat: no-repeat;
        background-position: 0 0;
        background-size: 100% 100%;
        image-rendering: pixelated;
        transform-origin: 50% 100%;
        filter: drop-shadow(0 3px 0 rgba(0,0,0,0.24));
        animation: var(--state-animation, none), var(--fx-animation, none);
      }

      .office-avatar::after {
        content: "";
        position: absolute;
        left: 50%;
        bottom: -2px;
        width: 58%;
        height: 2px;
        background: rgba(10, 20, 28, 0.18);
        opacity: 0.4;
        transform: translateX(-50%);
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

      .office-avatar-shell.entering .office-avatar {
        --fx-animation: avatar-flash-in 180ms steps(1, end) 1;
      }

      .office-avatar-shell.departing .office-avatar {
        --fx-animation: avatar-flash-out 180ms steps(1, end) 1;
      }

      .office-avatar.state-editing,
      .office-avatar.state-running,
      .office-avatar.state-validating,
      .office-avatar.state-scanning,
      .office-avatar.state-thinking,
      .office-avatar.state-planning,
      .office-avatar.state-delegating {
        --state-animation: worker-bob 1s steps(2, end) infinite;
      }

      .office-avatar.state-idle,
      .office-avatar.state-done {
        --state-animation: worker-idle 1.6s steps(2, end) infinite;
      }

      .office-avatar.state-blocked {
        outline: 2px solid rgba(240, 109, 94, 0.65);
        --state-animation: worker-alert 0.9s steps(2, end) infinite;
      }

      .office-avatar.state-waiting {
        outline: 2px solid rgba(245, 183, 79, 0.55);
        --state-animation: worker-idle 1.6s steps(2, end) infinite;
      }

      .office-avatar.state-cloud {
        outline: 2px solid rgba(152, 216, 255, 0.55);
        --state-animation: worker-cloud 1.2s steps(2, end) infinite;
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
        width: min(196px, calc(100vw - 20px));
        min-width: 128px;
        max-width: 196px;
        padding: 3px 4px;
        border: 2px solid rgba(13, 24, 20, 0.7);
        background: rgba(9, 17, 14, 0.95);
        color: #f4efdf;
        box-shadow: 4px 4px 0 rgba(0,0,0,0.28);
        opacity: 0;
        pointer-events: none;
        transform: translate(-50%, 6px);
        transition: opacity 90ms linear, transform 90ms linear;
      }

      .cubicle-cell:hover .agent-hover,
      .cubicle-cell:focus-within .agent-hover,
      .waiting-agent:hover .waiting-hover,
      .waiting-agent:focus-within .waiting-hover,
      .lounge-agent:hover .lounge-hover,
      .lounge-agent:focus-within .lounge-hover {
        opacity: 1;
        transform: translate(-50%, 0);
      }

      .agent-hover-title {
        font-size: 7px;
        line-height: 1.1;
        color: #fff7df;
        margin-bottom: 2px;
      }

      .agent-hover-title strong {
        display: block;
        font-size: 8px;
        line-height: 1.1;
      }

      .agent-hover-summary {
        font-size: 8px;
        line-height: 1.05;
        color: #f4efdf;
        overflow-wrap: anywhere;
      }

      .agent-hover-meta {
        margin-top: 2px;
        font-size: 7px;
        line-height: 1.1;
        color: rgba(244, 239, 223, 0.62);
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

      [data-focus-agent] {
        transition: opacity 120ms linear;
      }

      .scene-grid[data-focus-active="true"] [data-focus-agent] {
        opacity: 0.5;
      }

      .scene-grid[data-focus-active="true"] [data-focus-agent].is-focused {
        opacity: 1;
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
        padding: 4px 8px;
        font-size: 11px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        background: rgba(12, 29, 43, 0.68);
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

      @keyframes workstation-spawn {
        0% { opacity: 0; }
        18% { opacity: 1; }
        32% { opacity: 0; }
        46% { opacity: 1; }
        60% { opacity: 0; }
        76% { opacity: 1; transform: translateY(-1px); }
        100% { opacity: 1; transform: translateY(0); }
      }

      @keyframes workstation-despawn {
        0% { opacity: 1; }
        24% { opacity: 0; }
        42% { opacity: 1; }
        64% { opacity: 0; }
        82% { opacity: 1; }
        100% { opacity: 0; }
      }

      @keyframes avatar-arrive {
        0% {
          opacity: 0;
          transform: translate(var(--path-x, 0px), var(--path-y, 0px)) scaleX(var(--avatar-flip, 1));
        }
        10% {
          opacity: 1;
          transform: translate(var(--path-x, 0px), var(--path-y, 0px)) scaleX(var(--avatar-flip, 1));
        }
        100% {
          opacity: 1;
          transform: translate(0, 0) scaleX(var(--avatar-flip, 1));
        }
      }

      @keyframes avatar-leave {
        0% {
          opacity: 1;
          transform: translate(0, 0) scaleX(var(--avatar-flip, 1));
        }
        85% {
          opacity: 1;
          transform: translate(var(--path-x, 0px), var(--path-y, 0px)) scaleX(var(--avatar-flip, 1));
        }
        100% {
          opacity: 0;
          transform: translate(var(--path-x, 0px), var(--path-y, 0px)) scaleX(var(--avatar-flip, 1));
        }
      }

      @keyframes avatar-flash-in {
        0% { opacity: 0; filter: brightness(2.2) contrast(1.4) drop-shadow(0 0 0 rgba(255,255,255,0)); }
        40% { opacity: 1; filter: brightness(2.8) contrast(1.6) drop-shadow(0 0 8px rgba(255,255,255,0.82)); }
        100% { opacity: 1; filter: drop-shadow(0 3px 0 rgba(0,0,0,0.24)); }
      }

      @keyframes avatar-flash-out {
        0% { opacity: 1; filter: drop-shadow(0 3px 0 rgba(0,0,0,0.24)); }
        45% { opacity: 1; filter: brightness(2.6) contrast(1.5) drop-shadow(0 0 8px rgba(255,255,255,0.8)); }
        100% { opacity: 0.2; filter: brightness(0.9) contrast(1) drop-shadow(0 0 0 rgba(255,255,255,0)); }
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
      const initialActiveOnly = true;
      const screenshotMode = params.get("screenshot") === "1";
      if (screenshotMode) {
        document.body.classList.add("snapshot-mode");
      }
      const state = {
        fleet: null,
        selected: initialProject,
        view: initialView === "terminal" ? "terminal" : "map",
        activeOnly: initialActiveOnly,
        connection: screenshotMode ? "snapshot" : "connecting",
        focusedSessionKeys: []
      };
      let events = null;
      const liveAgentMemory = new Map();
      let renderedAgentSceneState = new Map();
      let sceneStateDraft = null;
      let enteringAgentKeys = new Set();
      let departingAgents = [];
      let notifications = [];
      let notificationTicker = null;
      const seenNotificationKeys = new Set();

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

      function rememberAgentSceneState(snapshot, agent, sceneState) {
        if (!agent || !sceneState) {
          return;
        }
        const target = sceneStateDraft || renderedAgentSceneState;
        target.set(agentKey(snapshot.projectRoot, agent), sceneState);
      }

      function roomEntranceLayout(roomPixelWidth, compact) {
        const doorScale = compact ? 1.42 : 1.7;
        const clockScale = compact ? 0.92 : 1.08;
        const centerDoorY = compact ? 26 : 34;
        return {
          doorScale,
          clockScale,
          centerDoorX: Math.round(roomPixelWidth / 2 - pixelOffice.props.boothDoor.w * doorScale),
          centerDoorY,
          entryX: Math.round(roomPixelWidth / 2),
          entryY: Math.round(centerDoorY + pixelOffice.props.boothDoor.h * doorScale + (compact ? 2 : 3))
        };
      }

      function agentPathDelta(entrance, targetX, targetY, avatarWidth, avatarHeight) {
        const startX = Math.round(entrance.entryX - avatarWidth / 2);
        const startY = Math.round(entrance.entryY - avatarHeight + 2);
        return {
          pathX: startX - targetX,
          pathY: startY - targetY
        };
      }

      function motionShellClass(mode) {
        return mode ? \`office-avatar-shell \${mode}\` : "office-avatar-shell";
      }

      const mapViewButton = document.getElementById("map-view-button");
      const terminalViewButton = document.getElementById("terminal-view-button");
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
        url.searchParams.delete("history");
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

      function isRecentLeadCandidate(agent) {
        return agent.source !== "cloud"
          && agent.source !== "presence"
          && !agent.parentThreadId
          && Boolean(agent.threadId || agent.source === "claude");
      }

      function recentLeadAgents(snapshot, limit = 4) {
        const activeIds = new Set(snapshot.agents.filter(isBusyAgent).map((agent) => agent.id));
        return [...snapshot.agents]
          .filter((agent) => isRecentLeadCandidate(agent) && !activeIds.has(agent.id))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, limit);
      }

      function busyCount(snapshot) {
        return snapshot.agents.filter(isBusyAgent).length;
      }

      function viewSnapshot(snapshot) {
        const activeAgents = snapshot.agents.filter(isBusyAgent);
        const recentLeads = recentLeadAgents(snapshot, 4);
        return {
          ...snapshot,
          agents: [...activeAgents, ...recentLeads]
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
        if (agent.source === "cloud") {
          return "cloud";
        }
        if (agent.source === "claude") {
          return "claude";
        }
        return "default";
      }

      function titleCaseWords(value) {
        return String(value)
          .split(/\\s+/)
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
        const words = String(phrase).split(/\\s+/).filter(Boolean);
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
          && (Boolean(agent.threadId || agent.source === "claude") || childAgentsFor(snapshot, agent.id).length > 0);
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

      function focusAgentKey(snapshot, agent) {
        return agentKey(snapshot.projectRoot, agent);
      }

      function collectFocusedSessionKeys(snapshot, agent) {
        const queue = [agent.id];
        const visited = new Set(queue);
        const keys = new Set([focusAgentKey(snapshot, agent)]);
        while (queue.length > 0) {
          const currentId = queue.shift();
          for (const candidate of snapshot.agents) {
            if (candidate.parentThreadId !== currentId || visited.has(candidate.id)) {
              continue;
            }
            visited.add(candidate.id);
            queue.push(candidate.id);
            keys.add(focusAgentKey(snapshot, candidate));
          }
        }
        return [...keys];
      }

      function focusWrapperAttrs(snapshot, agent) {
        if (!agent) {
          return "";
        }
        return \` data-focus-agent="true" data-focus-key="\${escapeHtml(focusAgentKey(snapshot, agent))}"\`;
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

      function compareAgentsForDeskLayout(snapshot, left, right) {
        const leadDelta = Number(isLeadSession(snapshot, right)) - Number(isLeadSession(snapshot, left));
        if (leadDelta !== 0) {
          return leadDelta;
        }

        const depthDelta = left.depth - right.depth;
        if (depthDelta !== 0) {
          return depthDelta;
        }

        const parentDelta = String(left.parentThreadId || "").localeCompare(String(right.parentThreadId || ""));
        if (parentDelta !== 0) {
          return parentDelta;
        }

        const roleDelta = agentRole(left).localeCompare(agentRole(right));
        if (roleDelta !== 0) {
          return roleDelta;
        }

        const labelDelta = String(left.label || "").localeCompare(String(right.label || ""));
        if (labelDelta !== 0) {
          return labelDelta;
        }

        return String(left.id || "").localeCompare(String(right.id || ""));
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
          case "claude":
            return "#ffab91";
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

      function agentKindLabel(snapshot, agent) {
        const role = agentRoleLabel(agent).toLowerCase();
        if (agent.source === "cloud") {
          return \`cloud \${role}\`;
        }
        if (isLeadSession(snapshot, agent)) {
          return \`lead \${role}\`;
        }
        if (agent.parentThreadId) {
          return \`\${role} subagent\`;
        }
        return role;
      }

      function agentHoverSummary(snapshot, agent) {
        const detail = String(agent.detail || "").trim();
        const focus = primaryFocusPath(snapshot, agent);
        if (!focus) {
          return detail;
        }
        if (["Thinking", "Idle", "Finished recently", "No turns yet"].includes(detail)) {
          return \`In \${focus}\`;
        }
        return detail;
      }

      function notificationLabel(event) {
        if (!event) {
          return "";
        }
        switch (event.action) {
          case "created":
            return "Created";
          case "deleted":
            return "Deleted";
          case "moved":
            return "Moved";
          case "edited":
            return event.isImage ? "Updated" : "Edited";
          case "ran":
            return "Ran";
          case "said":
            return "Update";
          default:
            return "Changed";
        }
      }

      function notificationDescriptor(snapshot, agent, previous) {
        const event = agent.activityEvent;
        const stateChanged = !previous || previous.state !== agent.state || previous.detail !== agent.detail;
        if (!agent.isCurrent && !(stateChanged && (agent.state === "waiting" || agent.state === "blocked"))) {
          return null;
        }

        if (event && agent.isCurrent) {
          if (event.type === "fileChange") {
            return {
              kindClass: event.action === "created" ? "create" : "edit",
              label: notificationLabel(event),
              title: notificationTitle(snapshot, agent),
              imageUrl: event.isImage && event.path ? projectFileUrl(snapshot.projectRoot, event.path) : null
            };
          }

          if (event.type === "commandExecution") {
            return {
              kindClass: agent.state === "blocked" ? "blocked" : "run",
              label: agent.state === "blocked" ? "Failed" : "Ran",
              title: notificationTitle(snapshot, agent),
              imageUrl: null
            };
          }

          if (event.type === "agentMessage" && stateChanged && agent.state !== "done") {
            return {
              kindClass: "update",
              label: "Update",
              title: notificationTitle(snapshot, agent),
              imageUrl: null
            };
          }
        }

        if (!stateChanged) {
          return null;
        }

        if (agent.state === "blocked") {
          const approvalWait = /approval/i.test(agent.detail);
          return {
            kindClass: "blocked",
            label: approvalWait ? "Needs" : "Blocked",
            title: approvalWait ? "approval" : agent.detail,
            imageUrl: null
          };
        }

        if (agent.state === "waiting") {
          const inputWait = /user input/i.test(agent.detail);
          return {
            kindClass: "waiting",
            label: inputWait ? "Needs" : "Waiting",
            title: inputWait ? "input" : agent.detail,
            imageUrl: null
          };
        }

        return null;
      }

      function buildNotificationFingerprint(projectRoot, agent, descriptor) {
        return [
          projectRoot,
          agent.id,
          descriptor.kindClass,
          descriptor.label,
          descriptor.title,
          descriptor.imageUrl || ""
        ].join("::");
      }

      function notificationTitle(snapshot, agent) {
        const event = agent.activityEvent;
        if (!event) {
          return agent.detail;
        }
        if (event.path) {
          const cleaned = cleanReportedPath(snapshot.projectRoot, event.path);
          return cleaned || event.title || agent.detail;
        }
        return event.title || agent.detail;
      }

      function shortenNotificationText(value, maxLength = 44) {
        const normalized = String(value || "").replace(/\\s+/g, " ").trim();
        if (normalized.length <= maxLength) {
          return normalized;
        }
        return normalized.slice(0, maxLength - 1) + "…";
      }

      function notificationLine(descriptor) {
        const label = shortenNotificationText(descriptor.label || "", 18);
        const title = shortenNotificationText(descriptor.title || "", 46);
        return {
          label,
          title
        };
      }

      function projectFileUrl(projectRoot, path) {
        return \`/api/project-file?projectRoot=\${encodeURIComponent(projectRoot)}&path=\${encodeURIComponent(path)}\`;
      }

      function queueAgentNotifications(previousFleet, nextFleet) {
        if (!previousFleet || screenshotMode) {
          return;
        }

        const previousAgents = new Map();
        for (const snapshot of previousFleet.projects || []) {
          for (const agent of snapshot.agents || []) {
            previousAgents.set(agentKey(snapshot.projectRoot, agent), agent);
          }
        }

        for (const snapshot of nextFleet.projects || []) {
          for (const agent of snapshot.agents || []) {
            const key = agentKey(snapshot.projectRoot, agent);
            const previous = previousAgents.get(key);
            const descriptor = notificationDescriptor(snapshot, agent, previous);
            if (!descriptor) {
              continue;
            }

            const nextFingerprint = buildNotificationFingerprint(snapshot.projectRoot, agent, descriptor);
            const previousDescriptor = previous ? notificationDescriptor(snapshot, previous, null) : null;
            const previousFingerprint = previous && previousDescriptor
              ? buildNotificationFingerprint(snapshot.projectRoot, previous, previousDescriptor)
              : null;
            const nextNotificationKey = nextFingerprint + "::" + agent.updatedAt;

            if (nextFingerprint === previousFingerprint || seenNotificationKeys.has(nextNotificationKey)) {
              continue;
            }

            notifications.push({
              id: nextNotificationKey,
              key,
              projectRoot: snapshot.projectRoot,
              createdAt: Date.now(),
              kindClass: descriptor.kindClass,
              label: descriptor.label,
              title: descriptor.title,
              imageUrl: descriptor.imageUrl
            });
            seenNotificationKeys.add(nextNotificationKey);
          }
        }

        notifications = notifications.slice(-24);
        ensureNotificationTicker();
      }

      function pruneNotifications() {
        const now = Date.now();
        notifications = notifications.filter((entry) => now - entry.createdAt < 2400);
        if (notifications.length === 0 && notificationTicker) {
          clearInterval(notificationTicker);
          notificationTicker = null;
        }
      }

      function renderNotifications() {
        const wrappers = document.querySelectorAll("[data-scene-fit]");
        wrappers.forEach((wrapper) => {
          const layer = wrapper.querySelector("[data-scene-notifications]");
          if (!(wrapper instanceof HTMLElement) || !(layer instanceof HTMLElement)) {
            return;
          }

          const wrapperRect = wrapper.getBoundingClientRect();
          const selectedProject = state.selected === "all" ? null : state.selected;
          const visible = notifications.filter((entry) => {
            if (selectedProject) {
              return entry.projectRoot === selectedProject;
            }
            return true;
          });
          const stackByKey = new Map();

          layer.innerHTML = visible.map((entry) => {
            const anchor = wrapper.querySelector(\`[data-agent-key="\${CSS.escape(entry.key)}"]\`);
            if (!(anchor instanceof HTMLElement)) {
              return "";
            }
            const stackIndex = stackByKey.get(entry.key) ?? 0;
            stackByKey.set(entry.key, stackIndex + 1);
            const rect = anchor.getBoundingClientRect();
            const left = rect.left - wrapperRect.left + rect.width / 2;
            const top = rect.top - wrapperRect.top - stackIndex * 18;
            const line = notificationLine(entry);
            const image = entry.imageUrl
              ? \`<img class="agent-toast-preview" src="\${escapeHtml(entry.imageUrl)}" alt="\${escapeHtml(entry.title)}" />\`
              : "";
            return \`<div class="agent-toast \${entry.kindClass}\${entry.imageUrl ? " image" : ""}" style="left:\${Math.round(left)}px; top:\${Math.round(top)}px;"><div class="agent-toast-copy"><div class="agent-toast-label">\${escapeHtml(line.label)}</div><div class="agent-toast-title">\${escapeHtml(line.title)}</div></div>\${image}</div>\`;
          }).join("");
        });
      }

      function ensureNotificationTicker() {
        if (notificationTicker || screenshotMode) {
          return;
        }
        notificationTicker = setInterval(() => {
          pruneNotifications();
          renderNotifications();
        }, 120);
      }

      function renderAgentHover(snapshot, agent) {
        const lead = parentLabelFor(snapshot, agent);
        const summary = agentHoverSummary(snapshot, agent);
        const meta = [
          titleCaseWords(agentKindLabel(snapshot, agent)),
          lead ? \`with \${lead}\` : "",
          formatUpdatedAt(agent.updatedAt)
        ].filter(Boolean).join(" · ");

        return \`<div class="agent-hover"><div class="agent-hover-title"><strong>\${escapeHtml(agent.label)}</strong></div><div class="agent-hover-summary">\${escapeHtml(summary)}</div><div class="agent-hover-meta">\${escapeHtml(meta)}</div></div>\`;
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
        const width = Math.round(sprite.w * scale);
        const height = Math.round(sprite.h * scale);
        const style = [
          \`left:\${Math.round(x)}px\`,
          \`top:\${Math.round(y)}px\`,
          \`width:\${width}px\`,
          \`height:\${height}px\`,
          \`background-image:url(\${sprite.url})\`,
          extraStyle
        ].filter(Boolean).join(";");
        const titleAttr = title ? \` title="\${escapeHtml(title)}"\` : "";
        return \`<div class="\${className}"\${titleAttr} style="\${style}"></div>\`;
      }

      function fitSpriteToWidth(sprite, width, minScale, maxScale) {
        return Math.max(minScale, Math.min(maxScale, width / sprite.w));
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

      function computerSpriteForAgent(agent, mirrored) {
        return pixelOffice.props.workstation;
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

      function partitionAgents(agents, size) {
        const rows = [];
        for (let index = 0; index < agents.length; index += size) {
          rows.push(agents.slice(index, index + size));
        }
        return rows;
      }

      function buildClusterLayout(cluster, compact, leadBoothWidth, leadBoothHeight, childBoothWidth, childBoothHeight, availableWidth) {
        const labelHeight = compact ? 12 : 14;
        const roleGapY = compact ? 8 : 10;
        const boothGap = 6;
        const childCols = 2;
        const stripWidth = Math.min(
          availableWidth,
          Math.max(
            Math.round(leadBoothWidth * (compact ? 1.8 : 2)),
            childCols * childBoothWidth + (childCols - 1) * boothGap + (compact ? 10 : 14)
          )
        );
        const roleGroups = groupAgentsByRole(cluster.children);
        let cursorY = leadBoothHeight + (roleGroups.length > 0 ? roleGapY : 0);

        const groups = roleGroups.map((group) => {
          const columns = childCols;
          const rows = Math.max(1, Math.ceil(group.agents.length / childCols));
          const showLabel = group.agents.length > 1;
          const visibleLabelHeight = showLabel ? labelHeight + 2 : 0;
          const width = stripWidth;
          const height = visibleLabelHeight + rows * childBoothHeight + (rows - 1) * boothGap;
          const layout = {
            ...group,
            x: 0,
            y: cursorY,
            width,
            height,
            columns,
            labelHeight,
            showLabel,
            labelOffset: visibleLabelHeight
          };
          cursorY += height + roleGapY;
          return layout;
        });

        return {
          lead: cluster.lead,
          children: cluster.children,
          groups,
          width: stripWidth,
          height: groups.length > 0 ? cursorY - roleGapY : leadBoothHeight
        };
      }

      function restingAgentsFor(snapshot, compact) {
        return snapshot.agents
          .filter((agent) => agent.source !== "cloud" && (agent.state === "idle" || agent.state === "done"))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

      function chairSpriteForAgent(agent) {
        return pixelOffice.chairs[stableHash(agent.id) % pixelOffice.chairs.length];
      }

      function renderAvatarShell(snapshot, agent, state, shellStyle, avatarStyle, mode) {
        return \`<div class="\${motionShellClass(mode)}" style="\${shellStyle}"><div class="office-avatar state-\${state}" data-agent-key="\${escapeHtml(agentKey(snapshot.projectRoot, agent))}" data-agent-id="\${escapeHtml(agent.id)}" data-project-root="\${escapeHtml(snapshot.projectRoot)}" style="\${avatarStyle}"></div></div>\`;
      }

      function renderCubicleCell(snapshot, agent, role, x, y, boothWidth, boothHeight, compact, options = {}) {
        const state = agent?.state || "idle";
        const motionMode = options.motionMode || null;
        const avatar = agent ? avatarForAgent(agent) : null;
        const avatarScale = compact ? 1.25 : 1.5;
        const avatarWidth = avatar ? avatar.w * avatarScale : 0;
        const avatarHeight = avatar ? avatar.h * avatarScale : 0;
        const mirrored = options.mirrored === true;
        const chair = agent ? chairSpriteForAgent(agent) : pixelOffice.chairs[0];
        const deskSprite = pixelOffice.props.cubiclePanelLeft;
        const deskScale = fitSpriteToWidth(
          deskSprite,
          boothWidth * (options.lead ? 0.2 : 0.18),
          compact ? 1.28 : 1.42,
          compact ? 1.44 : 1.62
        );
        const computerSprite = computerSpriteForAgent(agent, mirrored);
        const workstationScale = fitSpriteToWidth(
          computerSprite,
          boothWidth * (options.lead ? 0.23 : 0.21),
          compact ? 1.32 : 1.48,
          compact ? 1.68 : 1.96
        );
        const chairScale = compact ? 1.18 : 1.34;
        const deskWidth = deskSprite.w * deskScale;
        const deskHeight = deskSprite.h * deskScale;
        const workstationWidth = computerSprite.w * workstationScale;
        const workstationHeight = computerSprite.h * workstationScale;
        const chairWidth = chair.w * chairScale;
        const chairHeight = chair.h * chairScale;
        const centerX = Math.round(boothWidth / 2);
        const innerInset = compact ? 4 : 6;
        const workstationX = mirrored
          ? innerInset
          : Math.round(boothWidth - workstationWidth - innerInset);
        const deskX = mirrored
          ? Math.max(2, Math.round(workstationX + workstationWidth * 0.54 - deskWidth * 0.52))
          : Math.max(2, Math.round(workstationX + workstationWidth * 0.48 - deskWidth * 0.5));
        const deskY = Math.round(boothHeight - deskHeight - (compact ? 11 : 13));
        const workstationY = Math.round(deskY - workstationHeight * (compact ? 0.2 : 0.18));
        const chairOutset = compact ? 3 : 5;
        const chairLift = compact ? 1 : 2;
        const chairX = (mirrored
          ? Math.round(workstationX + workstationWidth - chairWidth * 0.18)
          : Math.round(workstationX - chairWidth * 0.82))
          + (mirrored ? chairOutset : -chairOutset);
        const chairY = Math.round(deskY + deskHeight - chairHeight * 0.74) - chairLift;
        const sideX = mirrored
          ? Math.min(boothWidth - avatarWidth - 2, Math.round(deskX + deskWidth + (compact ? 6 : 8)))
          : Math.max(2, Math.round(deskX - avatarWidth - (compact ? 6 : 8)));
        const avatarPose = (() => {
          if (!agent) {
            return null;
          }
          const workstationFlip = mirrored;
          const baseY = Math.round(deskY + deskHeight - avatarHeight + (compact ? 1 : 2));
          const seatedX = mirrored
            ? Math.min(boothWidth - avatarWidth - 2, Math.round(chairX - avatarWidth * 0.22 + (compact ? 2 : 4)))
            : Math.max(2, Math.round(chairX + chairWidth * 0.22 - (compact ? 2 : 4)));
          if (state === "editing" || state === "thinking" || state === "planning" || state === "scanning" || state === "delegating") {
            return {
              x: seatedX,
              y: Math.max(0, baseY - (compact ? 1 : 3)),
              flip: workstationFlip
            };
          }
          if (state === "running" || state === "validating" || state === "blocked") {
            const workingX = mirrored
              ? Math.min(boothWidth - avatarWidth - 2, sideX + (compact ? 4 : 6))
              : Math.max(2, sideX - (compact ? 4 : 6));
            return {
              x: workingX,
              y: baseY,
              flip: workstationFlip
            };
          }
          if (state === "idle" || state === "done") {
            return {
              x: Math.max(2, Math.round(centerX - avatarWidth / 2)),
              y: Math.max(0, baseY + (compact ? 1 : 2)),
              flip: stableHash(agent.id) % 2 === 0
            };
          }
          return {
            x: sideX,
            y: baseY,
            flip: workstationFlip
          };
        })();
        const bubbleClass = state === "blocked" ? "speech-bubble blocked"
          : state === "waiting" ? "speech-bubble waiting"
          : "speech-bubble";
        const bubbleLabel = !agent ? null
          : state === "blocked" ? "!"
          : state === "waiting" ? "..."
          : state === "cloud" ? "cloud"
          : state === "validating" ? "ok"
          : null;
        const bubble = bubbleLabel && !motionMode
          ? \`<div class="\${bubbleClass}" style="left:\${Math.round((avatarPose?.x || 0) + avatarWidth / 2)}px; top:\${Math.max(0, Math.round((avatarPose?.y || 0) - 12))}px;">\${escapeHtml(bubbleLabel)}</div>\`
          : "";
        const avatarStyle = avatar && agent && avatarPose
          ? [
            \`background-image:url(\${avatar.url})\`,
            \`--appearance-body:\${agent.appearance.body}\`,
            \`--appearance-shadow:\${agent.appearance.shadow}\`
          ].filter(Boolean).join(";")
          : "";
        const monitorClass = agent && isBusyAgent(agent) && state !== "waiting" && state !== "blocked"
          ? "booth-monitor state-active"
          : "booth-monitor";

        const screenGlow = monitorClass.includes("state-active")
          ? \`<div style="position:absolute;left:\${Math.round(workstationX + workstationWidth * 0.19)}px;top:\${Math.round(workstationY + workstationHeight * 0.14)}px;width:\${Math.max(8, Math.round(workstationWidth * 0.36))}px;height:\${Math.max(5, Math.round(workstationHeight * 0.16))}px;background:rgba(75,214,159,0.3);box-shadow:0 0 10px rgba(75,214,159,0.28);pointer-events:none;z-index:7;"></div>\`
          : "";
        const absoluteCellX = Math.round(options.absoluteX ?? x);
        const absoluteCellY = Math.round(options.absoluteY ?? y);
        const avatarTargetX = avatarPose ? absoluteCellX + Math.round(avatarPose.x) : null;
        const avatarTargetY = avatarPose ? absoluteCellY + Math.round(avatarPose.y) : null;
        const entrance = options.entrance || null;
        const path = avatarPose && entrance
          ? agentPathDelta(entrance, avatarTargetX, avatarTargetY, avatarWidth, avatarHeight)
          : { pathX: 0, pathY: 0 };
        const shellStyle = avatar && agent && avatarPose
          ? [
            \`left:\${Math.round(avatarPose.x)}px\`,
            \`top:\${Math.round(avatarPose.y)}px\`,
            \`width:\${Math.round(avatarWidth)}px\`,
            \`height:\${Math.round(avatarHeight)}px\`,
            \`--avatar-flip:\${avatarPose.flip ? -1 : 1}\`,
            \`--path-x:\${Math.round(path.pathX)}px\`,
            \`--path-y:\${Math.round(path.pathY)}px\`
          ].join(";")
          : "";
        const avatarHtml = avatar && agent && avatarPose
          ? renderAvatarShell(snapshot, agent, state, shellStyle, avatarStyle, motionMode)
          : "";
        if (agent && avatar && avatarPose && entrance && motionMode !== "departing") {
          rememberAgentSceneState(snapshot, agent, {
            roomId: options.roomId || agent.roomId,
            compact,
            kind: "desk",
            cellX: absoluteCellX,
            cellY: absoluteCellY,
            cellWidth: boothWidth,
            cellHeight: boothHeight,
            mirrored,
            lead: Boolean(options.lead),
            role,
            entrance,
            avatarX: avatarTargetX,
            avatarY: avatarTargetY,
            avatarWidth: Math.round(avatarWidth),
            avatarHeight: Math.round(avatarHeight),
            avatarFlip: avatarPose.flip ? -1 : 1
          });
        }
        const deskShell = [
          renderSprite(deskSprite, deskX, deskY, deskScale, "office-sprite", \`z-index:3;\${mirrored ? "transform:scaleX(-1);transform-origin:50% 50%;" : ""}\`),
          renderSprite(chair, chairX, chairY, chairScale, "office-sprite", \`z-index:4;\${mirrored ? "transform:scaleX(-1);transform-origin:50% 50%;" : ""}\`),
          renderSprite(computerSprite, workstationX, workstationY, workstationScale, "office-sprite", \`z-index:5;\${mirrored ? "transform:scaleX(-1);transform-origin:50% 50%;" : ""}\`),
          screenGlow
        ].join("");
        const hoverHtml = agent ? renderAgentHover(snapshot, agent) : "";
        const tabIndex = agent ? "0" : "-1";
        const cellClasses = ["cubicle-cell"];
        if (motionMode) cellClasses.push(motionMode);
        return \`<div class="\${cellClasses.join(" ")}" tabindex="\${tabIndex}"\${focusWrapperAttrs(snapshot, agent)} style="left:\${Math.round(x)}px; top:\${Math.round(y)}px; width:\${boothWidth}px; height:\${boothHeight}px;"><div class="desk-shell">\${deskShell}</div>\${avatarHtml}\${bubble}\${hoverHtml}</div>\`;
      }

      function renderDeskPod(snapshot, agents, role, x, y, podWidth, podHeight, compact, options = {}) {
        const padX = compact ? 8 : 10;
        const centerGap = 0;
        const cellWidth = Math.max(compact ? 44 : 58, Math.floor((podWidth - padX * 2 - centerGap) / 2));
        const classes = ["booth"];
        if (options.lead) classes.push("lead");
        const stackOrder = 100 + Math.round(y + podHeight);
        const leftAgent = agents[0] || null;
        const rightAgent = agents[1] || null;
        const hasBothSides = Boolean(leftAgent && rightAgent);
        const singleCellX = Math.round((podWidth - cellWidth) / 2);
        const podBase = [];
        const cells = [
          leftAgent
            ? renderCubicleCell(
              snapshot,
              leftAgent,
              role,
              hasBothSides ? padX : singleCellX,
              0,
              cellWidth,
              podHeight,
              compact,
              {
                ...options,
                mirrored: false,
                lead: options.lead && Boolean(leftAgent),
                absoluteX: x + (hasBothSides ? padX : singleCellX),
                absoluteY: y,
                motionMode: options.liveOnly && enteringAgentKeys.has(agentKey(snapshot.projectRoot, leftAgent)) ? "entering" : null
              }
            )
            : "",
          rightAgent
            ? renderCubicleCell(
              snapshot,
              rightAgent,
              role,
              hasBothSides ? padX + cellWidth + centerGap : singleCellX,
              0,
              cellWidth,
              podHeight,
              compact,
              {
                ...options,
                mirrored: true,
                lead: false,
                absoluteX: x + (hasBothSides ? padX + cellWidth + centerGap : singleCellX),
                absoluteY: y,
                motionMode: options.liveOnly && enteringAgentKeys.has(agentKey(snapshot.projectRoot, rightAgent)) ? "entering" : null
              }
            )
            : ""
        ].join("");
        return \`<div class="\${classes.join(" ")}" style="left:\${Math.round(x)}px; top:\${Math.round(y)}px; width:\${podWidth}px; height:\${podHeight}px; --booth-accent:\${roleTone(role)}; --stack-order:\${stackOrder};">\${podBase.join("")}\${cells}</div>\`;
      }

      function renderCubicleRow(snapshot, agents, role, x, y, rowWidth, rowHeight, compact, options = {}) {
        const columns = Math.max(1, options.slots || agents.length);
        const padX = compact ? 6 : 8;
        const dividerGap = compact ? 10 : 14;
        const cellWidth = Math.max(compact ? 42 : 56, Math.floor((rowWidth - padX * 2 - dividerGap * (columns - 1)) / columns));
        const classes = ["booth"];
        if (options.lead) classes.push("lead");
        const stackOrder = 100 + Math.round(y + rowHeight);
        const rowBase = [];
        const mirrored = options.mirrored ?? ((options.rowIndex || 0) % 2 === 1);
        const cells = agents.map((agent, index) => {
          const cellX = padX + index * (cellWidth + dividerGap);
          return renderCubicleCell(
            snapshot,
            agent,
            role,
            cellX,
            0,
            cellWidth,
            rowHeight,
            compact,
            {
              ...options,
              mirrored,
              absoluteX: x + cellX,
              absoluteY: y,
              motionMode: options.motionMode || (options.liveOnly && enteringAgentKeys.has(agentKey(snapshot.projectRoot, agent)) ? "entering" : null)
            }
          );
        }).join("");
        return \`<div class="\${classes.join(" ")}" style="left:\${Math.round(x)}px; top:\${Math.round(y)}px; width:\${rowWidth}px; height:\${rowHeight}px; --booth-accent:\${roleTone(role)}; --stack-order:\${stackOrder};">\${rowBase.join("")}\${cells}</div>\`;
      }

      function renderBooth(snapshot, agent, role, x, y, boothWidth, boothHeight, compact, options = {}) {
        return renderCubicleRow(snapshot, [agent], role, x, y, boothWidth, boothHeight, compact, options);
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
          \`background-image:url(\${avatar.url})\`,
          \`--appearance-body:\${agent.appearance.body}\`,
          \`--appearance-shadow:\${agent.appearance.shadow}\`
        ].join(";");
        return \`<div class="waiting-agent" tabindex="0"\${focusWrapperAttrs(snapshot, agent)} style="left:\${Math.round(x)}px; top:\${Math.round(y)}px;"><div class="office-avatar state-waiting" data-agent-key="\${escapeHtml(agentKey(snapshot.projectRoot, agent))}" style="\${avatarStyle}"></div><div class="speech-bubble waiting" style="left:\${Math.round(avatarWidth / 2)}px; top:-10px;">...</div>\${renderAgentHover(snapshot, agent).replace("agent-hover", "waiting-hover")}</div>\`;
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
          \`background-image:url(\${avatar.url})\`,
          \`--appearance-body:\${agent.appearance.body}\`,
          \`--appearance-shadow:\${agent.appearance.shadow}\`,
          transforms.length > 0 ? \`transform:\${transforms.join(" ")}\` : ""
        ].filter(Boolean).join(";");
        const bubble = slot.bubble
          ? \`<div class="speech-bubble resting" style="left:\${Math.round(avatarWidth / 2)}px; top:-10px;">\${escapeHtml(slot.bubble)}</div>\`
          : "";
        return \`<div class="lounge-agent" tabindex="0"\${focusWrapperAttrs(snapshot, agent)} style="left:\${Math.round(slot.x)}px; top:\${Math.round(slot.y)}px;"><div class="office-avatar state-\${agent.state}" data-agent-key="\${escapeHtml(agentKey(snapshot.projectRoot, agent))}" style="\${avatarStyle}"></div>\${bubble}\${renderAgentHover(snapshot, agent).replace("agent-hover", "lounge-hover")}</div>\`;
      }

      function renderWallsideAvatar(snapshot, agent, x, y, compact, options = {}) {
        const motionMode = options.motionMode || null;
        const avatar = avatarForAgent(agent);
        const avatarScale = compact ? 1.25 : 1.5;
        const avatarWidth = avatar.w * avatarScale;
        const avatarHeight = avatar.h * avatarScale;
        const avatarStyle = [
          \`background-image:url(\${avatar.url})\`,
          \`--appearance-body:\${agent.appearance.body}\`,
          \`--appearance-shadow:\${agent.appearance.shadow}\`
        ].filter(Boolean).join(";");
        const targetX = Math.round(x);
        const targetY = Math.round(y + (options.settle ? 3 : 0));
        const entrance = options.entrance || null;
        const path = entrance
          ? agentPathDelta(entrance, targetX, targetY, avatarWidth, avatarHeight)
          : { pathX: 0, pathY: 0 };
        const shellStyle = [
          "left:0",
          "top:0",
          \`width:\${Math.round(avatarWidth)}px\`,
          \`height:\${Math.round(avatarHeight)}px\`,
          \`--avatar-flip:\${options.flip ? -1 : 1}\`,
          \`--path-x:\${Math.round(path.pathX)}px\`,
          \`--path-y:\${Math.round(path.pathY)}px\`
        ].join(";");
        const bubbleLabel = options.bubble ?? (
          agent.state === "waiting" ? "..."
          : agent.state === "done" ? "zZ"
          : agent.state === "idle" ? "ok"
          : null
        );
        const bubbleClass = bubbleLabel === "..."
          ? "speech-bubble waiting"
          : bubbleLabel
            ? "speech-bubble resting"
            : "";
        const bubble = bubbleLabel && !motionMode
          ? \`<div class="\${bubbleClass}" style="left:\${Math.round(avatarWidth / 2)}px; top:-10px;">\${escapeHtml(bubbleLabel)}</div>\`
          : "";
        const hoverClass = agent.state === "waiting" ? "waiting-hover" : "lounge-hover";
        const wrapperClass = agent.state === "waiting" ? "waiting-agent" : "lounge-agent";
        if (motionMode !== "departing") {
          rememberAgentSceneState(snapshot, agent, {
            roomId: options.roomId || agent.roomId,
            compact,
            kind: "wallside",
            x: targetX,
            y: targetY,
            entrance,
            bubble: options.bubble ?? null,
            flip: options.flip ? -1 : 1,
            settle: Boolean(options.settle),
            avatarWidth: Math.round(avatarWidth),
            avatarHeight: Math.round(avatarHeight)
          });
        }
        return \`<div class="\${wrapperClass}\${motionMode ? \` \${motionMode}\` : ""}" tabindex="0"\${focusWrapperAttrs(snapshot, agent)} style="left:\${Math.round(x)}px; top:\${Math.round(y)}px;">\${renderAvatarShell(snapshot, agent, agent.state, shellStyle, avatarStyle, motionMode)}\${bubble}\${renderAgentHover(snapshot, agent).replace("agent-hover", hoverClass)}</div>\`;
      }

      function wallsideWaitingSlotAt(index, compact, roomPixelWidth, walkwayY) {
        const columns = compact ? 4 : 5;
        const column = index % columns;
        const row = Math.floor(index / columns);
        const startX = compact ? 78 : 96;
        const stepX = compact ? 26 : 32;
        const stepY = compact ? 14 : 17;
        return {
          x: Math.min(roomPixelWidth - (compact ? 118 : 144), startX + column * stepX),
          y: walkwayY + (compact ? 2 : 4) + row * stepY + (column % 2 === 0 ? 0 : 2),
          flip: (index + row) % 2 === 1
        };
      }

      function wallsideRestingSlotAt(index, compact, roomPixelWidth, walkwayY) {
        const columns = compact ? 4 : 5;
        const column = index % columns;
        const row = Math.floor(index / columns);
        const startX = roomPixelWidth - (compact ? 72 : 94);
        const stepX = compact ? 24 : 30;
        const stepY = compact ? 14 : 17;
        return {
          x: Math.max(compact ? 186 : 236, startX - column * stepX),
          y: walkwayY + (compact ? 2 : 4) + row * stepY + (column % 2 === 0 ? 1 : 3),
          flip: column % 2 === 0,
          settle: row === 0 && column % 3 === 0
        };
      }

      function isUtilityRoom(room) {
        if (!room || room.path === ".") {
          return false;
        }
        const label = \`\${room.name || ""} \${room.path || ""}\`.toLowerCase();
        return ["docs", "packages"].some((segment) => label === segment || label.includes(\` \${segment}\`) || label.includes(\`/\${segment}\`));
      }

      function buildSceneRooms(rooms) {
        const visibleRooms = [];
        const roomAlias = new Map();

        function visit(room, parentVisibleId = null) {
          const suppress = parentVisibleId !== null && isUtilityRoom(room);
          const visibleId = suppress ? parentVisibleId : room.id;
          roomAlias.set(room.id, visibleId);
          if (!suppress) {
            visibleRooms.push(room);
          }
          if (Array.isArray(room.children)) {
            room.children.forEach((child) => visit(child, visibleId));
          }
        }

        rooms.forEach((room) => visit(room, null));

        const primaryRoomId = visibleRooms.find((room) => room.path === "." || room.id === "root")?.id || visibleRooms[0]?.id || null;
        visibleRooms.sort((left, right) => (right.width * right.height) - (left.width * left.height));
        return { visibleRooms, roomAlias, primaryRoomId };
      }

      function renderRoomEntranceDecor(roomPixelWidth, compact, options = {}) {
        const entrance = roomEntranceLayout(roomPixelWidth, compact);
        const plantScale = compact ? 1.08 : 1.22;
        const sprites = [
          renderSprite(pixelOffice.props.boothDoor, entrance.centerDoorX, entrance.centerDoorY, entrance.doorScale, "office-sprite", "z-index:2;"),
          renderSprite(pixelOffice.props.boothDoor, Math.round(roomPixelWidth / 2), entrance.centerDoorY, entrance.doorScale, "office-sprite", "z-index:2; transform:scaleX(-1); transform-origin:50% 50%;")
        ];
        if (options.clock !== false) {
          sprites.push(
            renderSprite(pixelOffice.props.clock, Math.round(roomPixelWidth / 2 - pixelOffice.props.clock.w * entrance.clockScale / 2), compact ? 12 : 14, entrance.clockScale, "office-sprite", "z-index:3;")
          );
        }
        if (options.plants) {
          sprites.push(
            renderSprite(pixelOffice.props.plant, entrance.centerDoorX - (compact ? 24 : 28), compact ? 48 : 60, plantScale, "office-sprite", "z-index:3;"),
            renderSprite(pixelOffice.props.plant, Math.round(roomPixelWidth / 2 + pixelOffice.props.boothDoor.w * entrance.doorScale + (compact ? 6 : 8)), compact ? 48 : 60, plantScale, "office-sprite", "z-index:3;")
          );
        }
        return {
          entrance,
          html: sprites.join("")
        };
      }

      function renderIntegratedRecArea(snapshot, primaryRoomId, waitingAgents, restingAgents, compact, roomPixelWidth) {
        const leftWindowScale = compact ? 0.82 : 0.96;
        const rightWindowScale = compact ? 0.82 : 0.96;
        const sofaScale = compact ? 1.18 : 1.42;
        const shelfScale = compact ? 0.96 : 1.12;
        const coolerScale = compact ? 1.18 : 1.36;
        const vendingScale = compact ? 1.02 : 1.16;
        const counterScale = compact ? 0.88 : 1.02;
        const baseY = compact ? 42 : 54;
        const walkwayY = compact ? 62 : 78;
        const leftWindowX = compact ? 52 : 76;
        const rightWindowX = roomPixelWidth - (compact ? 86 : 108);
        const entranceDecor = renderRoomEntranceDecor(roomPixelWidth, compact, { plants: true });
        const facilityHtml = [
          renderSprite(pixelOffice.props.windowLeft, leftWindowX, compact ? 16 : 20, leftWindowScale, "office-sprite", "z-index:2; opacity:0.92;"),
          renderSprite(pixelOffice.props.windowRight, rightWindowX, compact ? 16 : 20, rightWindowScale, "office-sprite", "z-index:2; opacity:0.92;"),
          entranceDecor.html,
          renderSprite(pixelOffice.props.vending, compact ? 10 : 14, baseY - (compact ? 2 : 4), vendingScale, "office-sprite", "z-index:3;"),
          renderSprite(pixelOffice.props.cooler, compact ? 38 : 48, baseY + (compact ? 8 : 10), coolerScale, "office-sprite", "z-index:3;"),
          renderSprite(pixelOffice.props.counter, compact ? 60 : 76, baseY + (compact ? 8 : 10), counterScale, "office-sprite", "z-index:3;"),
          renderSprite(pixelOffice.props.sofaOrange, roomPixelWidth - (compact ? 118 : 152), baseY + (compact ? 8 : 10), sofaScale, "office-sprite", "z-index:3;"),
          renderSprite(pixelOffice.props.bookshelf, roomPixelWidth - (compact ? 34 : 40), baseY - (compact ? 2 : 4), shelfScale, "office-sprite", "z-index:3;")
        ];
        const agentHtml = [
          ...waitingAgents.map((agent, index) => {
            const slot = wallsideWaitingSlotAt(index, compact, roomPixelWidth, walkwayY);
            return renderWallsideAvatar(snapshot, agent, slot.x, slot.y, compact, { flip: slot.flip, bubble: "...", entrance: entranceDecor.entrance, roomId: primaryRoomId, motionMode: enteringAgentKeys.has(agentKey(snapshot.projectRoot, agent)) ? "entering" : null });
          }),
          ...restingAgents.map((agent, index) => {
            const slot = wallsideRestingSlotAt(index, compact, roomPixelWidth, walkwayY);
            return renderWallsideAvatar(snapshot, agent, slot.x, slot.y, compact, { flip: slot.flip, settle: slot.settle, entrance: entranceDecor.entrance, roomId: primaryRoomId, motionMode: enteringAgentKeys.has(agentKey(snapshot.projectRoot, agent)) ? "entering" : null });
          })
        ];
        return facilityHtml.join("") + agentHtml.join("");
      }

      function renderRoomScene(snapshot, options = {}) {
        const sceneRooms = buildSceneRooms(snapshot.rooms.rooms);
        const rooms = sceneRooms.visibleRooms;
        if (rooms.length === 0) {
          return '<div class="empty">No rooms configured.</div>';
        }

        const compact = options.compact === true;
        const showOverlayLabels = options.showOverlayLabels === true;
        const tile = compact ? 18 : 24;
        const baseMaxX = Math.max(...rooms.map((room) => room.x + room.width), 24);
        const maxY = Math.max(...rooms.map((room) => room.y + room.height), 16);
        const waitingAgents = snapshot.agents.filter((agent) => agent.state === "waiting" && agent.source !== "cloud");
        const restingAgents = restingAgentsFor(snapshot, compact);
        const offDeskAgentIds = new Set([...waitingAgents, ...restingAgents].map((agent) => agent.id));
        const sceneWidth = baseMaxX * tile;

        const html = rooms.map((room) => {
          const isPrimaryRoom = room.id === sceneRooms.primaryRoomId;
          const roomAgentId = (agent) => sceneRooms.roomAlias.get(agent.roomId) || (agent.source === "cloud" ? "cloud" : sceneRooms.primaryRoomId);
          const occupants = snapshot.agents.filter(
            (agent) => roomAgentId(agent) === room.id
              && agent.source !== "cloud"
              && !offDeskAgentIds.has(agent.id)
          );
          const activeDeskOccupants = occupants.filter((agent) => agent.state !== "idle" && agent.state !== "done");
          const roomPixelWidth = room.width * tile;
          const roomPixelHeight = room.height * tile;
          const stageHeight = roomPixelHeight - 26;
          const entranceDecor = renderRoomEntranceDecor(roomPixelWidth, compact, { plants: isPrimaryRoom });
          const recAreaHtml = isPrimaryRoom
            ? renderIntegratedRecArea(snapshot, room.id, waitingAgents, restingAgents, compact, roomPixelWidth)
            : "";
          const podWidth = compact ? 120 : 152;
          const podHeight = compact ? 66 : 86;
          const paddingX = compact ? 8 : 12;
          const layoutWidth = Math.max(podWidth, roomPixelWidth - paddingX * 2);
          const floorBandTop = Math.round(stageHeight * (compact ? 0.24 : 0.26));
          const basePaddingTop = compact ? 48 : 56;
          const boothHtml = [];
          const orderedOccupants = [...occupants].sort((left, right) => compareAgentsForDeskLayout(snapshot, left, right));
          const pods = [];
          for (let index = 0; index < orderedOccupants.length; index += 2) {
            pods.push(orderedOccupants.slice(index, index + 2));
          }
          const columnCount = pods.length === 0
            ? 0
            : Math.min(layoutWidth >= (compact ? 260 : 320) ? 2 : 1, pods.length);
          const baseColumnSize = columnCount > 0 ? Math.floor(pods.length / columnCount) : 0;
          const extraColumns = columnCount > 0 ? pods.length % columnCount : 0;
          const columns = [];
          let podIndex = 0;
          for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const size = baseColumnSize + (columnIndex < extraColumns ? 1 : 0);
            columns.push(pods.slice(podIndex, podIndex + size));
            podIndex += size;
          }
          const columnGap = compact ? 14 : 18;
          const podGap = compact ? 14 : 18;
          const columnOffsets = compact ? [0, 10] : [0, 16];
          const usedColumns = columns.filter((column) => column.length > 0);
          const totalDeskHeight = usedColumns.length > 0
            ? Math.max(...usedColumns.map((column, columnIndex) => (
              column.length * podHeight
              + Math.max(0, column.length - 1) * podGap
              + columnOffsets[columnIndex % columnOffsets.length]
            )))
            : 0;
          const rowStartY = usedColumns.length === 0
            ? basePaddingTop
            : Math.max(
              basePaddingTop,
              Math.min(floorBandTop, stageHeight - totalDeskHeight - (compact ? 8 : 12))
            );
          const layoutTotalWidth = usedColumns.length > 0
            ? usedColumns.length * podWidth + Math.max(0, usedColumns.length - 1) * columnGap
            : 0;
          const startX = paddingX + Math.max(0, Math.floor((layoutWidth - layoutTotalWidth) / 2));
          usedColumns.forEach((columnPods, columnIndex) => {
            const columnX = startX + columnIndex * (podWidth + columnGap);
            const columnOffsetY = columnOffsets[columnIndex % columnOffsets.length];
            const columnRole = columnPods[0]?.[0] ? agentRole(columnPods[0][0]) : "default";
            if (showOverlayLabels) {
              const label = columnIndex === 0 ? "Lead column" : stationRoleLabel(columnRole, columnPods.flat().filter(Boolean).length);
              boothHtml.push(
                '<div class="' + (columnIndex === 0 ? "lead-banner" : "station-tag") + '" style="left:' + columnX + 'px; top:' + Math.max(8, rowStartY + columnOffsetY - (compact ? 18 : 22)) + 'px; ' + (columnIndex === 0 ? "border-color:" + roleTone(columnRole) + ";" : "--station-tone:" + roleTone(columnRole) + ";") + ' z-index:' + (90 + Math.round(rowStartY + columnOffsetY)) + ';">' + escapeHtml(label) + "</div>"
              );
            }
            columnPods.forEach((podAgents, rowIndex) => {
              const podY = rowStartY + columnOffsetY + rowIndex * (podHeight + podGap);
              const podRole = podAgents[0] ? agentRole(podAgents[0]) : columnRole;
              boothHtml.push(
                renderDeskPod(
                  snapshot,
                  podAgents,
                  podRole,
                  columnX,
                  podY,
                  podWidth,
                  podHeight,
                  compact,
                  {
                    lead: columnIndex === 0 && rowIndex === 0,
                    liveOnly: options.liveOnly,
                    roomId: room.id,
                    entrance: entranceDecor.entrance,
                    columnIndex,
                    rowIndex
                  }
                )
              );
            });
          });
          const paddingTop = rowStartY;

          const ghosts = departingAgents.filter(
            (ghost) => ghost.projectRoot === snapshot.projectRoot
              && (sceneRooms.roomAlias.get(ghost.sceneState?.roomId || ghost.roomId) || sceneRooms.primaryRoomId) === room.id
              && ghost.expiresAt > Date.now()
          );
          ghosts.forEach((ghost, index) => {
            const sceneState = ghost.sceneState;
            if (!sceneState || sceneState.compact !== compact) {
              return;
            }
            if (sceneState.kind === "desk") {
              boothHtml.push(
                renderCubicleCell(
                  snapshot,
                  ghost.agent,
                  sceneState.role || agentRole(ghost.agent),
                  sceneState.cellX,
                  sceneState.cellY,
                  sceneState.cellWidth,
                  sceneState.cellHeight,
                  compact,
                  {
                    mirrored: sceneState.mirrored,
                    lead: sceneState.lead,
                    absoluteX: sceneState.cellX,
                    absoluteY: sceneState.cellY,
                    roomId: sceneState.roomId,
                    entrance: sceneState.entrance || entranceDecor.entrance,
                    motionMode: "departing"
                  }
                )
              );
              return;
            }
            if (sceneState.kind === "wallside") {
              boothHtml.push(
                renderWallsideAvatar(
                  snapshot,
                  ghost.agent,
                  sceneState.x,
                  sceneState.y - (sceneState.settle ? 3 : 0),
                  compact,
                  {
                    flip: sceneState.flip === -1,
                    settle: sceneState.settle,
                    bubble: sceneState.bubble,
                    roomId: sceneState.roomId,
                    entrance: sceneState.entrance || entranceDecor.entrance,
                    motionMode: "departing"
                  }
                )
              );
            }
          });

          const decor = [roomSkyHtml(roomPixelWidth, compact)];
          if (!isPrimaryRoom) {
            decor.push(entranceDecor.html);
          }
          const calendarScale = compact ? 0.94 : 1.08;
          if (room.width >= 9 && !isPrimaryRoom) {
            decor.push(renderSprite(pixelOffice.props.calendar, roomPixelWidth - pixelOffice.props.calendar.w * calendarScale - 14, compact ? 12 : 16, calendarScale, "office-sprite", "z-index:2;"));
          }

          const visibleRecOccupants = isPrimaryRoom ? waitingAgents.length + restingAgents.length : 0;
          const empty = occupants.length === 0 && visibleRecOccupants === 0
            ? (options.liveOnly
              ? '<div class="room-empty">No live agent activity here right now.</div>'
              : '<div class="room-empty">No mapped agent activity here yet.</div>')
            : "";
          const pathLabel = room.path && room.path !== "."
            ? \` <span class="muted">[\${escapeHtml(room.path)}]</span>\`
            : "";

          return \`<div class="room" style="left:\${room.x * tile}px; top:\${room.y * tile}px; width:\${roomPixelWidth}px; height:\${roomPixelHeight}px;"><div class="room-meta"><div class="room-head">\${escapeHtml(room.name)}\${pathLabel}</div><span class="muted">\${activeDeskOccupants.length} active agent\${activeDeskOccupants.length === 1 ? "" : "s"}</span></div><div class="room-stage"><div class="room-mural"></div><div class="room-floor"></div>\${decor.join("")}\${recAreaHtml}\${boothHtml.join("")}\${empty}</div></div>\`;
        }).join("");

          const hint = options.showHint === false
          ? ""
          : (options.liveOnly
            ? '<div class="muted">Showing live agents plus the 4 most recent lead sessions. Recent leads cool down in the rec area while live subagents stay on the floor.</div>'
            : '<div class="muted">Room shells come from the project XML, while booths are generated live from Codex sessions and grouped by parent session and subagent role.</div>');
        const sceneClass = compact ? "scene-grid compact" : "scene-grid";

        return \`<div class="scene-shell">\${hint}<div class="scene-fit \${compact ? "compact" : ""}" data-scene-fit><div class="scene-notifications" data-scene-notifications></div><div class="\${sceneClass}" data-scene-grid style="width:\${sceneWidth}px; height:\${maxY * tile}px;">\${html}</div></div></div>\`;
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
          return '<div class="empty">No live or recent lead sessions in the selected workspace right now.</div>';
        }

        const sorted = [...snapshot.agents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        return sorted.map((agent) => {
          const primaryAction = agent.url
            ? \`<a href="\${escapeHtml(agent.url)}" target="_blank" rel="noreferrer"><button>Open task</button></a>\`
            : "";
          const appearanceAction = \`<button data-action="cycle-look" data-project-root="\${escapeHtml(snapshot.projectRoot)}" data-agent-id="\${escapeHtml(agent.id)}">Cycle look</button>\`;
          const focusKeys = escapeHtml(JSON.stringify(collectFocusedSessionKeys(snapshot, agent)));

          const location = relativeLocation(snapshot.projectRoot, agent.cwd || agent.url || "");
          const parentLabel = parentLabelFor(snapshot, agent);
          const leaderText = parentLabel ? \` · lead=\${escapeHtml(parentLabel)}\` : "";
          return \`<article class="session-card" tabindex="0" data-focus-keys="\${focusKeys}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start;"><div><strong>\${escapeHtml(agent.label)}</strong><div class="muted">\${escapeHtml(agentRankLabel(snapshot, agent))} · \${escapeHtml(agentRole(agent))} · [\${escapeHtml(agent.state)}] \${escapeHtml(agent.detail)}</div></div><span class="muted">\${escapeHtml(agent.appearance.label)}</span></div><div class="inline-code" style="margin-top:8px;">\${escapeHtml(location)}</div><div class="inline-code" style="margin-top:6px;">room=\${escapeHtml(agent.roomId || "cloud")} · source=\${escapeHtml(agent.sourceKind)}\${leaderText}</div><div class="inline-code" style="margin-top:6px;">updated=\${escapeHtml(agent.updatedAt)}</div><div class="card-actions">\${primaryAction}\${appearanceAction}</div></article>\`;
        }).join("");
      }

      function renderFleetSessions(projects) {
        const entries = projects.flatMap((snapshot) =>
          snapshot.agents.map((agent) => ({ snapshot, agent }))
        );

        if (entries.length === 0) {
          return '<div class="empty">No live or recent lead sessions across the tracked workspaces right now.</div>';
        }

        entries.sort((left, right) => right.agent.updatedAt.localeCompare(left.agent.updatedAt));
        return entries.map(({ snapshot, agent }) => {
          const primaryAction = agent.url
            ? \`<a href="\${escapeHtml(agent.url)}" target="_blank" rel="noreferrer"><button>Open task</button></a>\`
            : "";
          const appearanceAction = \`<button data-action="cycle-look" data-project-root="\${escapeHtml(snapshot.projectRoot)}" data-agent-id="\${escapeHtml(agent.id)}">Cycle look</button>\`;
          const focusKeys = escapeHtml(JSON.stringify(collectFocusedSessionKeys(snapshot, agent)));
          const location = relativeLocation(snapshot.projectRoot, agent.cwd || agent.url || "");
          const parentLabel = parentLabelFor(snapshot, agent);
          const leaderText = parentLabel ? \` · lead=\${escapeHtml(parentLabel)}\` : "";
          return \`<article class="session-card" tabindex="0" data-focus-keys="\${focusKeys}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start;"><div><strong>\${escapeHtml(agent.label)}</strong><div class="muted">\${escapeHtml(projectLabel(snapshot.projectRoot))} · \${escapeHtml(agentRankLabel(snapshot, agent))} · \${escapeHtml(agentRole(agent))} · [\${escapeHtml(agent.state)}] \${escapeHtml(agent.detail)}</div></div><span class="muted">\${escapeHtml(agent.appearance.label)}</span></div><div class="inline-code" style="margin-top:8px;">\${escapeHtml(location)}</div><div class="inline-code" style="margin-top:6px;">room=\${escapeHtml(agent.roomId || "cloud")} · source=\${escapeHtml(agent.sourceKind)}\${leaderText}</div><div class="inline-code" style="margin-top:6px;">updated=\${escapeHtml(agent.updatedAt)}</div><div class="card-actions">\${primaryAction}\${appearanceAction}</div></article>\`;
        }).join("");
      }

      function applySessionFocus() {
        const focusedKeys = new Set(state.focusedSessionKeys);
        const hasFocus = focusedKeys.size > 0;
        document.querySelectorAll("[data-scene-grid]").forEach((grid) => {
          if (!(grid instanceof HTMLElement)) {
            return;
          }
          if (hasFocus) {
            grid.dataset.focusActive = "true";
          } else {
            delete grid.dataset.focusActive;
          }
        });
        document.querySelectorAll("[data-focus-agent]").forEach((element) => {
          if (!(element instanceof HTMLElement)) {
            return;
          }
          element.classList.toggle("is-focused", hasFocus && focusedKeys.has(element.dataset.focusKey || ""));
        });
      }

      function setSessionFocusFromCard(card) {
        if (!(card instanceof HTMLElement)) {
          state.focusedSessionKeys = [];
          applySessionFocus();
          return;
        }
        try {
          const parsed = JSON.parse(card.dataset.focusKeys || "[]");
          state.focusedSessionKeys = Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
        } catch {
          state.focusedSessionKeys = [];
        }
        applySessionFocus();
      }

      function syncSessionFocusFromDom() {
        const activeCard = document.querySelector(".session-card:focus-within, .session-card:hover");
        if (activeCard instanceof HTMLElement) {
          setSessionFocusFromCard(activeCard);
          return;
        }
        state.focusedSessionKeys = [];
        applySessionFocus();
      }

      function syncLiveAgentState(projects) {
        const now = Date.now();
        const previousKeys = new Set(liveAgentMemory.keys());
        const nextMemory = new Map();

        for (const snapshot of projects) {
          for (const agent of snapshot.agents) {
            const key = agentKey(snapshot.projectRoot, agent);
            nextMemory.set(key, {
              key,
              projectRoot: snapshot.projectRoot,
              roomId: agent.roomId,
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
              sceneState: renderedAgentSceneState.get(key) || null,
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
          const wrapperRect = wrapper.getBoundingClientRect();
          const viewportRemaining = Math.max(window.innerHeight - wrapperRect.top - 20, 1);
          const availableHeight = Math.max(
            Math.min(
              viewportRemaining,
              window.innerHeight * (wrapper.classList.contains("compact") ? 0.34 : 0.68)
            ),
            wrapper.classList.contains("compact") ? 180 : 220
          );
          const heightScale = wrapper.classList.contains("compact")
            ? availableHeight / rawHeight
            : Math.max(1, availableHeight / rawHeight);
          const scale = Math.min(availableWidth / rawWidth, heightScale);
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

      function setTextIfChanged(element, value) {
        if (!element) {
          return false;
        }
        const next = String(value ?? "");
        if (element.textContent === next) {
          return false;
        }
        element.textContent = next;
        return true;
      }

      function setHtmlIfChanged(element, html, options = {}) {
        if (!element) {
          return false;
        }
        if (element.dataset.renderHtml === html) {
          return false;
        }

        const preserveScroll = options.preserveScroll === true;
        const scrollTop = preserveScroll ? element.scrollTop : 0;
        const scrollLeft = preserveScroll ? element.scrollLeft : 0;
        element.innerHTML = html;
        element.dataset.renderHtml = html;
        if (preserveScroll) {
          element.scrollTop = scrollTop;
          element.scrollLeft = scrollLeft;
        }
        return true;
      }

      function currentSnapshot() {
        if (!state.fleet) return null;
        if (state.selected === "all") return null;
        return state.fleet.projects.find((snapshot) => snapshot.projectRoot === state.selected) || null;
      }

      function ingestFleet(fleet) {
        const previousFleet = state.fleet;
        queueAgentNotifications(previousFleet, fleet);
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
        sceneStateDraft = new Map();
        const counts = fleetCounts({ projects: displayedProjects });

        setTextIfChanged(stamp, \`Updated \${fleet.generatedAt}\`);
        setTextIfChanged(projectCount, \`\${fleet.projects.length} tracked · \${displayedProjects.filter((project) => busyCount(project) > 0).length} live · 4 recent leads\`);
        mapViewButton.classList.toggle("active", state.view === "map");
        terminalViewButton.classList.toggle("active", state.view === "terminal");
        setConnection(state.connection);

        setHtmlIfChanged(kpis, [
          ["Agents", counts.total],
          ["Active", counts.active],
          ["Waiting", counts.waiting],
          ["Blocked", counts.blocked],
          ["Cloud", counts.cloud]
        ].map(([label, value]) => \`<div class="kpi"><div class="muted">\${label}</div><strong>\${value}</strong></div>\`).join(""));

        setHtmlIfChanged(projectTabs, [
          \`<button class="project-tab\${state.selected === "all" ? " active" : ""}" data-action="select-project" data-project-root="all">All</button>\`,
          ...visibleProjects(fleet).map((project) => {
            const counts = countsForSnapshot(viewSnapshot(project));
            const activeClass = project.projectRoot === state.selected ? " active" : "";
            const badge = busyCount(project);
            return \`<button class="project-tab\${activeClass}" data-action="select-project" data-project-root="\${escapeHtml(project.projectRoot)}" title="\${escapeHtml(project.projectRoot)}">\${escapeHtml(projectLabel(project.projectRoot))} <span class="muted">\${badge}</span></button>\`;
          })
        ].join(""));

        try {
          if (!snapshot) {
            const centerChanged = setHtmlIfChanged(centerContent, renderWorkspaceScroll(displayedProjects), { preserveScroll: true });
            setHtmlIfChanged(sessionList, renderFleetSessions(displayedProjects), { preserveScroll: true });
            setTextIfChanged(centerTitle, "All Workspaces");
            setTextIfChanged(roomsPath, "Live agents plus 4 recent lead sessions across tracked workspaces");
            if (centerChanged) {
              fitScenes();
            }
            renderedAgentSceneState = sceneStateDraft;
            sceneStateDraft = null;
            syncSessionFocusFromDom();
            renderNotifications();
            return;
          }

          setTextIfChanged(centerTitle, projectLabel(snapshot.projectRoot));
          const sceneHtml = state.view === "terminal"
            ? renderTerminalSnapshot(snapshot)
            : renderRoomScene(snapshot, { liveOnly: state.activeOnly });
          const centerChanged = setHtmlIfChanged(centerContent, sceneHtml, { preserveScroll: true });
          const sessionsHtml = renderSessions(snapshot);
          setHtmlIfChanged(sessionList, sessionsHtml, { preserveScroll: true });
          setTextIfChanged(roomsPath, snapshot.rooms.generated ? "Auto rooms" : ".codex-agents/rooms.xml");
          if (centerChanged) {
            fitScenes();
          }
          renderedAgentSceneState = sceneStateDraft;
          sceneStateDraft = null;
          syncSessionFocusFromDom();
          renderNotifications();
        } catch (error) {
          console.error("render failed", error);
          const message = error instanceof Error ? error.message : String(error);
          setHtmlIfChanged(centerContent, '<div class="empty">Render failed: ' + escapeHtml(message) + "</div>");
          setHtmlIfChanged(sessionList, '<div class="empty">Render failed: ' + escapeHtml(message) + "</div>");
          setConnection("offline");
          renderedAgentSceneState = new Map();
          sceneStateDraft = null;
        }
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

        if (action === "cycle-look" && target.dataset.projectRoot && target.dataset.agentId) {
          await postJson("/api/appearance/cycle", {
            projectRoot: target.dataset.projectRoot,
            agentId: target.dataset.agentId
          });
        }
      });

      document.body.addEventListener("pointerover", (event) => {
        const card = event.target instanceof HTMLElement ? event.target.closest(".session-card[data-focus-keys]") : null;
        const relatedTarget = event.relatedTarget;
        if (!(card instanceof HTMLElement)) {
          return;
        }
        if (relatedTarget instanceof Node && card.contains(relatedTarget)) {
          return;
        }
        setSessionFocusFromCard(card);
      });

      document.body.addEventListener("pointerout", (event) => {
        const card = event.target instanceof HTMLElement ? event.target.closest(".session-card[data-focus-keys]") : null;
        const relatedTarget = event.relatedTarget;
        if (!(card instanceof HTMLElement)) {
          return;
        }
        if (relatedTarget instanceof Node && card.contains(relatedTarget)) {
          return;
        }
        if (relatedTarget instanceof HTMLElement && relatedTarget.closest(".session-card[data-focus-keys]")) {
          return;
        }
        setSessionFocusFromCard(null);
      });

      document.body.addEventListener("focusin", (event) => {
        const card = event.target instanceof HTMLElement ? event.target.closest(".session-card[data-focus-keys]") : null;
        if (card instanceof HTMLElement) {
          setSessionFocusFromCard(card);
        }
      });

      document.body.addEventListener("focusout", (event) => {
        const card = event.target instanceof HTMLElement ? event.target.closest(".session-card[data-focus-keys]") : null;
        const relatedTarget = event.relatedTarget;
        if (!(card instanceof HTMLElement)) {
          return;
        }
        if (relatedTarget instanceof Node && card.contains(relatedTarget)) {
          return;
        }
        if (relatedTarget instanceof HTMLElement && relatedTarget.closest(".session-card[data-focus-keys]")) {
          return;
        }
        setSessionFocusFromCard(null);
      });

      refreshButton.addEventListener("click", async () => {
        ingestFleet(await postJson("/api/refresh"));
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
      window.addEventListener("resize", () => {
        fitScenes();
        renderNotifications();
      });

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

  if (request.method === "GET" && url.pathname === "/api/server-meta") {
    sendJson(response, 200, buildServerMeta(options));
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/project-file") {
    const projectRoot = url.searchParams.get("projectRoot");
    const filePath = url.searchParams.get("path");
    if (!projectRoot || !filePath) {
      sendJson(response, 400, { error: "projectRoot and path are required" });
      return;
    }
    await sendProjectFile(response, projectRoot, filePath, request.method);
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
  const meta = buildServerMeta(options);
  const service = new FleetLiveService(options.projects, options.explicitProjects);
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
    `Codex Agents Office web listening on http://${options.host}:${options.port} pid=${meta.pid} build=${meta.buildAt} for ${options.projects
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
