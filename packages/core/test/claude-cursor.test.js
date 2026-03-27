const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { mkdir, mkdtemp, readFile, writeFile } = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");

const {
  buildClaudeSessionEventsForTest,
  summariseClaudeHookRecord,
  summariseClaudeSession
} = require("../dist/claude.js");
const {
  claudeHooksFilePath,
  createClaudeSdkSidecarHooks,
  normalizeClaudeSdkMessageForTest
} = require("../dist/claude-agent-sdk.js");
const {
  describeCursorIntegrationSettings,
  getAppSettingsFilePath,
  resetAppSettingsCacheForTest,
  setStoredCursorApiKey
} = require("../dist/app-settings.js");
const {
  describeCursorAgentAvailability,
  cursorAgentMatchesRepository,
  cursorApiKeyConfigured,
  loadCursorCloudProjectSnapshotData,
  loadCursorLocalProjectSnapshotData,
  normalizeRepositoryUrl,
  cursorStatusToActivityState
} = require("../dist/cursor.js");
const { cursorCloudAdapter } = require("../dist/adapters/cursor-cloud.js");

const execFileAsync = promisify(execFile);

test("typed Claude permission hooks become approval-backed blocked state", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "PermissionRequest",
      cwd: "/workspaces/CodexAgentsOffice",
      request_id: "req_42",
      reason: "Need approval to run a privileged command",
      tool_input: {
        command: "npm publish",
        cwd: "/workspaces/CodexAgentsOffice"
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
    cwd: "/workspaces/CodexAgentsOffice",
    grantRoot: "/workspaces/CodexAgentsOffice"
  });
  assert.equal(summary.isOngoing, true);
});

test("typed Claude user prompt hooks become planning state with user-message activity", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "UserPromptSubmit",
      cwd: "/workspaces/CodexAgentsOffice",
      prompt: "Update /workspaces/CodexAgentsOffice/README.md with Cursor support"
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "planning");
  assert.equal(summary.activityEvent?.type, "userMessage");
  assert.equal(summary.activityEvent?.action, "said");
  assert.match(summary.detail, /README\.md/);
  assert.deepEqual(summary.paths, ["/workspaces/CodexAgentsOffice/README.md"]);
});

test("synthetic Claude model placeholders do not leak into agent labels", () => {
  const summary = summariseClaudeSession(
    "f06cc37e-5ca7-4c5e-9eba-4bf8e99e536a",
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: "2026-03-25T21:18:22.366Z",
        cwd: "/workspaces/CodexAgentsOffice",
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
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "FileChanged",
      cwd: "/workspaces/CodexAgentsOffice",
      file_path: "/workspaces/CodexAgentsOffice/README.md",
      event: "change"
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "editing");
  assert.equal(summary.activityEvent?.type, "fileChange");
  assert.equal(summary.activityEvent?.action, "edited");
  assert.deepEqual(summary.paths, ["/workspaces/CodexAgentsOffice/README.md", "/workspaces/CodexAgentsOffice"]);
});

test("typed Claude notification hooks surface a recent agent message", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "Notification",
      cwd: "/workspaces/CodexAgentsOffice",
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
    "/workspaces/CodexAgentsOffice",
    [],
    now,
    [
      {
        hook_event_name: "PostToolUse",
        timestamp: hookTimestamp,
        cwd: "/workspaces/CodexAgentsOffice",
        tool_name: "Bash",
        tool_input: {
          command: "npm test",
          cwd: "/workspaces/CodexAgentsOffice"
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
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: replyTimestamp,
        cwd: "/workspaces/CodexAgentsOffice",
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
        cwd: "/workspaces/CodexAgentsOffice",
        tool_name: "Bash",
        tool_input: {
          command: "npm test",
          cwd: "/workspaces/CodexAgentsOffice"
        }
      }
    ]
  );

  assert.equal(summary.latestMessage, "Finished the pass and updated the renderer.");
  assert.equal(summary.activityEvent?.type, "agentMessage");
  assert.equal(summary.state, "thinking");
});

