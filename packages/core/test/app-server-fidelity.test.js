const test = require("node:test");
const assert = require("node:assert/strict");

const { parseAppServerMessage } = require("../dist/app-server.js");
const {
  buildDashboardEventFromAppServerMessage,
  buildRolloutHookEvent,
  buildThreadReadAgentMessageEvent,
  parseApplyPatchInput,
  ProjectLiveMonitor,
  shouldMarkThreadLiveFromAppServerNotification,
  shouldMarkThreadStoppedFromAppServerNotification
} = require("../dist/live-monitor.js");
const {
  applyRecentActivityEvent,
  buildDashboardSnapshotFromState,
  parentThreadIdForThread,
  summariseThread
} = require("../dist/snapshot.js");
const { applyCurrentWorkloadState, isCurrentWorkloadAgent } = require("../dist/workload.js");
const {
  buildCodexLocalAdapterSnapshotFromState,
  selectProjectThreadsWithParents
} = require("../dist/adapters/codex-local.js");

function sampleThread() {
  return {
    id: "thr_123",
    preview: "Fix tests",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1730831111,
    updatedAt: 1730832111,
    status: { type: "active", activeFlags: [] },
    path: "/tmp/thread.jsonl",
    cwd: "/tmp/CodexAgentsOffice",
    cliVersion: "0.0.0",
    source: "vscode",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Fix tests",
    turns: [
      {
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: [
          {
            type: "commandExecution",
            command: "npm test",
            cwd: "/tmp/CodexAgentsOffice",
            status: "inProgress"
          }
        ]
      }
    ]
  };
}

test("parseAppServerMessage distinguishes response, notification, and server request", () => {
  assert.deepEqual(
    parseAppServerMessage(JSON.stringify({ id: 1, result: { ok: true } })),
    { kind: "response", message: { id: 1, result: { ok: true }, error: undefined } }
  );

  assert.deepEqual(
    parseAppServerMessage(JSON.stringify({ method: "turn/started", params: { threadId: "thr_1" } })),
    { kind: "notification", message: { method: "turn/started", params: { threadId: "thr_1" } } }
  );

  assert.deepEqual(
    parseAppServerMessage(JSON.stringify({ id: 7, method: "item/tool/requestUserInput", params: { threadId: "thr_1" } })),
    { kind: "serverRequest", message: { id: 7, method: "item/tool/requestUserInput", params: { threadId: "thr_1" } } }
  );
});

test("command approval requests become typed approval events", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      id: 41,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        itemId: "item_cmd",
        command: "npm publish",
        cwd: "/tmp/CodexAgentsOffice",
        reason: "needs publish access",
        availableDecisions: ["accept", "decline"]
      }
    }
  );

  assert.equal(event.kind, "approval");
  assert.equal(event.phase, "waiting");
  assert.equal(event.requestId, "41");
  assert.equal(event.itemId, "item_cmd");
  assert.equal(event.command, "npm publish");
  assert.equal(event.cwd, "/tmp/CodexAgentsOffice");
  assert.deepEqual(event.availableDecisions, ["accept", "decline"]);
});

test("file change completion events keep final file metadata", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      method: "item/completed",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        item: {
          id: "item_file",
          type: "fileChange",
          status: "completed",
          changes: [
            {
              path: "/tmp/CodexAgentsOffice/packages/core/src/live-monitor.ts",
              kind: "edit",
              linesAdded: 12,
              linesRemoved: 4
            }
          ]
        }
      }
    }
  );

  assert.equal(event.kind, "fileChange");
  assert.equal(event.phase, "completed");
  assert.equal(event.itemId, "item_file");
  assert.equal(event.action, "edited");
  assert.equal(event.linesAdded, 12);
  assert.equal(event.linesRemoved, 4);
  assert.match(event.path, /packages\/core\/src\/live-monitor\.ts$/);
});

test("agent message deltas become typed streaming message events", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        itemId: "item_msg",
        delta: "Checking the live snapshot."
      }
    }
  );

  assert.equal(event.kind, "message");
  assert.equal(event.phase, "updated");
  assert.equal(event.itemId, "item_msg");
  assert.equal(event.title, "Reply updated");
  assert.equal(event.detail, "Checking the live snapshot.");
});

test("resolved requests clear as completed events when pending request context is provided", () => {
  const event = buildDashboardEventFromAppServerMessage(
    {
      projectRoot: "/tmp/CodexAgentsOffice",
      pendingRequest: {
        kind: "input",
        requestId: "55",
        threadId: "thr_123",
        createdAt: new Date().toISOString(),
        turnId: "turn_9",
        itemId: "item_prompt",
        reason: "Need confirmation"
      }
    },
    {
      method: "serverRequest/resolved",
      params: {
        threadId: "thr_123",
        requestId: "55"
      }
    }
  );

  assert.equal(event.kind, "input");
  assert.equal(event.phase, "completed");
  assert.equal(event.requestId, "55");
  assert.equal(event.title, "Input resolved");
});

test("observer unload notifications do not masquerade as thread completion", () => {
  assert.equal(shouldMarkThreadLiveFromAppServerNotification("thread/status/changed", "active"), true);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("turn/completed"), true);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/archived"), true);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/closed"), false);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/status/changed", "idle"), false);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/status/changed", "notLoaded"), false);
});

test("thread closed marks an ongoing monitored thread stopped immediately", () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const thread = {
    ...sampleThread(),
    status: { type: "active" },
    updatedAt: Math.floor(Date.now() / 1000)
  };

  monitor.threads.set(thread.id, thread);
  monitor.markThreadLive(thread.id);
  monitor.handleAppServerNotification({
    method: "thread/closed",
    params: {
      threadId: thread.id
    }
  });

  assert.equal(monitor.ongoingThreadIds.has(thread.id), false);
  assert.equal(monitor.stoppedAtByThreadId.has(thread.id), true);
});

