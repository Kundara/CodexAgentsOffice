import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";

import { XMLParser } from "fast-xml-parser";

import type { RoomConfig, RoomDefinition } from "./types";

export const CONFIG_DIRECTORY = ".codex-agents";
export const ROOMS_FILE_NAME = "rooms.xml";
export const ROSTER_FILE_NAME = "agents.json";
export const PRESENCE_FILE_NAME = "presence.json";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: true
});

function defaultRootRoom(projectRoot: string): RoomDefinition {
  return {
    id: "root",
    name: basename(projectRoot) || "Project",
    path: ".",
    x: 0,
    y: 0,
    width: 24,
    height: 16,
    children: []
  };
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return fallback;
}

function normaliseRoom(input: Record<string, unknown>, index: number): RoomDefinition {
  const children = toArray(input.room as Record<string, unknown> | Array<Record<string, unknown>>).map(
    (child, childIndex) => normaliseRoom(child, childIndex)
  );

  return {
    id: typeof input.id === "string" ? input.id : `room-${index + 1}`,
    name: typeof input.name === "string" ? input.name : `Room ${index + 1}`,
    path: typeof input.path === "string" ? input.path : ".",
    x: toInteger(input.x, 0),
    y: toInteger(input.y, 0),
    width: Math.max(4, toInteger(input.width, 8)),
    height: Math.max(4, toInteger(input.height, 6)),
    children
  };
}

function parseRoomDocument(filePath: string, xml: string): RoomConfig {
  const parsed = parser.parse(xml) as { agentOffice?: { version?: number; room?: unknown } };
  const root = parsed.agentOffice;
  if (!root) {
    throw new Error("Expected <agentOffice> root node.");
  }

  const rooms = toArray(root.room as Record<string, unknown> | Array<Record<string, unknown>>).map(
    (room, index) => normaliseRoom(room, index)
  );
  if (rooms.length === 0) {
    throw new Error("Expected at least one <room>.");
  }

  return {
    version: typeof root.version === "number" ? root.version : 1,
    generated: false,
    filePath,
    rooms
  };
}

function roomToXml(room: RoomDefinition, indent: string): string {
  const attrs = `id="${room.id}" name="${room.name}" path="${room.path}" x="${room.x}" y="${room.y}" width="${room.width}" height="${room.height}"`;
  if (room.children.length === 0) {
    return `${indent}<room ${attrs} />`;
  }

  const children = room.children.map((child) => roomToXml(child, `${indent}  `)).join("\n");
  return `${indent}<room ${attrs}>\n${children}\n${indent}</room>`;
}

async function discoverSuggestedRooms(projectRoot: string): Promise<RoomDefinition[]> {
  const entries = await readdir(projectRoot, { withFileTypes: true });
  const picked = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => !["node_modules", "dist", "docs", "packages"].includes(entry.name))
    .slice(0, 3);

  return picked.map((entry, index) => ({
    id: entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: entry.name,
    path: entry.name,
    x: 1 + index * 7,
    y: 1,
    width: 6,
    height: 6,
    children: []
  }));
}

export function getConfigDir(projectRoot: string): string {
  return join(projectRoot, CONFIG_DIRECTORY);
}

export function getRoomsFilePath(projectRoot: string): string {
  return join(getConfigDir(projectRoot), ROOMS_FILE_NAME);
}

export function getRosterFilePath(projectRoot: string): string {
  return join(getConfigDir(projectRoot), ROSTER_FILE_NAME);
}

export function getPresenceFilePath(projectRoot: string): string {
  return join(getConfigDir(projectRoot), PRESENCE_FILE_NAME);
}

export async function loadRoomConfig(projectRoot: string): Promise<RoomConfig> {
  const filePath = getRoomsFilePath(projectRoot);
  try {
    const xml = await readFile(filePath, "utf8");
    return parseRoomDocument(filePath, xml);
  } catch {
    return {
      version: 1,
      generated: true,
      filePath,
      rooms: [defaultRootRoom(projectRoot)]
    };
  }
}

export async function validateRoomFile(filePath: string): Promise<RoomConfig> {
  const xml = await readFile(filePath, "utf8");
  return parseRoomDocument(filePath, xml);
}

export async function scaffoldRoomsFile(projectRoot: string): Promise<string> {
  const filePath = getRoomsFilePath(projectRoot);
  try {
    await stat(filePath);
    return filePath;
  } catch {
    const root = defaultRootRoom(projectRoot);
    root.children = await discoverSuggestedRooms(projectRoot);
    const xml = [
      '<agentOffice version="1">',
      roomToXml(root, "  "),
      "</agentOffice>",
      ""
    ].join("\n");

    await mkdir(getConfigDir(projectRoot), { recursive: true });
    await writeFile(filePath, xml, "utf8");
    return filePath;
  }
}

export function flattenRooms(roomConfig: RoomConfig): RoomDefinition[] {
  const flattened: RoomDefinition[] = [];
  const stack = [...roomConfig.rooms];

  while (stack.length > 0) {
    const room = stack.shift();
    if (!room) {
      continue;
    }
    flattened.push(room);
    stack.unshift(...room.children);
  }

  return flattened;
}

function resolveCandidatePath(projectRoot: string, candidatePath: string): string {
  return isAbsolute(candidatePath) ? candidatePath : resolve(projectRoot, candidatePath);
}

function startsWithPath(candidatePath: string, roomPath: string): boolean {
  return candidatePath === roomPath || candidatePath.startsWith(`${roomPath}${sep}`);
}

export function findRoomForPaths(
  roomConfig: RoomConfig,
  projectRoot: string,
  candidatePaths: string[]
): string | null {
  const rooms = flattenRooms(roomConfig);
  const uniquePaths = Array.from(
    new Set(candidatePaths.filter(Boolean).map((candidatePath) => resolveCandidatePath(projectRoot, candidatePath)))
  );

  let bestRoomId = rooms[0]?.id ?? null;
  let bestScore = -1;

  for (const room of rooms) {
    const resolvedRoomPath = resolve(projectRoot, room.path || ".");
    for (const candidatePath of uniquePaths) {
      if (!startsWithPath(candidatePath, resolvedRoomPath)) {
        continue;
      }

      const score = resolvedRoomPath.length;
      if (score > bestScore) {
        bestRoomId = room.id;
        bestScore = score;
      }
    }
  }

  return bestRoomId;
}
