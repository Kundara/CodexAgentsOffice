const test = require("node:test");
const assert = require("node:assert/strict");

const { buildServerMeta } = require("../dist/server-metadata.js");
const {
  DISCOVERED_PROJECT_FRESHNESS_WINDOW_MS,
  filterFreshDiscoveredProjects
} = require("../dist/server/fleet-live-service.js");

test("server metadata can reflect the live fleet project set", () => {
  const options = {
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/seed/project", label: "project" }]
  };
  const liveProjects = [
    { root: "/project/a", label: "a" },
    { root: "/project/b", label: "b" }
  ];

  const meta = buildServerMeta(options, liveProjects);

  assert.equal(meta.explicitProjects, false);
  assert.deepEqual(meta.projects, liveProjects);
  assert.deepEqual(meta.multiplayer, {
    enabled: false,
    transport: null,
    secure: false,
    peerCount: 0,
    note: "Multiplayer transport not configured."
  });
});

test("server metadata can include multiplayer status", () => {
  const options = {
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/seed/project", label: "project" }]
  };
  const multiplayer = {
    enabled: false,
    transport: null,
    secure: false,
    peerCount: 0,
    note: "Multiplayer transport not configured."
  };

  const meta = buildServerMeta(options, options.projects, multiplayer);

  assert.deepEqual(meta.multiplayer, multiplayer);
});

test("fleet discovery hides autodiscovered workspaces older than the internal 7-day freshness window", () => {
  const nowMs = Date.parse("2026-03-28T12:00:00.000Z");
  const thresholdSeconds = Math.floor((nowMs - DISCOVERED_PROJECT_FRESHNESS_WINDOW_MS) / 1000);
  const visible = filterFreshDiscoveredProjects(
    [
      { root: "/fresh", label: "Fresh", updatedAt: thresholdSeconds + 1, count: 1 },
      { root: "/borderline", label: "Borderline", updatedAt: thresholdSeconds, count: 0 },
      { root: "/stale", label: "Stale", updatedAt: thresholdSeconds - 1, count: 1 }
    ],
    nowMs
  );

  assert.deepEqual(visible.map((project) => project.root), ["/fresh"]);
});
