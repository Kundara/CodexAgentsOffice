const test = require("node:test");
const assert = require("node:assert/strict");

const {
  openClawSessionToActivityState,
  openClawSessionDetail,
  openClawSessionWorkspaceLabel,
  openClawWorkspaceMatchesProject
} = require("../dist/openclaw.js");

test("OpenClaw running sessions with active children map to delegating", () => {
  assert.equal(
    openClawSessionToActivityState({
      row: { key: "agent:main:main", status: "running" },
      activeChildCount: 2
    }),
    "delegating"
  );
  assert.equal(
    openClawSessionDetail({
      row: { key: "agent:main:main", status: "running" },
      activeChildCount: 2
    }),
    "Delegating to 2 sessions"
  );
});

test("OpenClaw terminal statuses map to done or blocked office states", () => {
  assert.equal(
    openClawSessionToActivityState({
      row: { key: "agent:main:main", status: "done" },
      activeChildCount: 0
    }),
    "done"
  );
  assert.equal(
    openClawSessionToActivityState({
      row: { key: "agent:main:main", status: "failed" },
      activeChildCount: 0
    }),
    "blocked"
  );
  assert.equal(
    openClawSessionToActivityState({
      row: { key: "agent:main:main", status: "killed" },
      activeChildCount: 0
    }),
    "blocked"
  );
});

test("OpenClaw workspace matching uses the shared project-path normalization", () => {
  assert.equal(
    openClawWorkspaceMatchesProject("F:\\Projects\\CodexAgentsOffice", "/mnt/f/Projects/CodexAgentsOffice"),
    true
  );
  assert.equal(
    openClawWorkspaceMatchesProject("/mnt/f/Projects/SomewhereElse", "/mnt/f/Projects/CodexAgentsOffice"),
    false
  );
  assert.equal(
    openClawSessionWorkspaceLabel("/mnt/f/Projects/CodexAgentsOffice"),
    "CodexAgentsOffice"
  );
});
