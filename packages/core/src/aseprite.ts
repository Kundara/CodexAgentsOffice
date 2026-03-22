import { readFile } from "node:fs/promises";

import type { AsepriteHeader } from "./types";

const ASEPRITE_HEADER_BYTES = 32;
const ASEPRITE_MAGIC = 0xa5e0;

function readWord(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function readDword(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

export function parseAsepriteHeader(buffer: Buffer): AsepriteHeader {
  if (buffer.length < ASEPRITE_HEADER_BYTES) {
    throw new Error("Aseprite file is too small to contain a valid header.");
  }

  const magic = readWord(buffer, 4);
  if (magic !== ASEPRITE_MAGIC) {
    throw new Error("File does not have a valid Aseprite magic header.");
  }

  return {
    fileSize: readDword(buffer, 0),
    frames: readWord(buffer, 6),
    width: readWord(buffer, 8),
    height: readWord(buffer, 10),
    colorDepth: readWord(buffer, 12),
    flags: readDword(buffer, 14),
    speed: readWord(buffer, 18)
  };
}

export async function readAsepriteHeader(filePath: string): Promise<AsepriteHeader> {
  const buffer = await readFile(filePath);
  return parseAsepriteHeader(buffer);
}

export function buildAsepriteExportCommand(filePath: string): string {
  const jsonPath = filePath.replace(/\.ase(?:prite)?$/i, ".json");
  const pngPath = filePath.replace(/\.ase(?:prite)?$/i, ".png");
  return `aseprite -b "${filePath}" --sheet "${pngPath}" --data "${jsonPath}" --format json-array --list-slices --list-tags`;
}
