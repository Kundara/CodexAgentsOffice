const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProjectDescriptors, parseArgs } = require("../dist/server-options.js");

test("web server defaults to fleet mode when no project roots are passed", () => {
  const options = parseArgs(["--port", "4181"]);

  assert.equal(options.explicitProjects, false);
  assert.equal(options.projects.length, 1);
  assert.ok(options.projects[0].root);
});

test("web server becomes pinned only when explicit project roots are passed", () => {
  const options = parseArgs(["/tmp/project-a", "/tmp/project-b", "--port", "4181"]);

  assert.equal(options.explicitProjects, true);
  assert.deepEqual(
    options.projects.map((project) => project.root),
    ["/tmp/project-a", "/tmp/project-b"]
  );
});

test("project descriptors humanize camel-case workspace names", () => {
  const descriptors = buildProjectDescriptors([
    "/workspaces/CodexAgentsOffice",
    "/workspaces/ProjectAtlas"
  ]);

  assert.deepEqual(
    descriptors.map((project) => project.label),
    ["Codex Agents Office", "Project Atlas"]
  );
});