test("Claude session events include the latest assistant reply and file-change hooks", () => {
  const now = Date.now();
  const events = buildClaudeSessionEventsForTest({
    sessionId: "session-123",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    records: [
      {
        type: "assistant",
        timestamp: new Date(now - 2_000).toISOString(),
        message: {
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "text",
              text: "Updated /workspaces/CodexAgentsOffice/README.md"
            }
          ]
        }
      }
    ],
    fallbackUpdatedAt: now,
    hookRecords: [
      {
        hook_event_name: "FileChanged",
        timestamp: new Date(now - 1_000).toISOString(),
        cwd: "/workspaces/CodexAgentsOffice",
        file_path: "/workspaces/CodexAgentsOffice/README.md",
        event: "change"
      }
    ]
  });

  assert.ok(events.some((event) => event.kind === "message" && event.method === "claude/agentMessage"));
  assert.ok(events.some((event) => event.kind === "fileChange" && event.method === "claude/fileChange"));
  assert.ok(events.every((event) => event.threadId === "session-123"));
});

test("Claude SDK message normalization preserves top-level timestamps", () => {
  const normalizedUser = normalizeClaudeSdkMessageForTest(
    {
      type: "user",
      uuid: "user-1",
      session_id: "session-123",
      parent_tool_use_id: null,
      timestamp: "2026-03-26T10:00:00.000Z",
      message: {
        role: "user",
        content: "hello"
      }
    },
    {
      cwd: "/workspaces/CodexAgentsOffice",
      gitBranch: "main"
    }
  );
  const normalizedAssistant = normalizeClaudeSdkMessageForTest(
    {
      type: "assistant",
      uuid: "assistant-1",
      session_id: "session-123",
      parent_tool_use_id: null,
      timestamp: "2026-03-26T10:00:02.000Z",
      message: {
        model: "claude-sonnet-4-5",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "done"
          }
        ]
      }
    },
    {
      cwd: "/workspaces/CodexAgentsOffice",
      gitBranch: "main"
    }
  );

  const summary = summariseClaudeSession(
    "session-123",
    "/workspaces/CodexAgentsOffice",
    [normalizedUser, normalizedAssistant],
    Date.parse("2026-03-26T10:00:02.000Z")
  );

  assert.equal(summary.latestMessage, "done");
  assert.equal(summary.detail, "done");
});

test("synthetic Claude command wrapper user records do not override assistant replies", () => {
  const now = Date.now();
  const summary = summariseClaudeSession(
    "session-123",
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: new Date(now - 2_000).toISOString(),
        message: {
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "text",
              text: "Actual assistant reply"
            }
          ]
        }
      },
      {
        type: "user",
        timestamp: new Date(now - 1_000).toISOString(),
        message: {
          content: "<local-command-stdout>Bye!</local-command-stdout>"
        }
      }
    ],
    now
  );

  assert.equal(summary.latestMessage, "Actual assistant reply");
  assert.equal(summary.detail, "Actual assistant reply");
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

