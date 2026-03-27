const test = require("node:test");
const assert = require("node:assert/strict");

const { codexProjectDiscoveryThreadLimit, humanizeProjectLabel, projectLabelFromRoot } = require("../dist/project-paths.js");

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