test("notLoaded status waits for a short cooldown before stopping an ongoing monitored thread", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const thread = {
    ...sampleThread(),
    status: { type: "active" },
    updatedAt: Math.floor(Date.now() / 1000)
  };
  const dormantNotLoadedThread = {
    ...thread,
    status: { type: "notLoaded" },
    turns: [
      {
        ...thread.turns[0],
        status: "completed",
        items: [
          {
            ...thread.turns[0].items[0],
            status: "completed"
          }
        ]
      }
    ]
  };

  monitor.threads.set(thread.id, thread);
  monitor.markThreadLive(thread.id);
  monitor.client = {
    readThread: async () => dormantNotLoadedThread
  };
  monitor.handleAppServerNotification({
    method: "thread/status/changed",
    params: {
      threadId: thread.id,
      status: {
        type: "notLoaded"
      }
    }
  });

  assert.equal(monitor.ongoingThreadIds.has(thread.id), true);
  assert.equal(monitor.stoppedAtByThreadId.has(thread.id), false);

  await new Promise((resolve) => setTimeout(resolve, 3200));

  assert.equal(monitor.ongoingThreadIds.has(thread.id), false);
  assert.equal(monitor.stoppedAtByThreadId.has(thread.id), true);
});

test("pending notLoaded cooldown suppresses an early stop during reread confirmation", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const thread = {
    ...sampleThread(),
    status: { type: "active" },
    updatedAt: Math.floor(Date.now() / 1000)
  };
  const dormantNotLoadedThread = {
    ...thread,
    status: { type: "notLoaded" },
    turns: [
      {
        ...thread.turns[0],
        status: "completed",
        items: [
          {
            ...thread.turns[0].items[0],
            status: "completed"
          }
        ]
      }
    ]
  };

  monitor.threads.set(thread.id, thread);
  monitor.markThreadLive(thread.id);
  monitor.schedulePendingNotLoadedStop(thread.id);
  monitor.client = {
    readThread: async () => dormantNotLoadedThread
  };

  await monitor.refreshThread(thread.id);

  assert.equal(monitor.ongoingThreadIds.has(thread.id), true);
  assert.equal(monitor.stoppedAtByThreadId.has(thread.id), false);
  monitor.clearPendingNotLoadedStop(thread.id);
});

test("tool call server requests become typed tool events", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      id: 72,
      method: "item/tool/call",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        itemId: "item_tool",
        tool: "browser_snapshot"
      }
    }
  );

  assert.equal(event.kind, "tool");
  assert.equal(event.phase, "started");
  assert.equal(event.requestId, "72");
  assert.equal(event.itemId, "item_tool");
  assert.equal(event.title, "Tool call requested");
  assert.equal(event.detail, "browser_snapshot");
});

test("turn plan updates summarize the documented explanation and plan payload", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      method: "turn/plan/updated",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        explanation: "Review parser coverage against the official app-server docs.",
        plan: [
          { step: "Read the events page", status: "completed" },
          { step: "Compare parser coverage", status: "inProgress" }
        ]
      }
    }
  );

  assert.equal(event.kind, "turn");
  assert.equal(event.phase, "updated");
  assert.equal(event.title, "Plan updated");
  assert.equal(event.detail, "Review parser coverage against the official app-server docs.");
});

test("turn diff updates summarize the documented diff payload", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      method: "turn/diff/updated",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        diff: [
          "diff --git a/packages/core/src/live-monitor.ts b/packages/core/src/live-monitor.ts",
          "--- a/packages/core/src/live-monitor.ts",
          "+++ b/packages/core/src/live-monitor.ts"
        ].join("\n")
      }
    }
  );

  assert.equal(event.kind, "turn");
  assert.equal(event.phase, "updated");
  assert.equal(event.title, "Diff updated");
  assert.equal(event.detail, "packages/core/src/live-monitor.ts");
});

test("web search completion events summarize action payloads", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      method: "item/completed",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        item: {
          id: "item_web",
          type: "webSearch",
          action: {
            type: "openPage",
            url: "https://developers.openai.com/codex/app-server#events"
          }
        }
      }
    }
  );

  assert.equal(event.kind, "tool");
  assert.equal(event.phase, "completed");
  assert.equal(event.itemId, "item_web");
  assert.equal(event.detail, "https://developers.openai.com/codex/app-server#events");
});

test("thread rereads synthesize assistant message events for desktop replies", () => {
  const thread = {
    ...sampleThread(),
    updatedAt: 1730832999,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_msg_1",
            type: "agentMessage",
            phase: "commentary",
            text: "Preview bridge reply from the desktop thread."
          }
        ]
      }
    ]
  };

  const event = buildThreadReadAgentMessageEvent(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    thread
  );

  assert.ok(event);
  assert.equal(event.kind, "message");
  assert.equal(event.method, "thread/read/agentMessage");
  assert.equal(event.threadId, "thr_123");
  assert.equal(event.itemId, "item_msg_1");
  assert.equal(event.phase, "completed");
  assert.equal(event.confidence, "typed");
  assert.equal(event.detail, "Preview bridge reply from the desktop thread.");
});

test("snapshot carries typed needs-user and live subscription metadata", async () => {
  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [sampleThread()],
    events: [],
    needsUserByThreadId: new Map([
      ["thr_123", { kind: "approval", requestId: "88", reason: "Need approval" }]
    ]),
    subscribedThreadIds: new Set(["thr_123"])
  });

  assert.equal(snapshot.agents.length >= 1, true);
  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.deepEqual(agent.needsUser, { kind: "approval", requestId: "88", reason: "Need approval" });
  assert.equal(agent.liveSubscription, "subscribed");
});