test("cursor cloud snapshot maps conversation messages into typed activity and events", { concurrency: false }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-cloud-snapshot-"));
  await execFileAsync("git", ["init", projectRoot]);
  await execFileAsync("git", ["-C", projectRoot, "remote", "add", "origin", "https://github.com/example-org/CodexAgentsOffice.git"]);

  const previousCursorApiKey = process.env.CURSOR_API_KEY;
  const previousFetch = global.fetch;
  process.env.CURSOR_API_KEY = "cursor_test_12345678";
  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/v0/agents?")) {
      return new Response(JSON.stringify({
        agents: [
          {
            id: "agent-123",
            name: "Cursor cloud task",
            status: "RUNNING",
            createdAt: "2026-03-27T00:00:00.000Z",
            updatedAt: "2026-03-27T00:01:00.000Z",
            summary: "Implementing cursor conversation polling",
            source: {
              repository: "https://github.com/example-org/CodexAgentsOffice.git",
              ref: "main"
            },
            target: {
              url: "https://cursor.com/agents/agent-123",
              branchName: "cursor/conversation-polling",
              prUrl: null,
              autoCreatePr: false
            },
            model: "gpt-5"
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.endsWith("/v0/agents/agent-123/conversation")) {
      return new Response(JSON.stringify({
        messages: [
          {
            id: "message-1",
            type: "user_message",
            text: "Please implement Cursor toast support"
          },
          {
            id: "message-2",
            type: "assistant_message",
            text: "Implemented Cursor toast support."
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const snapshot = await loadCursorCloudProjectSnapshotData(projectRoot, {
      emitConversationEvents: true
    });
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].threadId, "agent-123");
    assert.equal(snapshot.agents[0].latestMessage, "Implemented Cursor toast support.");
    assert.equal(snapshot.agents[0].activityEvent?.type, "agentMessage");
    assert.equal(snapshot.events.length, 2);
    assert.equal(snapshot.events[0].source, "cursor");
    assert.equal(snapshot.events[0].confidence, "typed");
    assert.equal(snapshot.events[0].threadId, "agent-123");
    assert.equal(snapshot.events[0].kind, "message");
    assert.equal(snapshot.events[1].detail, "Please implement Cursor toast support");
  } finally {
    if (typeof previousCursorApiKey === "string") {
      process.env.CURSOR_API_KEY = previousCursorApiKey;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
    global.fetch = previousFetch;
  }
});

test("cursor cloud adapter suppresses historical conversation toasts on first refresh and emits only new messages later", { concurrency: false }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-cloud-adapter-"));
  await execFileAsync("git", ["init", projectRoot]);
  await execFileAsync("git", ["-C", projectRoot, "remote", "add", "origin", "https://github.com/example-org/CodexAgentsOffice.git"]);

  const previousCursorApiKey = process.env.CURSOR_API_KEY;
  const previousFetch = global.fetch;
  process.env.CURSOR_API_KEY = "cursor_test_12345678";

  let conversationMessages = [
    {
      id: "message-1",
      type: "user_message",
      text: "Initial prompt"
    },
    {
      id: "message-2",
      type: "assistant_message",
      text: "Initial reply"
    }
  ];

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/v0/agents?")) {
      return new Response(JSON.stringify({
        agents: [
          {
            id: "agent-123",
            name: "Cursor cloud task",
            status: "RUNNING",
            createdAt: "2026-03-27T00:00:00.000Z",
            updatedAt: "2026-03-27T00:01:00.000Z",
            summary: "Implementing cursor conversation polling",
            source: {
              repository: "https://github.com/example-org/CodexAgentsOffice.git",
              ref: "main"
            },
            target: {
              url: "https://cursor.com/agents/agent-123",
              branchName: "cursor/conversation-polling",
              prUrl: null,
              autoCreatePr: false
            },
            model: "gpt-5"
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.endsWith("/v0/agents/agent-123/conversation")) {
      return new Response(JSON.stringify({ messages: conversationMessages }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const source = cursorCloudAdapter.createSource({ projectRoot });
    await source.warm();
    const firstSnapshot = source.getCachedSnapshot();
    assert.equal(firstSnapshot.events.length, 0);
    assert.equal(firstSnapshot.agents[0].latestMessage, "Initial reply");

    conversationMessages = [
      ...conversationMessages,
      {
        id: "message-3",
        type: "assistant_message",
        text: "Follow-up reply"
      }
    ];

    await source.refresh("interval");
    const secondSnapshot = source.getCachedSnapshot();
    assert.equal(secondSnapshot.events.length, 1);
    assert.equal(secondSnapshot.events[0].detail, "Follow-up reply");
    assert.equal(secondSnapshot.agents[0].latestMessage, "Follow-up reply");
    await source.dispose();
  } finally {
    if (typeof previousCursorApiKey === "string") {
      process.env.CURSOR_API_KEY = previousCursorApiKey;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
    global.fetch = previousFetch;
  }
});

test("cursor local snapshot parsing survives fragmented workspace state blobs", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-"));
  const projectRoot = path.join(tempRoot, "project");
  const workspaceStorageDir = path.join(tempRoot, "workspaceStorage");
  const logsDir = path.join(tempRoot, "logs");
  const workspaceDir = path.join(workspaceStorageDir, "workspace-1");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(logsDir, "20260326T120000"), { recursive: true });

  const previousWorkspaceStorageDir = process.env.CURSOR_WORKSPACE_STORAGE_DIR;
  const previousLogsDir = process.env.CURSOR_LOGS_DIR;
  const previousCursorUserDataDir = process.env.CURSOR_USER_DATA_DIR;
  process.env.CURSOR_WORKSPACE_STORAGE_DIR = workspaceStorageDir;
  process.env.CURSOR_LOGS_DIR = logsDir;
  delete process.env.CURSOR_USER_DATA_DIR;

  const now = Date.now();
  const composerId = "composer-1234";
  const composerData = JSON.stringify({
    allComposers: [
      {
        type: "head",
        composerId,
        name: "Local Cursor test",
        subtitle: "Scanning renderer files",
        createdAt: now - 30_000,
        lastUpdatedAt: now - 5_000,
        unifiedMode: "agent",
        filesChangedCount: 2,
        totalLinesAdded: 4,
        totalLinesRemoved: 1,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      }
    ],
    selectedComposerIds: [composerId],
    lastFocusedComposerIds: [composerId]
  });
  const prompts = JSON.stringify([{ text: "Inspect the local Cursor adapter", commandType: 4 }]);
  const generations = JSON.stringify([
    {
      unixMs: now - 4_000,
      generationUUID: "generation-1",
      type: "composer",
      textDescription: "Inspect the local Cursor adapter"
    }
  ]);
  const backgroundComposer = JSON.stringify({
    cachedSelectedGitState: {
      ref: "main",
      continueRef: "main"
    }
  });

  const rawState = Buffer.concat([
    Buffer.from(`noise composer.composerData${composerData.slice(0, 96)}`, "utf8"),
    Buffer.from([0, 1, 2]),
    Buffer.from(composerData.slice(96), "utf8"),
    Buffer.from([0]),
    Buffer.from(` aiService.prompts${prompts}`, "utf8"),
    Buffer.from([0]),
    Buffer.from(` aiService.generations${generations}`, "utf8"),
    Buffer.from([0]),
    Buffer.from(` workbench.backgroundComposer.workspacePersistentData${backgroundComposer}`, "utf8")
  ]);

  try {
    await writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({
      folder: pathToFileURL(projectRoot).toString()
    }));
    await writeFile(path.join(workspaceDir, "state.vscdb"), rawState);
    await writeFile(path.join(logsDir, "20260326T120000", "main.log"), "");

    const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].source, "cursor");
    assert.equal(snapshot.agents[0].confidence, "inferred");
    assert.equal(snapshot.agents[0].label, "Local Cursor test");
    assert.equal(snapshot.agents[0].state, "editing");
    assert.equal(snapshot.agents[0].git?.branch, "main");
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.events[0].method, "cursor/local/prompt");
    assert.match(snapshot.events[0].detail, /Inspect the local Cursor adapter/);
  } finally {
    if (typeof previousWorkspaceStorageDir === "string") {
      process.env.CURSOR_WORKSPACE_STORAGE_DIR = previousWorkspaceStorageDir;
    } else {
      delete process.env.CURSOR_WORKSPACE_STORAGE_DIR;
    }
    if (typeof previousLogsDir === "string") {
      process.env.CURSOR_LOGS_DIR = previousLogsDir;
    } else {
      delete process.env.CURSOR_LOGS_DIR;
    }
    if (typeof previousCursorUserDataDir === "string") {
      process.env.CURSOR_USER_DATA_DIR = previousCursorUserDataDir;
    } else {
      delete process.env.CURSOR_USER_DATA_DIR;
    }
  }
});

test("cursor local snapshot ignores stale retained composers when a new chat updates the workspace", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-retained-"));
  const projectRoot = path.join(tempRoot, "project");
  const workspaceStorageDir = path.join(tempRoot, "workspaceStorage");
  const logsDir = path.join(tempRoot, "logs");
  const workspaceDir = path.join(workspaceStorageDir, "workspace-1");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(logsDir, "20260326T120000"), { recursive: true });

  const previousWorkspaceStorageDir = process.env.CURSOR_WORKSPACE_STORAGE_DIR;
  const previousLogsDir = process.env.CURSOR_LOGS_DIR;
  const previousCursorUserDataDir = process.env.CURSOR_USER_DATA_DIR;
  process.env.CURSOR_WORKSPACE_STORAGE_DIR = workspaceStorageDir;
  process.env.CURSOR_LOGS_DIR = logsDir;
  delete process.env.CURSOR_USER_DATA_DIR;

  const now = Date.now();
  const activeComposerId = "composer-active";
  const staleComposerId = "composer-stale";
  const composerData = JSON.stringify({
    allComposers: [
      {
        composerId: activeComposerId,
        name: "Active Cursor chat",
        subtitle: "Editing renderer",
        createdAt: now - 60_000,
        lastUpdatedAt: now - 5_000,
        unifiedMode: "agent",
        filesChangedCount: 1,
        totalLinesAdded: 3,
        totalLinesRemoved: 0,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      },
      {
        composerId: staleComposerId,
        name: "Old retained chat",
        subtitle: "Previously asked a question",
        createdAt: now - (2 * 60 * 60 * 1000),
        lastUpdatedAt: now - (90 * 60 * 1000),
        unifiedMode: "agent",
        filesChangedCount: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      }
    ],
    selectedComposerIds: [activeComposerId, staleComposerId],
    lastFocusedComposerIds: [activeComposerId, staleComposerId]
  });
  const prompts = JSON.stringify([{ text: "Inspect the current Cursor chat", commandType: 4 }]);
  const generations = JSON.stringify([
    {
      unixMs: now - 4_000,
      generationUUID: "generation-active",
      type: "composer",
      textDescription: "Inspect the current Cursor chat"
    }
  ]);

  try {
    await writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({
      folder: pathToFileURL(projectRoot).toString()
    }));
    await writeFile(path.join(workspaceDir, "state.vscdb"), Buffer.from([
      `composer.composerData${composerData}`,
      ` aiService.prompts${prompts}`,
      ` aiService.generations${generations}`
    ].join("\0"), "utf8"));
    await writeFile(path.join(logsDir, "20260326T120000", "main.log"), "");

    const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].id, `cursor-local:${activeComposerId}`);
    assert.equal(snapshot.agents[0].label, "Active Cursor chat");
    assert.equal(snapshot.agents[0].state, "editing");
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.events[0].threadId, activeComposerId);
  } finally {
    if (typeof previousWorkspaceStorageDir === "string") {
      process.env.CURSOR_WORKSPACE_STORAGE_DIR = previousWorkspaceStorageDir;
    } else {
      delete process.env.CURSOR_WORKSPACE_STORAGE_DIR;
    }
    if (typeof previousLogsDir === "string") {
      process.env.CURSOR_LOGS_DIR = previousLogsDir;
    } else {
      delete process.env.CURSOR_LOGS_DIR;
    }
    if (typeof previousCursorUserDataDir === "string") {
      process.env.CURSOR_USER_DATA_DIR = previousCursorUserDataDir;
    } else {
      delete process.env.CURSOR_USER_DATA_DIR;
    }
  }
});

test("cursor local snapshot prefers the last focused composer over stale selected tab order", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-focused-"));
  const projectRoot = path.join(tempRoot, "project");
  const workspaceStorageDir = path.join(tempRoot, "workspaceStorage");
  const logsDir = path.join(tempRoot, "logs");
  const workspaceDir = path.join(workspaceStorageDir, "workspace-1");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(logsDir, "20260326T120000"), { recursive: true });

  const previousWorkspaceStorageDir = process.env.CURSOR_WORKSPACE_STORAGE_DIR;
  const previousLogsDir = process.env.CURSOR_LOGS_DIR;
  const previousCursorUserDataDir = process.env.CURSOR_USER_DATA_DIR;
  process.env.CURSOR_WORKSPACE_STORAGE_DIR = workspaceStorageDir;
  process.env.CURSOR_LOGS_DIR = logsDir;
  delete process.env.CURSOR_USER_DATA_DIR;

  const now = Date.now();
  const staleSelectedComposerId = "composer-stale-selected";
  const focusedComposerId = "composer-focused";
  const composerData = JSON.stringify({
    allComposers: [
      {
        composerId: staleSelectedComposerId,
        name: "Stale selected tab",
        subtitle: "Old work",
        createdAt: now - (2 * 60 * 60 * 1000),
        lastUpdatedAt: now - (90 * 60 * 1000),
        unifiedMode: "agent",
        filesChangedCount: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      },
      {
        composerId: focusedComposerId,
        name: "Focused Cursor task",
        subtitle: "Read package.json, CHANGELOG.md",
        createdAt: now - 60_000,
        lastUpdatedAt: now - 4_000,
        unifiedMode: "agent",
        filesChangedCount: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      }
    ],
    selectedComposerIds: [staleSelectedComposerId, focusedComposerId],
    lastFocusedComposerIds: [focusedComposerId, staleSelectedComposerId]
  });
  const prompts = JSON.stringify([{ text: "Read package.json, CHANGELOG.md", commandType: 4 }]);
  const generations = JSON.stringify([
    {
      unixMs: now - 3_000,
      generationUUID: "generation-focused",
      type: "composer",
      textDescription: "Read package.json, CHANGELOG.md"
    }
  ]);

  try {
    await writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({
      folder: pathToFileURL(projectRoot).toString()
    }));
    await writeFile(path.join(workspaceDir, "state.vscdb"), Buffer.from([
      `composer.composerData${composerData}`,
      ` aiService.prompts${prompts}`,
      ` aiService.generations${generations}`
    ].join("\0"), "utf8"));
    await writeFile(path.join(logsDir, "20260326T120000", "main.log"), "");

    const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
    const focusedAgent = snapshot.agents.find((agent) => agent.id === `cursor-local:${focusedComposerId}`) || null;
    assert.ok(focusedAgent);
    assert.equal(focusedAgent.label, "Focused Cursor task");
    assert.equal(focusedAgent.detail, "Read package.json, CHANGELOG.md");
    assert.notEqual(focusedAgent.state, "idle");
    assert.equal(
      snapshot.agents.some((agent) => agent.id === `cursor-local:${staleSelectedComposerId}`),
      false
    );
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.events[0].threadId, focusedComposerId);
    assert.equal(snapshot.events[0].method, "cursor/local/prompt");
  } finally {
    if (typeof previousWorkspaceStorageDir === "string") {
      process.env.CURSOR_WORKSPACE_STORAGE_DIR = previousWorkspaceStorageDir;
    } else {
      delete process.env.CURSOR_WORKSPACE_STORAGE_DIR;
    }
    if (typeof previousLogsDir === "string") {
      process.env.CURSOR_LOGS_DIR = previousLogsDir;
    } else {
      delete process.env.CURSOR_LOGS_DIR;
    }
    if (typeof previousCursorUserDataDir === "string") {
      process.env.CURSOR_USER_DATA_DIR = previousCursorUserDataDir;
    } else {
      delete process.env.CURSOR_USER_DATA_DIR;
    }
  }
});

