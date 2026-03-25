const test = require("node:test");
const assert = require("node:assert/strict");

const { buildServerMeta } = require("../dist/server-metadata.js");

test("server metadata can reflect the live fleet project set", () => {
  const options = {
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/seed/project", label: "project" }],
    lan: {
      enabled: false,
      discoveryPort: 41819,
      key: null
    }
  };
  const liveProjects = [
    { root: "/project/a", label: "a" },
    { root: "/project/b", label: "b" }
  ];

  const meta = buildServerMeta(options, liveProjects);

  assert.equal(meta.explicitProjects, false);
  assert.deepEqual(meta.projects, liveProjects);
  assert.deepEqual(meta.lan, {
    enabled: false,
    peerId: null,
    discoveryPort: null,
    peers: []
  });
});

test("server metadata can include current lan status", () => {
  const options = {
    host: "0.0.0.0",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/seed/project", label: "project" }],
    lan: {
      enabled: true,
      discoveryPort: 41819,
      key: null
    }
  };
  const lan = {
    enabled: true,
    peerId: "peer-1",
    discoveryPort: 41819,
    peers: [{ id: "peer-2", label: "Desk B", addresses: ["192.168.1.4"], port: 4181, seenAt: "2026-03-26T00:00:00.000Z" }]
  };

  const meta = buildServerMeta(options, options.projects, lan);

  assert.deepEqual(meta.lan, lan);
});