test("typed approval waits surface as blocked current workload", async () => {
  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [sampleThread()],
    events: [],
    needsUserByThreadId: new Map([
      ["thr_123", { kind: "approval", requestId: "88", reason: "Need approval" }]
    ])
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "blocked");
  assert.equal(agent.detail, "Waiting on approval");
  assert.equal(agent.isCurrent, true);
});

test("typed input waits surface as waiting current workload", async () => {
  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [sampleThread()],
    events: [],
    needsUserByThreadId: new Map([
      ["thr_123", { kind: "input", requestId: "99", reason: "Need answer" }]
    ])
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "waiting");
  assert.equal(agent.detail, "Waiting on input");
  assert.equal(agent.isCurrent, true);
});

test("completed command, file, and tool items settle to done instead of active work", () => {
  const updatedAt = Math.floor((Date.now() - 10_000) / 1000);
  const cases = [
    {
      item: {
        type: "commandExecution",
        command: "npm test",
        cwd: "/tmp/CodexAgentsOffice",
        status: "completed"
      }
    },
    {
      item: {
        type: "fileChange",
        status: "completed",
        changes: [{ path: "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts", kind: "edit" }]
      }
    },
    {
      item: {
        type: "dynamicToolCall",
        name: "browser_snapshot",
        status: "completed"
      }
    }
  ];

  for (const { item } of cases) {
    const summary = summariseThread({
      ...sampleThread(),
      status: { type: "idle" },
      updatedAt,
      turns: [{
        id: "turn_1",
        status: "completed",
        error: null,
        items: [item]
      }]
    });

    assert.equal(summary.state, "done");
  }
});

test("failed command items preserve the explicit error detail for blocked hover state", () => {
  const summary = summariseThread({
    ...sampleThread(),
    status: { type: "active", activeFlags: [] },
    turns: [{
      id: "turn_1",
      status: "inProgress",
      error: null,
      items: [{
        type: "commandExecution",
        command: "curl -sf http://127.0.0.1:4181/api/server-meta",
        cwd: "/tmp/CodexAgentsOffice",
        status: "failed",
        error: {
          message: "Connection refused"
        }
      }]
    }]
  });

  assert.equal(summary.state, "blocked");
  assert.equal(summary.detail, "Connection refused");
  assert.equal(summary.activityEvent?.title, "curl -sf http://127.0.0.1:4181/api/server-meta");
});

test("recent command activity does not reactivate a completed thread", () => {
  const thread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Finished work.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const summary = summariseThread(thread);
  const next = applyRecentActivityEvent(thread, summary, [
    {
      id: "evt_cmd_started",
      source: "codex",
      confidence: "typed",
      threadId: "thr_123",
      createdAt: new Date().toISOString(),
      method: "rollout/exec_command/started",
      kind: "command",
      phase: "started",
      title: "Command started",
      detail: "npm test",
      path: "/tmp/CodexAgentsOffice",
      command: "npm test"
    }
  ]);

  assert.equal(next.state, "done");
  assert.equal(next.detail, "Finished work.");
});

test("codex local adapter keeps message detail aligned with the newest thread reply", async () => {
  const thread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: 1730832999,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_msg_new",
            type: "agentMessage",
            phase: "final_answer",
            text: "something"
          }
        ]
      }
    ]
  };

  const snapshot = await buildCodexLocalAdapterSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [thread],
    events: [
      {
        id: "evt_old_message",
        source: "codex",
        confidence: "typed",
        kind: "message",
        phase: "completed",
        title: "Reply completed",
        detail: "The older commentary reply that should not win.",
        createdAt: "2024-11-05T10:15:30.000Z",
        threadId: "thr_123",
        turnId: "turn_1",
        itemId: "item_msg_old",
        path: "/tmp/CodexAgentsOffice",
        method: "thread/read/agentMessage"
      }
    ]
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.latestMessage, "something");
  assert.equal(agent.detail, "something");
  assert.equal(agent.activityEvent?.type, "agentMessage");
  assert.equal(agent.activityEvent?.title, "something");
});

test("stale historical message events do not override dormant thread summaries", async () => {
  const threeDaysAgoMs = Date.now() - (3 * 24 * 60 * 60 * 1000);
  const dormantThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor(threeDaysAgoMs / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Dormant final reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [dormantThread],
    events: [
      {
        id: "evt_stale_msg",
        source: "codex",
        confidence: "typed",
        threadId: "thr_123",
        createdAt: new Date(threeDaysAgoMs + 5_000).toISOString(),
        method: "thread/read/agentMessage",
        turnId: "turn_1",
        itemId: "item_msg_stale",
        kind: "message",
        phase: "completed",
        title: "Reply completed",
        detail: "Random stale text from days ago",
        path: "/tmp/CodexAgentsOffice"
      }
    ]
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.detail, "Dormant final reply");
  assert.equal(agent.activityEvent?.title, "Dormant final reply");
});

test("fresh local thinking agents do not remain current when they are only read-only", () => {
  const now = Date.parse("2026-03-24T00:00:00.000Z");
  const agent = {
    id: "thr_live",
    label: "Live worker",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "idle",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "thinking",
    detail: "Reply updated",
    cwd: "/tmp/ProjectAtlas",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-23T23:59:20.000Z",
    stoppedAt: null,
    paths: ["/tmp/ProjectAtlas"],
    activityEvent: null,
    latestMessage: "Still working",
    threadId: "thr_live",
    taskId: null,
    resumeCommand: "codex resume thr_live",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly"
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), false);
});

test("fresh read-only local planning agents remain current for a short lag window", () => {
  const now = Date.parse("2026-03-24T00:00:00.000Z");
  const agent = {
    id: "thr_plan",
    label: "Fresh child",
    source: "local",
    sourceKind: "subAgent",
    parentThreadId: "thr_parent",
    depth: 1,
    isCurrent: false,
    isOngoing: false,
    statusText: "idle",
    role: "worker",
    nickname: null,
    isSubagent: true,
    state: "planning",
    detail: "Inspect client-script.ts",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-23T23:59:45.000Z",
    stoppedAt: null,
    paths: ["/tmp/CodexAgentsOffice/packages/web/src/client-script.ts"],
    activityEvent: null,
    latestMessage: null,
    threadId: "thr_plan",
    taskId: null,
    resumeCommand: "codex resume thr_plan",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly"
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), true);
});

