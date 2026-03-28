#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { listSourceFiles } = require("./list-source-files");

const repoRoot = join(__dirname, "..");
const files = listSourceFiles(repoRoot, ["packages"], [".ts", ".tsx", ".js", ".mjs", ".cjs"])
  .map((filePath) => filePath.slice(repoRoot.length + 1));

const violations = [];

for (const filePath of files) {
  const source = readFileSync(join(repoRoot, filePath), "utf8");
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);

  for (const specifier of imports) {
    if (filePath.startsWith("packages/web/src/client/") && specifier.includes("/server/")) {
      violations.push(`${filePath} must not import server code (${specifier})`);
    }
    if (filePath.startsWith("packages/web/src/server/") && specifier.includes("/client/")) {
      violations.push(`${filePath} must not import client code (${specifier})`);
    }
    if (filePath.startsWith("packages/core/src/adapters/") && specifier.includes("/services/project-live-monitor")) {
      violations.push(`${filePath} must not import monitor services (${specifier})`);
    }
  }
}

if (violations.length > 0) {
  console.error("Import boundary violations:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}