test("cursor local snapshot prefers agent transcripts over stale workspace sqlite inference", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-transcript-"));
  const projectRoot = path.join(tempRoot, "project");
  const workspaceStorageDir = path.join(tempRoot, "workspaceStorage");
  const logsDir = path.join(tempRoot, "logs");
  const workspaceDir = path.join(workspaceStorageDir, "workspace-1");
  const cursorProjectsDir = path.join(tempRoot, "cursor-projects");
  const projectSlug = projectRoot.replace(/^\/+/, "").replace(/[\\/]+/g, "-");
  const sessionId = "11111111-2222-3333-4444-555555555555";
  const transcriptDir = path.join(cursorProjectsDir, projectSlug, "agent-transcripts", sessionId);
  await mkdir(projectRoot, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(logsDir, "20260326T120000"), { recursive: true });
  await mkdir(transcriptDir, { recursive: true });

  const previousWorkspaceStorageDir = process.env.CURSOR_WORKSPACE_STORAGE_DIR;
  const previousLogsDir = process.env.CURSOR_LOGS_DIR;
  const previousCursorUserDataDir = process.env.CURSOR_USER_DATA_DIR;
  const previousCursorProjectsDir = process.env.CURSOR_PROJECTS_DIR;
  process.env.CURSOR_WORKSPACE_STORAGE_DIR = workspaceStorageDir;
  process.env.CURSOR_LOGS_DIR = logsDir;
  process.env.CURSOR_PROJECTS_DIR = cursorProjectsDir;
  delete process.env.CURSOR_USER_DATA_DIR;

  const now = Date.now();
  const composerId = "sqlite-composer";
  const composerData = JSON.stringify({
    allComposers: [
      {
        composerId,
        name: "Old sqlite composer",
        subtitle: "Should not win over transcript data",
        createdAt: now - (3 * 60 * 60 * 1000),
        lastUpdatedAt: now - (2 * 60 * 60 * 1000),
        unifiedMode: "agent",
        filesChangedCount: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      }
    ],
    selectedComposerIds: [composerId],
    lastFocusedComposerIds: [composerId]
  });
  const transcriptFile = path.join(transcriptDir, `${sessionId}.jsonl`);
  const transcriptLines = [
    JSON.stringify({
      role: "user",
      message: {
        content: [
          { type: "text", text: "<user_query>\nInspect the transcript-backed Cursor adapter\n</user_query>" }
        ]
      }
    }),
    JSON.stringify({
      role: "assistant",
      message: {
        content: [
          { type: "text", text: "Reading the transcript-backed Cursor adapter now." }
        ]
      }
    })
  ].join("\n") + "\n";

  try {
    await writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({
      folder: pathToFileURL(projectRoot).toString()
    }));
    await writeFile(path.join(workspaceDir, "state.vscdb"), Buffer.from([
      `composer.composerData${composerData}`
    ].join("\0"), "utf8"));
    await writeFile(path.join(logsDir, "20260326T120000", "main.log"), "");
    await writeFile(transcriptFile, transcriptLines);

    const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].id, `cursor-local:${sessionId}`);
    assert.match(snapshot.agents[0].label, /Inspect the transcript-backed Cursor adapter/);
    assert.equal(snapshot.agents[0].latestMessage, "Reading the transcript-backed Cursor adapter now.");
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.events[0].method, "cursor/local/agentMessage");
    assert.equal(snapshot.events[0].detail, "Reading the transcript-backed Cursor adapter now.");
  } finally {
    if (typeof previousWorkspaceStorageDir === "string") {
      process.env.CURSOR_WORKSPACE_STORAGE_DIR = previousWorkspaceStorageDir;
    } else {
      delete process.env.CURSOR_WORKSPACE_STORAGE_DIR;
    }
    if (typeof previousLogsDir === "string") {
      process.env.CURSOR_LOGS_DIR = previousLogsDir;
    } else {
      delete process.env.CURSOR_LOGS_DIR;
    }
    if (typeof previousCursorProjectsDir === "string") {
      process.env.CURSOR_PROJECTS_DIR = previousCursorProjectsDir;
    } else {
      delete process.env.CURSOR_PROJECTS_DIR;
    }
    if (typeof previousCursorUserDataDir === "string") {
      process.env.CURSOR_USER_DATA_DIR = previousCursorUserDataDir;
    } else {
      delete process.env.CURSOR_USER_DATA_DIR;
    }
  }
});