test("fresh subscribed local thinking agents remain current for a short live window", () => {
  const now = Date.parse("2026-03-24T00:00:00.000Z");
  const agent = {
    id: "thr_live",
    label: "Live worker",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "idle",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "thinking",
    detail: "Reply updated",
    cwd: "/tmp/ProjectAtlas",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-23T23:59:45.000Z",
    stoppedAt: null,
    paths: ["/tmp/ProjectAtlas"],
    activityEvent: null,
    latestMessage: "Still working",
    threadId: "thr_live",
    taskId: null,
    resumeCommand: "codex resume thr_live",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "subscribed"
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), true);
});

test("parentThreadIdForThread extracts ancestor ids from subagent metadata", () => {
  const thread = {
    ...sampleThread(),
    source: {
      subAgent: {
        thread_spawn: {
          parent_thread_id: "thr_parent",
          depth: 1
        }
      }
    }
  };

  assert.equal(parentThreadIdForThread(thread), "thr_parent");
});

test("active local threads remain current even when the last update is stale", async () => {
  const staleThread = {
    ...sampleThread(),
    updatedAt: 1,
    turns: [
      {
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: [
          {
            type: "reasoning",
            text: "Still working"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [staleThread],
    events: []
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.statusText, "active");
  assert.equal(agent.state, "thinking");
  assert.equal(agent.isCurrent, true);
});

test("notLoaded threads with an in-progress turn remain current", async () => {
  const activeButNotLoadedThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: 1,
    turns: [
      {
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: [
          {
            type: "reasoning",
            text: "Still working from a read-only thread payload"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [activeButNotLoadedThread],
    events: [],
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.statusText, "notLoaded");
  assert.equal(agent.state, "thinking");
  assert.equal(agent.isOngoing, true);
  assert.equal(agent.isCurrent, true);
});

test("plan items map to planning instead of synthetic thinking", async () => {
  const planningThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: 1,
    turns: [
      {
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: [
          {
            type: "plan",
            explanation: "Compare the state mapping against the app-server events."
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [planningThread],
    events: [],
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "planning");
  assert.equal(agent.detail, "Compare the state mapping against the app-server events.");
  assert.equal(agent.isCurrent, true);
});

test("fresh spawned notLoaded subagent threads without turns still read as live", async () => {
  const freshSpawnedThread = {
    ...sampleThread(),
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor((Date.now() + 60_000) / 1000),
    status: { type: "notLoaded" },
    source: {
      subAgent: {
        thread_spawn: {
          parent_thread_id: "thr_parent",
          depth: 1
        }
      }
    },
    turns: []
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [freshSpawnedThread],
    events: [],
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "planning");
  assert.equal(agent.isOngoing, true);
  assert.equal(agent.isCurrent, true);
});

test("in-progress turns without a stronger item signal default to planning", async () => {
  const activeWithoutItemsThread = {
    ...sampleThread(),
    status: { type: "active", activeFlags: [] },
    turns: [
      {
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: []
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [activeWithoutItemsThread],
    events: []
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "planning");
  assert.equal(agent.detail, "Planning");
  assert.equal(agent.isCurrent, true);
});

test("recently finished local threads stay current for a short grace window", async () => {
  const recentDoneThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor(Date.now() / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Wrapped up the change.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [recentDoneThread],
    events: []
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.isCurrent, true);
});

test("stopped local live states settle to done immediately for rendering", () => {
  const now = Date.parse("2026-03-24T00:00:01.000Z");
  const snapshot = applyCurrentWorkloadState({
    projectRoot: "/tmp/CodexAgentsOffice",
    projectLabel: "CodexAgentsOffice",
    projectIdentity: null,
    generatedAt: "2026-03-24T00:00:01.000Z",
    rooms: {
      version: 1,
      generated: true,
      filePath: "",
      rooms: []
    },
    agents: [
      {
        id: "thr_done_render",
        label: "Finished worker",
        source: "local",
        sourceKind: "vscode",
        parentThreadId: null,
        depth: 0,
        isCurrent: false,
        isOngoing: false,
        statusText: "idle",
        role: null,
        nickname: null,
        isSubagent: false,
        state: "thinking",
        detail: "Wrapped up the change.",
        cwd: "/tmp/CodexAgentsOffice",
        roomId: "root",
        appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
        updatedAt: "2026-03-24T00:00:00.500Z",
        stoppedAt: "2026-03-24T00:00:00.500Z",
        paths: ["/tmp/CodexAgentsOffice"],
        activityEvent: null,
        latestMessage: "Wrapped up the change.",
        threadId: "thr_done_render",
        taskId: null,
        resumeCommand: "codex resume thr_done_render",
        url: null,
        git: null,
        provenance: "codex",
        confidence: "typed",
        needsUser: null,
        liveSubscription: "readOnly"
      }
    ],
    cloudTasks: [],
    events: [],
    notes: []
  }, now);

  assert.equal(snapshot.agents[0].state, "done");
  assert.equal(snapshot.agents[0].isCurrent, true);
});

test("recently finished top-level threads stay current for a 5 second cooldown window", () => {
  const agent = {
    id: "thr_done_top_level",
    label: "Finished lead",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "idle",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "done",
    detail: "Wrapped up the change.",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-24T00:00:00.000Z",
    stoppedAt: "2026-03-24T00:00:00.000Z",
    paths: ["/tmp/CodexAgentsOffice"],
    activityEvent: null,
    latestMessage: "Wrapped up the change.",
    threadId: "thr_done_top_level",
    taskId: null,
    resumeCommand: "codex resume thr_done_top_level",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly"
  };

  assert.equal(isCurrentWorkloadAgent(agent, Date.parse("2026-03-24T00:00:04.999Z")), true);
  assert.equal(isCurrentWorkloadAgent(agent, Date.parse("2026-03-24T00:00:05.001Z")), false);
});

test("recently finished subagents leave current workload faster than top-level threads", () => {
  const now = Date.parse("2026-03-24T00:00:05.000Z");
  const subagent = {
    id: "thr_sub_done",
    label: "Child worker",
    source: "local",
    sourceKind: "subAgent",
    parentThreadId: "thr_parent",
    depth: 1,
    isCurrent: false,
    isOngoing: false,
    statusText: "idle",
    role: "worker",
    nickname: null,
    isSubagent: true,
    state: "done",
    detail: "Finished",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-24T00:00:03.000Z",
    stoppedAt: "2026-03-24T00:00:03.000Z",
    paths: ["/tmp/CodexAgentsOffice"],
    activityEvent: null,
    latestMessage: null,
    threadId: "thr_sub_done",
    taskId: null,
    resumeCommand: "codex resume thr_sub_done",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly"
  };

  assert.equal(isCurrentWorkloadAgent(subagent, now), false);
});

test("stale local blocked threads do not stay current forever without ongoing state", () => {
  const now = Date.parse("2026-03-25T12:00:00.000Z");
  const blockedAgent = {
    id: "thr_blocked_old",
    label: "Old blocked thread",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "notLoaded",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "blocked",
    detail: "old failed command",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-24T15:32:00.000Z",
    stoppedAt: null,
    paths: ["/tmp/CodexAgentsOffice"],
    activityEvent: null,
    latestMessage: null,
    threadId: "thr_blocked_old",
    taskId: null,
    resumeCommand: "codex resume thr_blocked_old",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly"
  };

  assert.equal(isCurrentWorkloadAgent(blockedAgent, now), false);
});

test("recently finished local threads stay current even when live monitor bookkeeping has not set stoppedAt yet", async () => {
  const recentDoneThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor(Date.now() / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Wrapped up the change.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [recentDoneThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.stoppedAt, null);
  assert.equal(agent.isCurrent, true);
});

test("codex local adapter keeps parent threads available even when only the child cwd matches the project", () => {
  const parentThread = {
    ...sampleThread(),
    id: "thr_parent",
    cwd: "/mnt/f/SomeOtherWorkspace",
    source: "vscode",
    turns: []
  };
  const childThread = {
    ...sampleThread(),
    id: "thr_child",
    cwd: "/tmp/CodexAgentsOffice",
    source: {
      subAgent: {
        thread_spawn: {
          parent_thread_id: "thr_parent",
          depth: 1
        }
      }
    },
    turns: []
  };

  const selected = selectProjectThreadsWithParents(
    "/tmp/CodexAgentsOffice",
    [parentThread, childThread],
    24
  );

  assert.deepEqual(selected.map((thread) => thread.id), ["thr_child", "thr_parent"]);
});

test("codex local adapter keeps active threads selected even when a newer idle thread would fill the limit", () => {
  const now = Math.floor(Date.now() / 1000);
  const activeThread = {
    ...sampleThread(),
    id: "thr_active",
    updatedAt: now - 3600,
    status: { type: "active", activeFlags: [] },
    turns: []
  };
  const recentIdleThread = {
    ...sampleThread(),
    id: "thr_recent",
    updatedAt: now,
    status: { type: "idle" },
    turns: []
  };

  const selected = selectProjectThreadsWithParents(
    "/tmp/CodexAgentsOffice",
    [recentIdleThread, activeThread],
    1
  );

  assert.deepEqual(selected.map((thread) => thread.id), ["thr_active"]);
});

test("codex local adapter synthesizes stoppedAt for quiet static done threads", async () => {
  const quietDoneThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 60_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Done.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildCodexLocalAdapterSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [quietDoneThread],
    events: [],
    notes: []
  });

  assert.equal(snapshot.agents.length, 1);
  assert.equal(snapshot.agents[0].state, "done");
  assert.notEqual(snapshot.agents[0].stoppedAt, null);
});

test("explicit stop tracking keeps an ongoing quiet thread current", async () => {
  const ongoingQuietThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 60_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Wrapped up this step, staying on thread.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [ongoingQuietThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set(["thr_123"])
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.stoppedAt, null);
  assert.equal(agent.isCurrent, true);
});

test("quiet local threads without ongoing tracking are not kept current forever", async () => {
  const quietThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 60_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Done.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [quietThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.isOngoing, false);
  assert.equal(agent.isCurrent, false);
});

test("future-skewed done local threads are not kept current indefinitely", () => {
  const now = Date.parse("2026-03-27T12:15:58.377Z");
  const agent = {
    id: "thr_future_done",
    label: "Finished task",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "notLoaded",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "done",
    detail: "Wrapped up the change.",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: null,
    appearance: null,
    updatedAt: "2026-03-27T13:08:53.000Z",
    stoppedAt: null,
    paths: [],
    activityEvent: null,
    latestMessage: "Wrapped up the change.",
    threadId: "thr_future_done",
    taskId: null,
    resumeCommand: "codex resume thr_future_done",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly",
    network: null
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), false);
});

test("future-skewed ongoing local threads still remain current", () => {
  const now = Date.parse("2026-03-27T12:15:58.377Z");
  const agent = {
    id: "thr_future_live",
    label: "Running task",
    source: "local",
    sourceKind: "subAgent",
    parentThreadId: "thr_parent",
    depth: 1,
    isCurrent: false,
    isOngoing: true,
    statusText: "notLoaded",
    role: "explorer",
    nickname: "Hegel",
    isSubagent: true,
    state: "thinking",
    detail: "Inspecting the repo.",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: null,
    appearance: null,
    updatedAt: "2026-03-27T13:08:53.000Z",
    stoppedAt: null,
    paths: [],
    activityEvent: null,
    latestMessage: null,
    threadId: "thr_future_live",
    taskId: null,
    resumeCommand: "codex resume thr_future_live",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "subscribed",
    network: null
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), true);
});

test("future-skewed fresh user-prompt local threads remain current", () => {
  const now = Date.parse("2026-03-27T12:15:58.377Z");
  const agent = {
    id: "thr_future_prompt",
    label: "Deploy current build",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "idle",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "done",
    detail: "no nothing is working right now.",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: null,
    appearance: null,
    updatedAt: "2026-03-27T13:51:49.000Z",
    stoppedAt: null,
    paths: ["/tmp/CodexAgentsOffice"],
    activityEvent: {
      type: "userMessage",
      action: "updated",
      path: "/tmp/CodexAgentsOffice",
      title: "no nothing is working right now.",
      isImage: false
    },
    latestMessage: "Another live test message. If the office is behaving, this thread should be the only one updating right now.",
    threadId: "thr_future_prompt",
    taskId: null,
    resumeCommand: "codex resume thr_future_prompt",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "subscribed",
    network: null
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), true);
});

test("future-skewed subscribed live local threads do not remain current just from stale commentary", () => {
  const now = Date.parse("2026-03-27T12:15:58.377Z");
  const agent = {
    id: "thr_future_commentary",
    label: "Deploy current build",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "notLoaded",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "thinking",
    detail: "Checking the live snapshot.",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: null,
    appearance: null,
    updatedAt: "2026-03-27T13:56:08.000Z",
    stoppedAt: null,
    paths: ["/tmp/CodexAgentsOffice"],
    activityEvent: {
      type: "agentMessage",
      action: "said",
      path: "/tmp/CodexAgentsOffice",
      title: "Checking the live snapshot.",
      isImage: false
    },
    latestMessage: "Checking the live snapshot.",
    threadId: "thr_future_commentary",
    taskId: null,
    resumeCommand: "codex resume thr_future_commentary",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "subscribed",
    network: null
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), false);
});

test("completed commentary replies do not stay in thinking state once the turn is done", async () => {
  const completedCommentaryThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Wrapped up the reply.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [completedCommentaryThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.isCurrent, false);
});

test("completed context compaction does not stay in thinking state once the turn is done", async () => {
  const completedCompactionThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "contextCompaction"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [completedCompactionThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.isCurrent, false);
});

test("interrupted commentary replies stay in thinking state while the subscribed thread is still fresh", async () => {
  const interruptedCommentaryThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "interrupted",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Checking the next part of the state transition.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [interruptedCommentaryThread],
    events: [],
    subscribedThreadIds: new Set(["thr_123"]),
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "thinking");
  assert.equal(agent.isCurrent, true);
});

test("stale interrupted commentary settles out of thinking on startup", async () => {
  const staleInterruptedThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: Math.floor((Date.now() - (24 * 60 * 60 * 1000)) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "interrupted",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Old commentary text that should not keep the thread live.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [staleInterruptedThread],
    events: [],
    subscribedThreadIds: new Set(),
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.isCurrent, false);
});

test("stale process-only local threads settle to idle on startup", async () => {
  const staleCompactionThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: Math.floor((Date.now() - (24 * 60 * 60 * 1000)) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "interrupted",
        error: null,
        items: [
          {
            type: "contextCompaction"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [staleCompactionThread],
    events: [],
    subscribedThreadIds: new Set(),
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "idle");
  assert.equal(agent.isCurrent, false);
});

test("fresh user prompts stay planning-current before the next turn starts", async () => {
  const freshPromptThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "userMessage",
            content: [
              {
                text: "Check why the desk agent disappeared"
              }
            ]
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [freshPromptThread],
    events: [],
    subscribedThreadIds: new Set(["thr_123"]),
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "planning");
  assert.equal(agent.isCurrent, true);
});

test("fresh completed reply events keep final reply activity without reactivating the desk", async () => {
  const quietThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Done.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [quietThread],
    events: [
      {
        id: "evt_msg",
        source: "codex",
        confidence: "typed",
        threadId: "thr_123",
        createdAt: new Date().toISOString(),
        method: "thread/read/agentMessage",
        turnId: "turn_1",
        itemId: "item_msg",
        kind: "message",
        phase: "completed",
        title: "Reply completed",
        detail: "Final reply text",
        path: "/tmp/CodexAgentsOffice"
      }
    ],
    subscribedThreadIds: new Set(["thr_123"]),
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.isCurrent, false);
  assert.equal(agent.activityEvent?.type, "agentMessage");
  assert.equal(agent.detail, "Final reply text");
});

test("shared cloud rate-limit notes stay human readable", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });

  monitor.setSharedCloudTasks([], "Codex cloud temporarily rate-limited; retrying in 5 minutes.");
  await monitor.rebuildSnapshot();

  const snapshot = monitor.getSnapshot();
  assert.ok(snapshot);
  assert.ok(snapshot.notes.includes("Codex cloud temporarily rate-limited; retrying in 5 minutes."));
});

test("live monitor drops stale historical events instead of replaying them on startup", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });

  monitor.pushRecentEvent({
    id: "evt_old_rollout",
    source: "codex",
    confidence: "typed",
    threadId: "thr_123",
    createdAt: new Date(Date.now() - (3 * 24 * 60 * 60 * 1000)).toISOString(),
    method: "rollout/exec_command/completed",
    itemId: "item_old",
    kind: "command",
    phase: "completed",
    title: "Command completed",
    detail: "echo stale",
    path: "/tmp/CodexAgentsOffice",
    command: "echo stale",
    action: "ran"
  });

  await monitor.rebuildSnapshot();
  const snapshot = monitor.getSnapshot();
  assert.ok(snapshot);
  assert.equal(
    snapshot.events.some((event) => event.id === "evt_old_rollout" || event.detail === "echo stale"),
    false
  );
});

