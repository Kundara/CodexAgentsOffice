#!/usr/bin/env node

import { setTimeout as delay } from "node:timers/promises";
import { cwd, exit } from "node:process";
import { resolve } from "node:path";

import { runDemoPreview } from "./demo-preview";
import {
  buildAsepriteExportCommand,
  buildDashboardSnapshot,
  clearBossPresence,
  filterSnapshotToCurrentWorkload,
  flattenRooms,
  readAsepriteHeader,
  scaffoldRoomsFile,
  setBossPresence,
  validateRoomFile,
  type DashboardAgent,
  type DashboardSnapshot
} from "@codex-agents-office/core";
import { startWebServer } from "@codex-agents-office/web";

function usage(): void {
  console.log(`codex-agents-office

Usage:
  codex-agents-office snapshot [projectRoot] [--history]
  codex-agents-office watch [projectRoot] [--history]
  codex-agents-office web [--port 4181] [--host 127.0.0.1] [projectRoot...]
  codex-agents-office demo preview [--port 4181] [--host 127.0.0.1] [--duration 75] [--keep]
  codex-agents-office aseprite inspect [file]
  codex-agents-office presence boss [projectRoot]
  codex-agents-office presence clear [projectRoot]
  codex-agents-office rooms validate [fileOrProjectRoot]
  codex-agents-office rooms scaffold [projectRoot]

Omit project roots for normal fleet-mode web deploys.
Pass project roots only when you intentionally want a pinned single-project or multi-project view.
`);
}

function roomLabel(roomId: string | null): string {
  return roomId ?? "cloud";
}

function renderAgents(agents: DashboardAgent[]): string {
  if (agents.length === 0) {
    return "  (none)";
  }

  return agents
    .map((agent) => {
      const location = agent.cwd ? ` @ ${agent.cwd}` : "";
      const followUp = agent.resumeCommand ? ` | ${agent.resumeCommand}` : "";
      const role = agent.role ?? (agent.source === "local" ? "default" : "cloud");
      return `  - [${agent.state}] ${agent.label} <${role}/${agent.appearance.id}> ${agent.detail}${location}${followUp}`;
    })
    .join("\n");
}

function printSnapshot(snapshot: DashboardSnapshot): void {
  const grouped = new Map<string, DashboardAgent[]>();
  for (const agent of snapshot.agents) {
    const key = roomLabel(agent.roomId);
    const list = grouped.get(key) ?? [];
    list.push(agent);
    grouped.set(key, list);
  }

  console.log("Codex Agents Office");
  console.log(`Project: ${snapshot.projectRoot}`);
  console.log(`Generated: ${snapshot.generatedAt}`);
  console.log("");

  for (const room of flattenRooms(snapshot.rooms)) {
    const agents = grouped.get(room.id) ?? [];
    console.log(`Room ${room.id} (${room.name}) path=${room.path} tiles=${room.width}x${room.height}`);
    console.log(renderAgents(agents));
    console.log("");
  }

  const cloudAgents = grouped.get("cloud") ?? [];
  console.log("Cloud");
  console.log(renderAgents(cloudAgents));

  if (snapshot.notes.length > 0) {
    console.log("");
    console.log("Notes");
    for (const note of snapshot.notes) {
      console.log(`  - ${note}`);
    }
  }
}

async function runSnapshot(projectRoot: string, history = false): Promise<void> {
  const snapshot = await buildDashboardSnapshot({
    projectRoot,
    includeCloud: true
  });
  printSnapshot(history ? snapshot : filterSnapshotToCurrentWorkload(snapshot));
}

async function runWatch(projectRoot: string, history = false): Promise<void> {
  while (true) {
    process.stdout.write("\x1Bc");
    try {
      await runSnapshot(projectRoot, history);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    await delay(4000);
  }
}

function resolveProjectRootArg(args: string[]): string {
  return resolve(args.find((arg) => !arg.startsWith("--")) ?? cwd());
}

function includeHistory(args: string[]): boolean {
  return args.includes("--history");
}

async function runRooms(args: string[]): Promise<void> {
  const subcommand = args[0];
  const target = resolve(args[1] ?? cwd());

  if (subcommand === "validate") {
    const filePath = target.endsWith(".xml") ? target : resolve(target, ".codex-agents/rooms.xml");
    const config = await validateRoomFile(filePath);
    console.log(`Valid room file: ${config.filePath}`);
    for (const room of flattenRooms(config)) {
      console.log(`- ${room.id} ${room.name} path=${room.path} rect=${room.x},${room.y},${room.width},${room.height}`);
    }
    return;
  }

  if (subcommand === "scaffold") {
    const filePath = await scaffoldRoomsFile(target);
    console.log(filePath);
    return;
  }

  usage();
  exit(1);
}

async function runAseprite(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "inspect") {
    usage();
    exit(1);
  }

  const target = resolve(args[1] ?? cwd());
  const header = await readAsepriteHeader(target);
  console.log(`Aseprite file: ${target}`);
  console.log(`Canvas: ${header.width}x${header.height}`);
  console.log(`Frames: ${header.frames}`);
  console.log(`Color depth: ${header.colorDepth}`);
  console.log(`Flags: ${header.flags}`);
  console.log(`Speed: ${header.speed}`);
  console.log(`File size: ${header.fileSize}`);
  console.log("");
  console.log("Suggested export:");
  console.log(`  ${buildAsepriteExportCommand(target)}`);
}

async function runPresence(args: string[]): Promise<void> {
  const subcommand = args[0];
  const target = resolve(args[1] ?? cwd());

  if (subcommand === "boss") {
    await setBossPresence(target);
    console.log(`Boss presence updated for ${target}`);
    return;
  }

  if (subcommand === "clear") {
    await clearBossPresence(target);
    console.log(`Boss presence cleared for ${target}`);
    return;
  }

  usage();
  exit(1);
}

async function runDemo(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "preview") {
    await runDemoPreview(args.slice(1));
    return;
  }

  usage();
  exit(1);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "snapshot") {
    await runSnapshot(resolveProjectRootArg(args), includeHistory(args));
    return;
  }

  if (command === "watch") {
    await runWatch(resolveProjectRootArg(args), includeHistory(args));
    return;
  }

  if (command === "web") {
    await startWebServer(args);
    return;
  }

  if (command === "rooms") {
    await runRooms(args);
    return;
  }

  if (command === "aseprite") {
    await runAseprite(args);
    return;
  }

  if (command === "presence") {
    await runPresence(args);
    return;
  }

  if (command === "demo") {
    await runDemo(args);
    return;
  }

  usage();
  exit(1);
}

void main();
