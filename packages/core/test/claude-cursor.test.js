const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { mkdtemp, readFile } = require("node:fs/promises");

const { summariseClaudeHookRecord, summariseClaudeSession } = require("../dist/claude.js");
const { claudeHooksFilePath, createClaudeSdkSidecarHooks } = require("../dist/claude-agent-sdk.js");
const {
  cursorAgentMatchesRepository,
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

test("synthetic Claude model placeholders do not leak into agent labels", () => {
  const summary = summariseClaudeSession(
    "f06cc37e-5ca7-4c5e-9eba-4bf8e99e536a",
    "/mnt/f/AI/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: "2026-03-25T21:18:22.366Z",
        cwd: "/mnt/f/AI/CodexAgentsOffice",
        message: {
          model: "<synthetic>",
          content: [
            {
              type: "text",
              text: "Please run /login · API Error: 401"
            }
          ]
        }
      }
    ],
    Date.parse("2026-03-25T21:18:22.366Z")
  );

  assert.equal(summary.label, "Claude f06c");
});

test("typed Claude file-change hooks become editing file-change activity", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/mnt/f/AI/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "FileChanged",
      cwd: "/mnt/f/AI/CodexAgentsOffice",
      file_path: "/mnt/f/AI/CodexAgentsOffice/README.md",
      event: "change"
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "editing");
  assert.equal(summary.activityEvent?.type, "fileChange");
  assert.equal(summary.activityEvent?.action, "edited");
  assert.deepEqual(summary.paths, ["/mnt/f/AI/CodexAgentsOffice/README.md", "/mnt/f/AI/CodexAgentsOffice"]);
});

test("typed Claude notification hooks surface a recent agent message", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/mnt/f/AI/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "Notification",
      cwd: "/mnt/f/AI/CodexAgentsOffice",
      title: "Checkpoint",
      message: "Analyzing renderer layout",
      notification_type: "info"
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "thinking");
  assert.equal(summary.activityEvent?.type, "agentMessage");
  assert.equal(summary.latestMessage, "Analyzing renderer layout");
});

test("stale Claude hook-backed live states decay to done instead of staying ongoing forever", () => {
  const now = Date.now();
  const hookTimestamp = new Date(now - 5 * 60 * 1000).toISOString();
  const summary = summariseClaudeSession(
    "session-123",
    "/mnt/f/AI/CodexAgentsOffice",
    [],
    now,
    [
      {
        hook_event_name: "PostToolUse",
        timestamp: hookTimestamp,
        cwd: "/mnt/f/AI/CodexAgentsOffice",
        tool_name: "Bash",
        tool_input: {
          command: "npm test",
          cwd: "/mnt/f/AI/CodexAgentsOffice"
        }
      }
    ]
  );

  assert.equal(summary.state, "done");
  assert.equal(summary.isOngoing, false);
  assert.equal(summary.activityEvent, null);
});

test("hook-backed Claude sessions still surface assistant reply text", () => {
  const now = Date.now();
  const toolTimestamp = new Date(now - 60 * 1000).toISOString();
  const replyTimestamp = new Date(now - 30 * 1000).toISOString();
  const summary = summariseClaudeSession(
    "session-123",
    "/mnt/f/AI/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: replyTimestamp,
        cwd: "/mnt/f/AI/CodexAgentsOffice",
        message: {
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "text",
              text: "Finished the pass and updated the renderer."
            }
          ]
        }
      }
    ],
    now,
    [
      {
        hook_event_name: "PostToolUse",
        timestamp: toolTimestamp,
        cwd: "/mnt/f/AI/CodexAgentsOffice",
        tool_name: "Bash",
        tool_input: {
          command: "npm test",
          cwd: "/mnt/f/AI/CodexAgentsOffice"
        }
      }
    ]
  );

  assert.equal(summary.latestMessage, "Finished the pass and updated the renderer.");
  assert.equal(summary.activityEvent?.type, "agentMessage");
  assert.equal(summary.state, "thinking");
});

test("Claude SDK sidecar hooks append typed hook records per session", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "claude-hooks-"));
  const hooks = createClaudeSdkSidecarHooks({
    projectRoot,
    watchPaths: [projectRoot]
  });
  const matcher = hooks.SessionStart?.[0];
  assert.ok(matcher);

  const output = await matcher.hooks[0]({
    hook_event_name: "SessionStart",
    session_id: "session-123",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: projectRoot,
    source: "startup"
  }, undefined, {
    signal: AbortSignal.timeout(1000)
  });

  assert.equal(output.continue, true);
  assert.deepEqual(output.hookSpecificOutput, {
    hookEventName: "SessionStart",
    watchPaths: [projectRoot]
  });

  const sidecar = await readFile(claudeHooksFilePath(projectRoot, "session-123"), "utf8");
  const [recordText] = sidecar.trim().split("\n");
  const record = JSON.parse(recordText);
  assert.equal(record.hook_source, "claude-agent-sdk");
  assert.equal(record.hook_event_name, "SessionStart");
  assert.equal(record.session_id, "session-123");
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
  assert.equal(
    normalizeRepositoryUrl("https://github.com/OpenAI/CodexAgentsOffice/pull/42"),
    "https://github.com/openai/codexagentsoffice"
  );
  assert.equal(
    normalizeRepositoryUrl("https://gitlab.example.com/team/platform/CodexAgentsOffice/-/merge_requests/42"),
    "https://gitlab.example.com/team/platform/codexagentsoffice"
  );
});

test("cursor background agent statuses map into workload states", () => {
  assert.equal(cursorStatusToActivityState("CREATING"), "running");
  assert.equal(cursorStatusToActivityState("RUNNING"), "running");
  assert.equal(cursorStatusToActivityState("FINISHED"), "done");
  assert.equal(cursorStatusToActivityState("ERROR"), "blocked");
  assert.equal(cursorStatusToActivityState("EXPIRED"), "idle");
});

test("cursor agents match the current repo when Cursor reports a PR URL instead of source.repository", () => {
  assert.equal(
    cursorAgentMatchesRepository(
      {
        source: {
          prUrl: "https://github.com/Kundara/CodexAgentsOffice/pull/123"
        }
      },
      "https://github.com/Kundara/CodexAgentsOffice.git"
    ),
    true
  );
  assert.equal(
    cursorAgentMatchesRepository(
      {
        target: {
          prUrl: "https://github.com/Kundara/CodexAgentsOffice/pull/456"
        }
      },
      "git@github.com:Kundara/CodexAgentsOffice.git"
    ),
    true
  );
});