test("initial thread hydration does not replay dormant final replies as fresh message events", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const threeDaysAgoMs = Date.now() - (3 * 24 * 60 * 60 * 1000);
  const listedThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor(threeDaysAgoMs / 1000),
    turns: []
  };
  const hydratedThread = {
    ...listedThread,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Dormant final reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  monitor.threads.set(listedThread.id, listedThread);
  monitor.client = {
    readThread: async () => hydratedThread
  };

  await monitor.refreshThread(listedThread.id);
  await monitor.rebuildSnapshot();

  assert.equal(
    monitor.recentEvents.some((event) => event.method === "thread/read/agentMessage"),
    false
  );
  const snapshot = monitor.getSnapshot();
  const agent = snapshot.agents.find((entry) => entry.threadId === listedThread.id);
  assert.ok(agent);
  assert.equal(agent.detail, "Dormant final reply");
  assert.equal(agent.isCurrent, false);
});

test("initial thread hydration ignores preloaded partial assistant history", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const threeDaysAgoMs = Date.now() - (3 * 24 * 60 * 60 * 1000);
  const listedThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor(threeDaysAgoMs / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_preloaded",
            type: "agentMessage",
            text: "Preloaded commentary",
            phase: "commentary"
          }
        ]
      }
    ]
  };
  const hydratedThread = {
    ...listedThread,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_final",
            type: "agentMessage",
            text: "Dormant final reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  monitor.threads.set(listedThread.id, listedThread);
  monitor.client = {
    readThread: async () => hydratedThread
  };

  await monitor.refreshThread(listedThread.id);
  await monitor.rebuildSnapshot();

  assert.equal(
    monitor.recentEvents.some((event) => event.method === "thread/read/agentMessage"),
    false
  );
  const snapshot = monitor.getSnapshot();
  const agent = snapshot.agents.find((entry) => entry.threadId === listedThread.id);
  assert.ok(agent);
  assert.equal(agent.detail, "Dormant final reply");
  assert.equal(agent.isCurrent, false);
});

