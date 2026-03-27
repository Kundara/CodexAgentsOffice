const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  codexProjectDiscoveryThreadLimit,
  discoverCodexConfiguredProjects,
  extractCodexConfiguredProjectRoots,
  humanizeProjectLabel,
  projectLabelFromRoot
} = require("../dist/project-paths.js");

test("project discovery scans a wider thread window than the requested project count", () => {
  assert.equal(codexProjectDiscoveryThreadLimit(1), 100);
  assert.equal(codexProjectDiscoveryThreadLimit(10), 200);
  assert.equal(codexProjectDiscoveryThreadLimit(50), 400);
});

test("humanizeProjectLabel adds spaces across camel and acronym boundaries", () => {
  assert.equal(humanizeProjectLabel("CodexAgentsOffice"), "Codex Agents Office");
  assert.equal(humanizeProjectLabel("ProjectAtlas"), "Project Atlas");
  assert.equal(humanizeProjectLabel("XMLParser"), "XML Parser");
});

test("projectLabelFromRoot humanizes the basename", () => {
  assert.equal(projectLabelFromRoot("/workspaces/CodexAgentsOffice"), "Codex Agents Office");
  assert.equal(projectLabelFromRoot("/workspaces/ProjectAtlas"), "Project Atlas");
});

test("extractCodexConfiguredProjectRoots reads configured Codex project entries", () => {
  const config = `
model = "gpt-5.4"
[projects."/mnt/f/AI/CodexAgentsOffice"]
trust_level = "trusted"

[projects."C:\\\\Users\\\\kunda\\\\Back Button Sensation"]
trust_level = "trusted"
`;

  assert.deepEqual(
    extractCodexConfiguredProjectRoots(config),
    [
      "/mnt/f/AI/CodexAgentsOffice",
      "/mnt/c/Users/kunda/Back Button Sensation"
    ]
  );
});

test("configured Codex discovery uses project-local freshness signals instead of only the config file mtime", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-office-project-discovery-"));
  const projectRoot = join(tempRoot, "FreshWorkspace");
  const gitDir = join(projectRoot, ".git");
  const gitLogDir = join(gitDir, "logs");
  const configPath = join(tempRoot, "config.toml");

  try {
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(gitLogDir, { recursive: true });
    writeFileSync(join(gitDir, "index"), "");
    writeFileSync(configPath, `[projects."${projectRoot.replace(/\\/g, "\\\\")}"]\ntrust_level = "trusted"\n`);

    const oldMs = Date.parse("2026-03-10T00:00:00.000Z");
    const freshMs = Date.parse("2026-03-27T12:34:56.000Z");
    utimesSync(configPath, oldMs / 1000, oldMs / 1000);
    utimesSync(join(gitDir, "index"), freshMs / 1000, freshMs / 1000);

    const discovered = await discoverCodexConfiguredProjects(10, configPath);

    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].root, projectRoot);
    assert.ok(discovered[0].updatedAt >= Math.floor(freshMs / 1000));
    assert.ok(discovered[0].updatedAt > Math.floor(oldMs / 1000));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
