const test = require("node:test");
const assert = require("node:assert/strict");

const { summariseClaudeHookRecord } = require("../dist/claude.js");
const {
  normalizeRepositoryUrl,
  cursorStatusToActivityState
} = require("../dist/cursor.js");

test("typed Claude permission hooks become approval-backed blocked state", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/mnt/f/AI/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "PermissionRequest",
      cwd: "/mnt/f/AI/CodexAgentsOffice",
      request_id: "req_42",
      reason: "Need approval to run a privileged command",
      tool_input: {
        command: "npm publish",
        cwd: "/mnt/f/AI/CodexAgentsOffice"
      }
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "blocked");
  assert.equal(summary.confidence, "typed");
  assert.deepEqual(summary.needsUser, {
    kind: "approval",
    requestId: "req_42",
    reason: "Need approval to run a privileged command",
    command: "npm publish",
    cwd: "/mnt/f/AI/CodexAgentsOffice",
    grantRoot: "/mnt/f/AI/CodexAgentsOffice"
  });
  assert.equal(summary.isOngoing, true);
});

test("typed Claude user prompt hooks become planning state with user-message activity", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/mnt/f/AI/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "UserPromptSubmit",
      cwd: "/mnt/f/AI/CodexAgentsOffice",
      prompt: "Update /mnt/f/AI/CodexAgentsOffice/README.md with Cursor support"
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "planning");
  assert.equal(summary.activityEvent?.type, "userMessage");
  assert.equal(summary.activityEvent?.action, "said");
  assert.match(summary.detail, /README\.md/);
  assert.deepEqual(summary.paths, ["/mnt/f/AI/CodexAgentsOffice/README.md"]);
});

test("cursor repository URLs normalize across ssh and https forms", () => {
  assert.equal(
    normalizeRepositoryUrl("git@github.com:OpenAI/CodexAgentsOffice.git"),
    "https://github.com/openai/codexagentsoffice"
  );
  assert.equal(
    normalizeRepositoryUrl("https://github.com/OpenAI/CodexAgentsOffice.git"),
    "https://github.com/openai/codexagentsoffice"
  );
  assert.equal(
    normalizeRepositoryUrl("ssh://git@github.com/OpenAI/CodexAgentsOffice.git"),
    "https://github.com/openai/codexagentsoffice"
  );
});

test("cursor background agent statuses map into workload states", () => {
  assert.equal(cursorStatusToActivityState("CREATING"), "running");
  assert.equal(cursorStatusToActivityState("RUNNING"), "running");
  assert.equal(cursorStatusToActivityState("FINISHED"), "done");
  assert.equal(cursorStatusToActivityState("ERROR"), "blocked");
  assert.equal(cursorStatusToActivityState("EXPIRED"), "idle");
});
