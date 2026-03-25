const test = require("node:test");
const assert = require("node:assert/strict");

const { parseArgs } = require("../dist/server-options.js");

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

test("lan mode enables discovery and widens the default host binding", () => {
  const options = parseArgs(["--lan", "--port", "4181"]);

  assert.equal(options.lan.enabled, true);
  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.lan.discoveryPort, 41819);
});
