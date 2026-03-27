#!/usr/bin/env node

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function projectRootFromScript() {
  if (typeof process.env.CODEX_AGENTS_OFFICE_PROJECT_ROOT === "string" && process.env.CODEX_AGENTS_OFFICE_PROJECT_ROOT.trim().length > 0) {
    return resolve(process.env.CODEX_AGENTS_OFFICE_PROJECT_ROOT);
  }
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  return resolve(scriptDir, "..", "..");
}

async function readStdinBuffer() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

function sanitizeDecodedJsonText(text) {
  return text.replace(/^\uFEFF/, "").replace(/\u0000/g, "").trim();
}

function parsePayloadBuffer(buffer) {
  for (const encoding of ["utf8", "utf16le", "latin1"]) {
    const candidate = sanitizeDecodedJsonText(buffer.toString(encoding));
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate encoding.
    }
  }
  return {};
}

function sessionIdFromPayload(payload) {
  for (const key of ["conversation_id", "session_id", "parent_conversation_id"]) {
    const value = payload?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function hookEventNameFromInput(payload) {
  if (typeof process.argv[2] === "string" && process.argv[2].trim().length > 0) {
    return process.argv[2].trim();
  }
  if (typeof payload?.hook_event_name === "string" && payload.hook_event_name.trim().length > 0) {
    return payload.hook_event_name.trim();
  }
  return "unknown";
}

function neutralOutput(eventName) {
  switch (eventName) {
    case "beforeSubmitPrompt":
      return { continue: true };
    case "preToolUse":
    case "subagentStart":
    case "beforeShellExecution":
    case "beforeMCPExecution":
      return { permission: "allow" };
    default:
      return {};
  }
}

async function main() {
  const rawInput = await readStdinBuffer();
  const payload = rawInput.length > 0 ? parsePayloadBuffer(rawInput) : {};
  const eventName = hookEventNameFromInput(payload);
  const projectRoot = projectRootFromScript();
  const sessionId = sessionIdFromPayload(payload);

  if (sessionId) {
    const hooksDir = join(projectRoot, ".codex-agents", "cursor-hooks");
    const filePath = join(hooksDir, `${sessionId}.jsonl`);
    const record = {
      ...payload,
      hook_event_name: eventName,
      timestamp: typeof payload.timestamp === "string" && payload.timestamp.trim().length > 0
        ? payload.timestamp
        : new Date().toISOString(),
      hook_source: "cursor-project-hooks",
      project_root: projectRoot,
      workspace_roots: Array.isArray(payload.workspace_roots) && payload.workspace_roots.length > 0
        ? payload.workspace_roots
        : [projectRoot]
    };

    await mkdir(hooksDir, { recursive: true });
    await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  process.stdout.write(`${JSON.stringify(neutralOutput(eventName))}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.stdout.write("{}\n");
  process.exitCode = 0;
});
