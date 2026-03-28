#!/usr/bin/env node

const { statSync } = require("node:fs");
const { join, relative } = require("node:path");
const { listSourceFiles } = require("./list-source-files");

const repoRoot = join(__dirname, "..");
const maxBytes = 65 * 1024;

const files = listSourceFiles(
  repoRoot,
  [
    "packages/core/src",
    "packages/web/src",
    "packages/cli/src",
    "packages/vscode/src"
  ],
  [".ts", ".tsx", ".js", ".mjs", ".cjs", ".css"]
).map((filePath) => relative(repoRoot, filePath));

const violations = files
  .map((filePath) => ({
    filePath,
    size: statSync(join(repoRoot, filePath)).size
  }))
  .filter((entry) => entry.size > maxBytes);

if (violations.length > 0) {
  console.error("Source files exceed the max-size guard:");
  for (const entry of violations) {
    console.error(`- ${relative(repoRoot, join(repoRoot, entry.filePath))}: ${entry.size} bytes (limit ${maxBytes})`);
  }
  process.exit(1);
}