test("cursor local transcript snapshot treats recent tool use as active editing work", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-transcript-edit-"));
  const projectRoot = path.join(tempRoot, "project");
  const cursorProjectsDir = path.join(tempRoot, "cursor-projects");
  const projectSlug = projectRoot.replace(/^\/+/, "").replace(/[\\/]+/g, "-");
  const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const transcriptDir = path.join(cursorProjectsDir, projectSlug, "agent-transcripts", sessionId);
  const transcriptFile = path.join(transcriptDir, `${sessionId}.jsonl`);
  await mkdir(projectRoot, { recursive: true });
  await mkdir(transcriptDir, { recursive: true });

  const previousCursorProjectsDir = process.env.CURSOR_PROJECTS_DIR;
  process.env.CURSOR_PROJECTS_DIR = cursorProjectsDir;

  const transcriptLines = [
    JSON.stringify({
      role: "user",
      message: {
        content: [
          { type: "text", text: "<user_query>\nPatch the README spacing\n</user_query>" }
        ]
      }
    }),
    JSON.stringify({
      role: "assistant",
      model: "claude-3.7-sonnet",
      message: {
        content: [
          { type: "tool_use", name: "Edit", input: { file_path: "/tmp/project/README.md" } },
          { type: "text", text: "Updated the README spacing." }
        ]
      }
    })
  ].join("\n") + "\n";

  try {
    await writeFile(transcriptFile, transcriptLines);

    const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].state, "editing");
    assert.equal(snapshot.agents[0].isOngoing, true);
    assert.equal(snapshot.agents[0].sourceKind, "cursor:claude-3.7-sonnet");
    assert.equal(snapshot.agents[0].latestMessage, "Updated the README spacing.");
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.events[0].method, "cursor/local/agentMessage");
  } finally {
    if (typeof previousCursorProjectsDir === "string") {
      process.env.CURSOR_PROJECTS_DIR = previousCursorProjectsDir;
    } else {
      delete process.env.CURSOR_PROJECTS_DIR;
    }
  }
});