test("initial discovery waits for resumed live thread hydration before the first snapshot", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const now = Math.floor(Date.now() / 1000);
  const listedThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: now,
    turns: []
  };
  const hydratedThread = {
    ...listedThread,
    status: { type: "idle" },
    turns: [
      {
        id: "turn_live",
        status: "interrupted",
        error: null,
        items: [
          {
            id: "item_commentary",
            type: "agentMessage",
            text: "Checking the live snapshot.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  let resumeCalls = 0;
  let readCalls = 0;
  monitor.client = {
    listThreads: async () => [listedThread],
    listLoadedThreads: async () => [],
    resumeThread: async () => {
      resumeCalls += 1;
    },
    readThread: async () => {
      readCalls += 1;
      return hydratedThread;
    }
  };

  await monitor.discoverThreads();
  await monitor.rebuildSnapshot();

  const snapshot = monitor.getSnapshot();
  const agent = snapshot.agents.find((entry) => entry.threadId === listedThread.id);
  assert.ok(agent);
  assert.equal(resumeCalls, 1);
  assert.ok(readCalls >= 1);
  assert.equal(agent.liveSubscription, "subscribed");
  assert.equal(agent.state, "thinking");
  assert.equal(agent.isCurrent, true);
});

test("initial discovery still subscribes active older threads before their first new update", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false,
    localLimit: 1
  });
  const now = Math.floor(Date.now() / 1000);
  const recentIdleThread = {
    ...sampleThread(),
    id: "thr_recent",
    status: { type: "idle" },
    updatedAt: now,
    turns: []
  };
  const activeThread = {
    ...sampleThread(),
    id: "thr_active",
    status: { type: "active", activeFlags: [] },
    updatedAt: now - 3600,
    turns: []
  };
  const hydratedActiveThread = {
    ...activeThread,
    turns: [
      {
        id: "turn_live",
        status: "interrupted",
        error: null,
        items: [
          {
            id: "item_commentary",
            type: "agentMessage",
            text: "Still working before the next delta lands.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  const resumedThreadIds = [];
  monitor.client = {
    listThreads: async () => [recentIdleThread, activeThread],
    listLoadedThreads: async () => [],
    resumeThread: async (threadId) => {
      resumedThreadIds.push(threadId);
    },
    readThread: async (threadId) => {
      if (threadId === activeThread.id) {
        return hydratedActiveThread;
      }
      return recentIdleThread;
    }
  };

  await monitor.discoverThreads();
  await monitor.rebuildSnapshot();

  const snapshot = monitor.getSnapshot();
  const agent = snapshot.agents.find((entry) => entry.threadId === activeThread.id);
  assert.ok(agent);
  assert.deepEqual(resumedThreadIds, [activeThread.id]);
  assert.equal(agent.liveSubscription, "subscribed");
  assert.equal(agent.isCurrent, true);
  assert.equal(agent.detail, "Still working before the next delta lands.");
});

test("hydrated thread rereads do not synthesize assistant replies as fresh events", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const listedThread = {
    ...sampleThread(),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_preloaded",
            type: "agentMessage",
            text: "Preloaded commentary",
            phase: "commentary"
          }
        ]
      }
    ]
  };
  const hydratedThread = {
    ...listedThread,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_final",
            type: "agentMessage",
            text: "Hydrated reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };
  const updatedThread = {
    ...hydratedThread,
    updatedAt: hydratedThread.updatedAt + 5,
    turns: [
      {
        id: "turn_2",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_follow_up",
            type: "agentMessage",
            text: "Fresh follow-up reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  monitor.threads.set(listedThread.id, listedThread);
  monitor.subscribedThreadIds.add(listedThread.id);
  monitor.client = {
    readThread: async () => hydratedThread
  };

  await monitor.refreshThread(listedThread.id);
  assert.equal(
    monitor.recentEvents.some((event) => event.method === "thread/read/agentMessage"),
    false
  );

  monitor.client = {
    readThread: async () => updatedThread
  };

  await monitor.refreshThread(listedThread.id);

  const messageEvents = monitor.recentEvents.filter((event) => event.method === "thread/read/agentMessage");
  assert.equal(messageEvents.length, 0);
});

test("unsubscribed thread rereads still synthesize assistant replies as fallback events", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const listedThread = {
    ...sampleThread(),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_preloaded",
            type: "agentMessage",
            text: "Preloaded commentary",
            phase: "commentary"
          }
        ]
      }
    ]
  };
  const hydratedThread = {
    ...listedThread,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_final",
            type: "agentMessage",
            text: "Hydrated reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };
  const updatedThread = {
    ...hydratedThread,
    updatedAt: hydratedThread.updatedAt + 5,
    turns: [
      {
        id: "turn_2",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_follow_up",
            type: "agentMessage",
            text: "Fresh follow-up reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  monitor.threads.set(listedThread.id, listedThread);
  monitor.client = {
    readThread: async () => hydratedThread
  };

  await monitor.refreshThread(listedThread.id);
  assert.equal(
    monitor.recentEvents.some((event) => event.method === "thread/read/agentMessage"),
    false
  );

  monitor.client = {
    readThread: async () => updatedThread
  };

  await monitor.refreshThread(listedThread.id);

  const messageEvents = monitor.recentEvents.filter((event) => event.method === "thread/read/agentMessage");
  assert.equal(messageEvents.length, 1);
  assert.equal(messageEvents[0].detail, "Fresh follow-up reply");
});

test("explicitly stopped threads leave only after the stop grace window", async () => {
  const stoppedThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 60_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Done.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [stoppedThread],
    events: [],
    stoppedAtByThreadId: new Map([["thr_123", Date.now() - 6_000]])
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.notEqual(agent.stoppedAt, null);
  assert.equal(agent.isCurrent, false);
});

test("parseApplyPatchInput extracts file path and line deltas from apply_patch input", () => {
  const parsed = parseApplyPatchInput([
    "*** Begin Patch",
    "*** Update File: /tmp/CodexAgentsOffice/packages/core/src/snapshot.ts",
    "@@",
    "-const VALUE = 1;",
    "+const VALUE = 2;",
    "*** End Patch"
  ].join("\n"));

  assert.deepEqual(parsed, {
    path: "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts",
    action: "edited",
    title: "File edited",
    linesAdded: 1,
    linesRemoved: 1
  });
});

test("rollout apply_patch hooks become file-change events", () => {
  const event = buildRolloutHookEvent("/tmp/CodexAgentsOffice", "thr_123", {
    timestamp: "2026-03-23T19:00:00.000Z",
    payload: {
      type: "custom_tool_call",
      name: "apply_patch",
      status: "completed",
      call_id: "call_123",
      input: [
        "*** Begin Patch",
        "*** Update File: /tmp/CodexAgentsOffice/packages/core/src/snapshot.ts",
        "@@",
        "-const VALUE = 1;",
        "+const VALUE = 2;",
        "*** End Patch"
      ].join("\n")
    }
  });

  assert.ok(event);
  assert.equal(event.kind, "fileChange");
  assert.equal(event.phase, "completed");
  assert.equal(event.itemId, "call_123");
  assert.equal(event.path, "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts");
  assert.equal(event.linesAdded, 1);
  assert.equal(event.linesRemoved, 1);
});

test("rollout exec_command hooks become command events", () => {
  const pendingCommands = new Map();
  const started = buildRolloutHookEvent("/tmp/CodexAgentsOffice", "thr_123", {
    timestamp: "2026-03-23T19:00:00.000Z",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: "call_cmd_123",
      arguments: JSON.stringify({
        cmd: "git status --short README.md",
        workdir: "/tmp/CodexAgentsOffice"
      })
    }
  }, pendingCommands);

  const completed = buildRolloutHookEvent("/tmp/CodexAgentsOffice", "thr_123", {
    timestamp: "2026-03-23T19:00:01.000Z",
    payload: {
      type: "function_call_output",
      call_id: "call_cmd_123",
      output: "Command: /bin/bash -lc 'git status --short README.md'\nProcess exited with code 0\n"
    }
  }, pendingCommands);

  assert.ok(started);
  assert.equal(started.kind, "command");
  assert.equal(started.phase, "started");
  assert.equal(started.command, "git status --short README.md");
  assert.equal(started.title, "Command started");

  assert.ok(completed);
  assert.equal(completed.kind, "command");
  assert.equal(completed.phase, "completed");
  assert.equal(completed.command, "git status --short README.md");
  assert.equal(completed.title, "Command completed");
});

test("snapshot prefers recent file-change events over trailing summary messages", async () => {
  const now = Date.now();
  const thread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((now - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            id: "item_msg",
            text: "Patched the file and wrapped up.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [thread],
    events: [
      {
        id: "event_file",
        source: "codex",
        confidence: "typed",
        threadId: "thr_123",
        createdAt: new Date(now - 1_000).toISOString(),
        method: "rollout/apply_patch/completed",
        itemId: "call_123",
        kind: "fileChange",
        phase: "completed",
        title: "File edited",
        detail: "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts",
        path: "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts",
        action: "edited",
        linesAdded: 1,
        linesRemoved: 1
      }
    ]
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.activityEvent.type, "fileChange");
  assert.equal(agent.activityEvent.path, "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts");
  assert.match(agent.detail, /Edited .*snapshot\.ts$/);
});