test("cursor diagnostics report when the api key is missing", { concurrency: false }, async () => {
  const previousValue = process.env.CURSOR_API_KEY;
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), "cursor-settings-missing-"));
  delete process.env.CODEX_HOME;
  resetAppSettingsCacheForTest();
  delete process.env.CURSOR_API_KEY;
  try {
    assert.equal(cursorApiKeyConfigured(), false);
    assert.equal(
      await describeCursorAgentAvailability("/workspaces/CodexAgentsOffice"),
      "Cursor background agents disabled: CURSOR_API_KEY is not configured for this process."
    );
  } finally {
    if (typeof previousValue === "string") {
      process.env.CURSOR_API_KEY = previousValue;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
    if (typeof previousXdgConfigHome === "string") {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (typeof previousCodexHome === "string") {
      process.env.CODEX_HOME = previousCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    resetAppSettingsCacheForTest();
  }
});

test("stored cursor api key enables cursor integration without CURSOR_API_KEY", { concurrency: false }, async () => {
  const previousCursorApiKey = process.env.CURSOR_API_KEY;
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), "cursor-settings-stored-"));
  delete process.env.CODEX_HOME;
  delete process.env.CURSOR_API_KEY;
  resetAppSettingsCacheForTest();

  try {
    assert.equal(cursorApiKeyConfigured(), false);
    await setStoredCursorApiKey("cursor_test_12345678");
    assert.equal(cursorApiKeyConfigured(), true);
    assert.deepEqual(describeCursorIntegrationSettings(), {
      configured: true,
      source: "stored",
      maskedKey: "curs...5678",
      storedConfigured: true,
      storedMaskedKey: "curs...5678"
    });
    const savedSettings = await readFile(getAppSettingsFilePath(), "utf8");
    assert.match(savedSettings, /cursor_test_12345678/);
  } finally {
    if (typeof previousCursorApiKey === "string") {
      process.env.CURSOR_API_KEY = previousCursorApiKey;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
    if (typeof previousXdgConfigHome === "string") {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (typeof previousCodexHome === "string") {
      process.env.CODEX_HOME = previousCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    resetAppSettingsCacheForTest();
  }
});

test("cursor diagnostics report when a git project has no origin remote", { concurrency: false }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-diagnostics-"));
  await execFileAsync("git", ["init", projectRoot]);

  const previousValue = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = "test-key";
  try {
    assert.equal(
      await describeCursorAgentAvailability(projectRoot),
      "Cursor background agents unavailable for this project: git remote.origin.url is missing."
    );
  } finally {
    if (typeof previousValue === "string") {
      process.env.CURSOR_API_KEY = previousValue;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
  }
});

test("cursor agents match the current repo when Cursor reports a PR URL instead of source.repository", () => {
  assert.equal(
    cursorAgentMatchesRepository(
      {
        source: {
          prUrl: "https://github.com/example-org/CodexAgentsOffice/pull/123"
        }
      },
      "https://github.com/example-org/CodexAgentsOffice.git"
    ),
    true
  );
  assert.equal(
    cursorAgentMatchesRepository(
      {
        target: {
          prUrl: "https://github.com/example-org/CodexAgentsOffice/pull/456"
        }
      },
      "git@github.com:example-org/CodexAgentsOffice.git"
    ),
    true
  );
});
