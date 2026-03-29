# Integration Hooks

## Purpose

This document answers two questions:

1. What signals can Codex Agents Office read from Codex, Claude, OpenClaw, and Cursor today?
2. How does each signal get represented in this project?

The goal is practical transparency. This is not a generic event catalog. It is the list of hooks this codebase can already ride, plus the places where we are still leaving signal on the table.

## Normalized Model

Everything eventually lands in the shared `DashboardSnapshot` and `DashboardAgent` model from `packages/core/src/types.ts`.

The important normalized agent fields are:

- `source`
  `local`, `cloud`, `cursor`, `presence`, `claude`, or `openclaw`
- `sourceKind`
  where the session came from, such as `cli`, `vscode`, `subAgent`, `claude:<model>`, `openclaw:<provider/model>`, or `cursor:<model>`
- `parentThreadId`
  parent Codex thread when the agent is a spawned subagent
- `state`
  `planning`, `scanning`, `thinking`, `editing`, `running`, `validating`, `delegating`, `waiting`, `blocked`, `done`, `idle`, or `cloud`
- `detail`
  short human-readable summary of the latest useful activity
- `paths`
  file or directory paths used for room mapping
- `activityEvent`
  optional event object used for visual notifications
- `provenance`
  whether the visible state comes from typed Codex data, typed OpenClaw gateway data, typed Cursor API data, inferred Claude data, cloud tasks, or synthetic presence
- `confidence`
  whether the visible state is typed truth or inferred best effort
- `resumeCommand`
  local Codex resume affordance when available

The shared snapshot also carries:

- `events`
  recent normalized `DashboardEvent` records built from raw Codex notifications

That normalized model is what the web view, terminal view, and VS Code panel render.

## Codex Hooks

### `codex app-server`

Primary code path:

- `packages/core/src/app-server.ts`

Current use:

- resolves a runnable Codex command, then spawns `codex app-server`
- initializes a JSON-RPC-like session
- opts into `experimentalApi`
- keeps streamed `item/agentMessage/delta` notifications enabled so Codex reply toasts can update immediately from the typed live feed
- requests `thread/list`
- requests `thread/read`
- resumes active/recent threads with `thread/resume`
- unsubscribes stale observer-owned subscriptions with `thread/unsubscribe`
- parses app-server notifications
- parses server-initiated JSON-RPC requests such as approvals and input prompts
- summarizes `turn/plan/updated` from the documented `{ explanation?, plan }` payload and `turn/diff/updated` from the documented `{ diff }` payload

Important note:

- raw notifications are parsed and exposed through `onNotification(...)`
- server requests are parsed and exposed through `onServerRequest(...)`
- `ProjectLiveMonitor` now consumes both streams directly
- targeted `thread/read` refreshes still happen, but they are triggered behind the event stream instead of replacing it
- the observer does not answer approval/input requests; it only visualizes them

This means app-server is now both the main truth source and the first-class local event bus for browser notifications.

Signals currently left on the table from the official app-server events page:

- `thread/tokenUsage/updated`
- `fuzzyFileSearch/sessionUpdated`
- `fuzzyFileSearch/sessionCompleted`
- `windowsSandbox/setupCompleted`

Current stance:

- these notifications are documented and valid, but they do not currently affect workload state, toast rendering, or browser office occupancy

Resolution details:

- prefer `CODEX_CLI_PATH` when explicitly set
- otherwise prefer `codex` on `PATH`
- on native Windows, if `codex.cmd` is unavailable but `codex` exists inside WSL, fall back to `wsl.exe --exec codex`
- on macOS, fall back to the bundled Codex app binary in `/Applications/Codex.app/Contents/Resources/codex` or `~/Applications/Codex.app/Contents/Resources/codex` when present
- on Windows and Windows+WSL, fall back to the Microsoft Store Codex app by copying its packaged `app/resources` bundle into `%LOCALAPPDATA%\\CodexAgentsOffice\\cache\\windows-store\\<version>` and spawning the cached `codex.exe`
- when both a native Windows CLI and a WSL-side Codex CLI exist, `codex` on `PATH` still wins unless `CODEX_CLI_PATH` overrides it
- when both a WSL-side Codex CLI and the Windows app exist, the WSL CLI now wins before the app fallback unless `CODEX_CLI_PATH` overrides it

### `thread/list`

Used in:

- `packages/core/src/app-server.ts`
- `packages/core/src/project-paths.ts`
- `packages/core/src/snapshot-lib/dashboard-builder.ts`
- `packages/core/src/live-monitor.ts`

What we read:

- thread ids
- thread cwd
- updated time
- source kind
- status shell

How we use it:

- discover Codex project roots from `thread.cwd`
- find threads for a specific project
- detect newly active or changed local sessions
- decide which threads need a full `thread/read`

### Codex configured project discovery

Used in:

- `packages/core/src/project-paths.ts`

What we read:

- `~/.codex/config.toml`
- configured `[projects."..."]` roots

How we use it:

- seed fleet startup with configured Codex workspace roots even when no recent thread has been spawned there yet
- keep workspace tabs aligned with the user's known Codex project list instead of only the subset already exercised in the current observer session

### `thread/read`

Used in:

- `packages/core/src/app-server.ts`
- `packages/core/src/adapters/codex-local.ts`
- `packages/core/src/live-monitor.ts`

What we read:

- full thread metadata
- full turn list
- turn status
- turn items
- thread source metadata
- git info
- nickname and role metadata

How we use it:

- build the normalized `DashboardAgent`
- infer current state from the last relevant turn item
- infer ongoing-ness from the latest turn as well as runtime thread status, because `thread/list` / `thread/read` can still report `status.type = notLoaded` for persisted threads that have a current in-progress turn payload
- debounce `thread/status/changed -> notLoaded` for about 3 seconds and confirm it with a reread before clearing ongoing local work
- infer subagent parentage and depth
- generate `resumeCommand`
- map the session into project rooms using extracted paths
- keep read-only visibility for older threads outside the live subscription window
- synthesize fallback assistant-message events from reread desktop rollout threads only when live `thread/resume` delivery is unavailable, so read-only threads can still toast without replaying healthy subscribed sessions

### `thread/resume` / `thread/unsubscribe`

Used in:

- `packages/core/src/app-server.ts`
- `packages/core/src/live-monitor.ts`

How we use it:

- active threads and threads updated in the last 10 minutes are resumed on the observer connection
- active threads are included in that tracked set even when they fall outside the normal recent-thread limit, so startup discovery does not wait for a fresh delta before subscribing them
- the observer keeps at most 8 project threads subscribed at once
- subscription sync now runs in the background so the web server can render before slow desktop thread attaches finish
- desktop-backed `thread/resume` attaches can take tens of seconds in practice, so the observer now gives subscription sync a 60-second timeout budget before degrading that thread back to `readOnly`
- stale observer-owned subscriptions are unsubscribed
- subscribed threads surface as `liveSubscription = subscribed`; older threads stay `readOnly`

In fleet mode, every discovered workspace keeps a live monitor. The selected workspace only changes browser focus; it does not change which projects are subscribed.
The web server's `/api/server-meta` route now reports that live bound project set, so fleet diagnostics reflect the current monitor scope instead of only the startup seed roots.
Fleet mode also shares one `codex cloud list --json` poller across those monitors instead of running the same cloud query once per project, and a `429` now degrades into a single human-readable rate-limit note plus temporary backoff rather than duplicated raw failure notes on every project.

### Thread status and active flags

Consumed in:

- `packages/core/src/snapshot-lib/thread-summary.ts`

Codex status hooks we currently use:

- `systemError`
- `active` with `waitingOnApproval`
- `active` with `waitingOnUserInput`
- last-turn `failed`
- last-turn `inProgress`
- last-turn `interrupted`
- last-turn `completed`

Representation today:

- `waitingOnApproval` -> `blocked`
- `waitingOnUserInput` -> `waiting`
- `systemError` or failed command/turn -> `blocked`
- `plan` or in-progress turn with no stronger item signal -> `planning`
- typed reasoning, commentary, or context-compaction activity -> `thinking`
- secondary adapters should prefer the same split when they have enough signal: generic active fallback -> `planning`, explicit reply/reasoning/compaction -> `thinking`
- recent completed answer -> `done`
- old inactive thread -> `idle`

Current-workload occupancy rules on top of that state:

- a local thread stays `isCurrent` while the live monitor still considers the thread ongoing, even if the latest turn now reads as `done`
- browser desk seating now treats local `status = active` as authoritative for occupancy, so active Codex sessions remain on desks even when the summarized state currently reads `waiting`, `blocked`, or recent `done`
- a `notLoaded` thread still stays `isCurrent` when `thread/read` shows its latest turn is `inProgress`
- observer-owned unload/runtime-idle transitions such as `thread/closed` or `thread/status/changed -> notLoaded` are not treated as immediate stop signals by themselves; `notLoaded` now waits about 3 seconds and a reread confirmation before the monitor clears ongoing local state
- local desk occupancy no longer uses a generic freshness fallback for non-idle summaries; if a thread is not ongoing, not waiting on the user, and not inside the stop grace window, it is no longer `isCurrent`
- once a top-level thread actually stops, it remains current and workstation-seated for about 5 seconds so final reply text can still surface before the lead cools into rec-area visibility
- stale local `notLoaded` threads no longer keep a workstation just because they are still recent or subscribed; desk seating now requires actual ongoing work or the explicit stop grace
- completed process-only items such as `plan`, `reasoning`, and `contextCompaction` now settle to `done` while recent and then `idle` once stale instead of leaving the thread in synthetic `planning` or `thinking`
- non-local `idle` sessions still drop out of current-workload filtering immediately

In the browser this becomes:

- workstation occupancy
- above-head state markers for needs-user waits, planning, pre-message typed thinking, and explicit blocked failures, rendered at a smaller icon size above the actor
- floating notifications for newly blocked or waiting agents
- hover and session detail text

### Turn item types we currently map

Mapped in:

- `packages/core/src/snapshot.ts`

Current item-to-state mapping:

| Codex item type | State | Representation |
| --- | --- | --- |
| `fileChange` | `editing` or `blocked` | desk worker, file-change notification, room mapping from changed paths |
| `commandExecution` | `running`, `validating`, or `blocked` | desk worker, command notification |
| `webSearch` | `scanning` | active worker, typed web-search toast when the observer receives the event |
| `imageView` | `scanning` | active worker, image-view icon coverage and viewing summary |
| `mcpToolCall` | `scanning` or `blocked` | active worker, detail text names `server.tool` |
| `dynamicToolCall` | `scanning` or `blocked` | active worker, tool-call summary |
| `collabAgentToolCall` | `delegating` | active worker, delegation summary |
| `collabToolCall` | `delegating` | active worker, subagent spawn/wait summary |
| `plan` | `planning` or `done` | planning summary while in progress, recent finished summary once the turn completes |
| `reasoning` | `thinking` or `done` | thinking summary while in progress, recent finished summary once the turn completes |
| `enteredReviewMode` | `validating` | review-start summary and icon coverage |
| `exitedReviewMode` | `thinking` or `done` | review-finished summary and icon coverage |
| `contextCompaction` | `thinking` or `done` | compaction summary while active, recent finished summary once the turn completes |
| `agentMessage` | `thinking` or `done` | message summary, live notification when subscribed, fallback notification from reread desktop threads |
| `userMessage` | `planning` or `idle` | assigned-work summary and icon coverage |

### File change semantics

Mapped in:

- `packages/core/src/snapshot.ts`
- `packages/web/src/client/runtime/render-source.ts`
- `packages/web/src/client/toast-source.ts`

### Web search visibility

Mapped in:

- `packages/core/src/live-monitor.ts`
- `packages/core/src/snapshot.ts`
- `packages/web/src/client/runtime/render-source.ts`
- `packages/web/src/client/toast-source.ts`

Current behavior:

- when Codex app-server emits a native `webSearch` item or event, it maps to `state = scanning`
- typed `webSearch` events render a dedicated browser toast instead of a generic message toast
- if the observer path only sees commentary messages and no native search item, the office cannot currently reconstruct a typed web-search toast from that Codex desktop activity alone

What we read from Codex:

- changed file paths
- change kind such as create, delete, move, rename, or edit
- line deltas when the item carries them

How we use it:

- set `activityEvent.type = fileChange`
- set `activityEvent.action = created|deleted|moved|edited`
- mark image paths so the browser can show image previews
- map changed paths into rooms
- anchor the toast to the workstation instead of the avatar
- show filename-first floating text plus optional green/red `+/-` line deltas such as `client.tsx`, `+200`, `-100`

### Command execution semantics

Mapped in:

- `packages/core/src/snapshot.ts`
- `packages/web/src/client/runtime/render-source.ts`
- `packages/web/src/client/runtime/seating-source.ts`
- `packages/web/src/client/toast-source.ts`

What we read from Codex:

- command string
- command cwd
- command status

How we use it:

- classify validation-like commands as `validating`
- classify other commands as `running`
- failed or declined commands become `blocked`
- render command notifications as a command-prompt style mini window with monospace text and a blinking cursor
- keep one command window toast per agent, append new commands to the bottom, keep only the last 3 lines, and extend the expiry when new lines arrive
- keep recently stopped agents on-desk for the stop grace window; only non-current recent leads move into the rec area after that grace period
- render floating text such as `Ran npm run build`
- collapse read-only shell inspection commands such as `sed`, `cat`, `head`, `tail`, `rg`, `grep`, `ls`, `find`, and `tree` into short summary toasts like `Read workload.ts` or `Exploring 2 files`

### Browser scene layout semantics

Mapped in:

- `packages/web/src/scene-config.ts`
- `packages/web/src/client/runtime/layout-source.ts`
- `packages/web/src/client/runtime/render-source.ts`
- `packages/web/src/client/runtime/scene-source.ts`
- `packages/web/src/client/styles.css`

What we define internally:

- scene tile size and compact tile size
- desk pod span and capacity
- boss office footprint
- boss office top inset
- wall/top-band depth
- desk-area start ratio
- cubicle-group spacing
- desk-column spacing
- rec-strip furniture row and walkway row
- rec-strip maximum depth from the top of the floor grid

How we use it:

- derive browser office layout from tile spans instead of free-floating per-renderer pixel literals
- keep desk slots stable across live updates so current workload does not repack unpredictably
- keep the left boss column compact enough for stacked offices instead of one oversized booth per lead, starting one floor tile below the floor start and running as contiguous 3-tile office slots
- place rec-strip furniture on the first grid row and keep it within the top 2 rows of floor depth
- treat text scale as a global viewer setting while keeping prefab geometry internal
- keep the browser map as a retained scene host so live data updates scene entities without replacing the map subtree

### Tool call semantics

Mapped in:

- `packages/core/src/live-monitor.ts`
- `packages/core/src/snapshot.ts`
- `packages/web/src/pixel-office.ts`
- `packages/web/src/client/runtime/render-source.ts`
- `packages/web/src/client/toast-source.ts`

What we read from Codex:

- `item/tool/call` server requests
- `dynamicToolCall` / `mcpToolCall` items when present in thread data
- exact app-server method names for typed snapshot events

How we use it:

- normalize dynamic-tool server requests into typed `DashboardEvent.kind = tool`
- keep dynamic tool activity visible in the local thread summary path
- resolve toast icons from exact method-shaped asset paths such as `sprites/icons/item/tool/call.svg`
- resolve semantic thread-item icons from `sprites/icons/thread-item/*.svg` or reused exact-method icons
- expose a visual verification surface at `/icon-audit` so every thread-item icon can be inspected side by side

Important note:

- the official Codex app-server events page currently documents `item/tool/call` as the experimental client-executed dynamic-tool request path, not as an MCP-specific event

### Subagent metadata

Mapped in:

- `packages/core/src/snapshot.ts`

What we read from Codex:

- `thread.source`
- `subAgent.thread_spawn.parent_thread_id`
- `subAgent.thread_spawn.depth`
- role hints from prompt text and user message text
- `thread.agentRole`

How we use it:

- identify spawned subagents
- link them to parent threads
- attach role-based grouping to workstations
- show parent/child linkage in the session panel

### Local thread file path watch

Implemented in:

- `packages/core/src/live-monitor.ts`

What we read:

- the `thread.path` file path returned by Codex
- local file modification times via `fs.watch` and `watchFile`

How we use it:

- trigger a debounced `thread/read` when a local thread file changes
- reduce the lag between actual Codex work and the office snapshot

This is not a primary truth source. It is a refresh trigger layered on top of app-server.

### App-server notifications

Available in code:

- `packages/core/src/app-server.ts`

What is available:

- any app-server notification method and params
- this includes the event stream described in Codex docs, such as turn, item, approval, command, and file-change notifications

How we use it today:

- `ProjectLiveMonitor` subscribes to the raw notification stream
- `ProjectLiveMonitor` also listens for server-request messages carrying approval/input waits
- notifications are filtered to the current project by known thread ids and discovered paths
- matching notifications are converted into normalized `DashboardEvent` records
- approval/input requests are also attached to the owning agent as typed `needsUser` state
- those events are attached to the next `DashboardSnapshot`
- matching threads are re-read so stable state and event detail stay aligned

Why it matters:

- the browser can react to real event boundaries instead of only snapshot diffs
- command, file, approval, input, subagent, and turn lifecycle transitions now arrive as typed events
- the durable "needs you" queue now comes from real request hooks and `serverRequest/resolved`

### `codex cloud list --json`

Implemented in:

- `packages/core/src/cloud.ts`
- `packages/core/src/codex-command.ts`
- `packages/core/src/snapshot.ts`

What we read:

- task id
- URL
- title
- status
- updated time
- environment label
- file/line change summary

Resolution details:

- `cloud list` uses the same Codex-command resolution path as `app-server`
- Windows Store app installs can provide cloud task visibility through the same extracted-binary fallback

How we use it:

- create `source = cloud` agents
- attach them to project snapshots when the cloud environment label matches the project name
- render cloud sessions in the same fleet/session model

## Claude Hooks

Claude support still stays secondary to Codex app-server, but Claude Code now has an official hook surface that is strong enough to carry more than transcript heuristics when we choose to wire it in.

Primary code path:

- `packages/core/src/claude.ts`

### Claude project discovery

What we read:

- `listSessions()` from `@anthropic-ai/claude-agent-sdk` when available
- `~/.claude/projects/*/*.jsonl`

How we use it:

- prefer official Claude session metadata when the Agent SDK is installed
- scan project directories
- fall back to sampling the head and tail of each log when the SDK path is unavailable
- infer the project root from session `cwd`
- merge Claude-discovered roots into workspace discovery

### Claude session sampling

What we read:

- `getSessionMessages()` from `@anthropic-ai/claude-agent-sdk` when available
- recent JSONL records from the head and tail of each session file as fallback
- optional project-local hook sidecars in `.codex-agents/claude-hooks/<session-id>.jsonl`
- record timestamps
- message model names
- `cwd`
- `gitBranch`

How we use it:

- identify the session
- derive a display label from the Claude model
- prefer supported Agent SDK session reads over raw transcript layout assumptions
- infer the most recent meaningful activity from transcript data when no hook sidecar exists
- prefer typed Claude hook events when a sidecar exists for that session
- assign the Claude `sessionId` to the normalized `threadId` field so browser event matching can treat Claude like other tracked sessions
- assign an appearance and render it as a `claude` agent

### Official Claude hook surface

Official docs:

- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)

What Anthropic exposes in hook input:

- `session_id`
- `transcript_path`
- `cwd`
- `hook_event_name`
- `tool_name`
- `tool_input`
- `tool_response` for successful tool completions
- error information for failed tool calls
- typed lifecycle events such as `PermissionRequest`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, `Elicitation`, and `TaskCompleted`
- supported session APIs such as `listSessions()` and `getSessionMessages()` for passive inspection
- SDK hook callbacks that receive `tool_use_id` for tool-call correlation
- `agent_id` and `agent_type` on subagent-scoped hook callbacks

How this project uses that surface:

- the loader now prefers the official Agent SDK session APIs for Claude project discovery and message backfill
- we still do not scrape Claude internals directly from a private process stream
- instead, we support a project-owned bridge that writes hook JSONL sidecars into `.codex-agents/claude-hooks/<session-id>.jsonl`
- `packages/core/src/claude-agent-sdk.ts` exports a reusable Agent SDK hook bridge that appends those sidecars with `session_id`, `hook_event_name`, `tool_use_id`, `agent_id`, and `agent_type` when available
- when those sidecars exist, Claude agents can surface typed permission, input, tool, subagent, stop, user-prompt, session-start/end, and compacting state with `confidence = typed`
- when they do not exist, Claude falls back to transcript inference with `confidence = inferred`

### Claude transcript inference rules

Mapped in:

- `packages/core/src/claude.ts`

Current Claude transcript inference rules:

| Claude signal | State | Representation |
| --- | --- | --- |
| assistant `tool_use` with `edit`, `write`, `multiedit` | `editing` | file-change style notification and room mapping from paths |
| assistant `tool_use` with `bash`, `shell` | `running` or `validating` | command-style notification |
| assistant `tool_use` with `read`, `grep`, `glob`, `search`, `ls`, `list` | `scanning` | active worker without explicit notification |
| assistant `tool_use` with `task`, `delegate`, `agent` | `delegating` | delegation summary |
| latest user text newer than latest assistant text | `planning` | planning summary |
| recent assistant text | `thinking` | message summary, optional recent update notification |
| older assistant text | `done` then `idle` | finished or idle state |

### Claude hook event rules

When a project-local Claude hook sidecar exists, the loader can map these official Claude hook events directly:

| Claude hook event | State | Representation |
| --- | --- | --- |
| `PermissionRequest` | `blocked` | typed approval-needed state from Claude hook input |
| `Elicitation` | `waiting` | typed waiting-for-input state |
| `ElicitationResult` | `planning` | typed input-submitted or declined state |
| `UserPromptSubmit` | `planning` | typed user-prompt state with `userMessage` activity |
| `Setup` | `planning` | typed initialization or maintenance state |
| `SessionStart` | `planning` | typed session-start state |
| `SessionEnd` | `done` | typed session-ended state |
| `PreCompact` | `thinking` | typed context-compacting state |
| `PostCompact` | `thinking` | typed context-compacted state |
| `PreToolUse` / `PostToolUse` with edit or write tools | `editing` | file-change style notification and room mapping from paths |
| `PreToolUse` / `PostToolUse` with bash or shell tools | `running` or `validating` | command-style notification |
| `PostToolUseFailure` | `blocked` | failed command/tool state |
| `FileChanged` | `editing` | typed file-change activity from Claude hook input |
| `Notification` | `thinking`, `waiting`, or `blocked` | typed Claude-side message or warning surface |
| `SubagentStart` | `delegating` | typed delegation summary |
| `SubagentStop` | `done` | typed subagent-finished summary |
| `Stop` / `TaskCompleted` | `done` | typed completion state |
| `StopFailure` | `blocked` | typed turn-failure summary |
| `TeammateIdle` | `waiting` | typed teammate-idle summary |
| `CwdChanged` / `WorktreeCreate` / `WorktreeRemove` / `ConfigChange` / `InstructionsLoaded` | `planning` | typed workspace or config transitions |

### Claude activity events

What we synthesize:

- `userMessage`
- `fileChange`
- `commandExecution`
- `agentMessage`

How we use it:

- merge Claude session activity into normalized `DashboardEvent` records on `snapshot.events`
- use the Claude `sessionId` as the event and agent `threadId` match key
- exactly the same browser notification path as Codex agents
- same room mapping via normalized `paths`
- same session-card and hover-card surfaces

What Claude still does not provide here:

- Codex-style resume/open command
- Codex app-server style live push stream into this process without a user-configured hook bridge
- Codex-grade parent/subagent hierarchy with stable parent thread ids in the shared snapshot

## OpenClaw Gateway Sessions

OpenClaw support uses the official Gateway control plane as a typed secondary source.

Primary code path:

- `packages/core/src/openclaw.ts`

### OpenClaw workspace matching

What we read:

- `config.get`
- `agents.list`
- `sessions.list`

How we use it:

- read configured agent workspace roots from `config.get`
- read agent identities from `agents.list`
- read typed session rows, parent links, timestamps, and previews from `sessions.list`
- match OpenClaw workspaces onto the current office project by normalized workspace-path equality
- map OpenClaw parent/child session structure into `parentThreadId` and depth instead of flattening it into project tasks

### Official OpenClaw surface

Official docs:

- [OpenClaw repository](https://github.com/openclaw/openclaw)
- [OpenClaw ACP bridge](https://github.com/openclaw/openclaw/blob/main/docs.acp.md)

What OpenClaw exposes:

- Gateway WebSocket `connect`
- `config.get` for typed config snapshots
- `agents.list` for agent identities
- `sessions.list` for typed session rows with `parentSessionKey`, `childSessions`, timestamps, labels, status, and previews

How this project uses that surface:

- enables OpenClaw visibility only when `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, or `OPENCLAW_GATEWAY_PASSWORD` is configured
- connects to the official Gateway WebSocket and performs the same nonce-based `connect.challenge` handshake model OpenClaw documents
- keeps the integration read-only
- renders OpenClaw sessions with `confidence = typed`
- discovers OpenClaw-backed workspace floors only from active recent sessions, not from guessed local transcript files

### OpenClaw state mapping

| OpenClaw signal | State | Representation |
| --- | --- | --- |
| `status = running` with active child sessions | `delegating` | typed lead session supervising other OpenClaw sessions |
| `status = running` without active child sessions | `thinking` | active typed OpenClaw session |
| `status = done` | `done` | recently completed OpenClaw session |
| `status = failed` / `killed` / `timeout` | `blocked` | typed terminal failure or interrupted session |
| no usable status | `idle` | inactive OpenClaw session |

## Cursor

Cursor support now combines a typed local hook-sidecar adapter and the official cloud-agent API.

Primary code path:

- `packages/core/src/cursor.ts`

### Cursor local hook adapter

What we read:

- project-owned Cursor hooks from `<project-root>/.cursor/hooks.json`
- typed hook sidecars in `.codex-agents/cursor-hooks/<conversation-id>.jsonl`

How we use it:

- treat typed Cursor local hook sidecars as the only local Cursor source
- decode hook stdin defensively for Windows shell encodings as well as UTF-8 so project hooks keep writing sidecars in mixed Windows/WSL setups
- map official Cursor hook events such as `beforeSubmitPrompt`, `preToolUse`, `postToolUseFailure`, `afterFileEdit`, `afterAgentResponse`, `afterAgentThought`, `sessionStart`, `sessionEnd`, `stop`, `subagentStart`, `subagentStop`, and `preCompact`
- surface typed local Cursor prompt, file-change, command, MCP, reasoning, and assistant-response events in the shared office model
- age stale hook-backed live states into `done` and then `idle` instead of leaving a workstation occupied forever
- map generic active Cursor hook/transcript fallback to `planning` when no stronger reply/reasoning/tool state is present, reserving `thinking` for explicit response/reasoning/compaction signals
- render hook-backed sessions with `confidence = typed`

### Cursor cloud project matching

What we read:

- project git `remote.origin.url`
- Cursor cloud-agent `source.repository`
- Cursor cloud-agent `source.prUrl` and `target.prUrl` when work is attached to an existing PR

How we use it:

- normalize both repo URLs into a comparable HTTPS form
- collapse GitHub/GitLab/Bitbucket PR URLs back to their repository URL before comparison
- match Cursor background agents onto the currently selected project

### Official Cursor cloud surface

Official docs:

- [Cursor hooks](https://cursor.com/docs/hooks)
- [Cursor background agents](https://cursor.com/docs/cloud-agent)
- [Cursor cloud-agent API](https://cursor.com/docs/cloud-agent/api/endpoints)

What Cursor exposes:

- project and user hook configuration in `hooks.json`
- typed local hook events for session lifecycle, prompts, tool use, shell/MCP execution, file edits, thoughts/responses, compaction, and subagent lifecycle
- `GET /v0/agents` for agent ids, status, summary, repo/ref, branch, and target URLs
- `GET /v0/agents/{id}/conversation` for typed `user_message` / `assistant_message` history
- agent conversation history
- status-change webhooks
- model listing for background-agent creation

How this project uses that surface:

- reads the official Cursor API when `CURSOR_API_KEY` is configured or a Cursor API key has been saved through the web Settings popup
- follows `GET /v0/agents` pagination through `cursor` / `nextCursor`
- polls `GET /v0/agents/{id}/conversation` for active or recently updated agents and maps newly seen messages into typed office message events
- keeps `user_message` and local prompt history separate from assistant/output speech so only replies surface as visible message toasts
- authenticates against the current API surface and falls back to the older bearer form for compatibility
- matches agents by normalized repository URL, including PR-backed repository URLs
- maps agent status into shared workload state
- renders Cursor agents with `confidence = typed`
- keeps them read-only because this project is observing, not driving Cursor agent execution
- currently treats webhooks as a future terminal-state accelerator because the documented webhook surface only emits `statusChange` for `ERROR` and `FINISHED`, not live message deltas

### Cursor state mapping

| Cursor status | State | Representation |
| --- | --- | --- |
| `CREATING` / `RUNNING` | `running` | active typed Cursor work item |
| `FINISHED` | `done` | recently completed Cursor task |
| `ERROR` | `blocked` | typed failure state |
| `EXPIRED` | `idle` | no longer active |

What Cursor still does not provide here:

- Codex-style local live thread subscriptions
- durable typed approvals or input-wait state for local IDE sessions
- an official local push feed equivalent to the Codex app-server

## Representation In This Project

### Shared snapshot

Built in:

- `packages/core/src/snapshot.ts`

The snapshot builder merges:

- local Codex threads
- cloud tasks
- optional synthetic presence entries
- Claude sessions from transcript inference or optional hook sidecars
- OpenClaw gateway sessions matched by configured workspace root
- Cursor background agents matched by normalized repository URL

Then it:

- maps paths to rooms
- assigns appearances
- flags current workload with `isCurrent`
- carries recent event-native notifications in `events`

### Browser office

Rendered in:

- `packages/web/src/render-html.ts`
- `packages/web/src/client/index.ts`
- `packages/web/src/client/app-runtime.ts`
- `packages/web/src/client/runtime/*.ts`

How normalized fields become visuals:

| Normalized field | Browser representation |
| --- | --- |
| `roomId` | desk placement inside a room |
| `state` | desk pose, state-marker icon, rec-room placement, and session labels |
| `activityEvent` | floating text notifications and image previews |
| `events` | event-native command, file, approval, input, subagent, and turn notifications |
| `needsUser` | durable per-agent approval/input state for queueing and raised-hand desk markers |
| `isCurrent` | default current-workload filtering |
| `parentThreadId` and `role` | grouping into lead clusters and role pods |
| `detail` | hover summary and session-card text |
| `resumeCommand` and `url` | session actions when available |
| `provenance` and `confidence` | hover/session indication of typed Codex truth vs inferred Claude activity |

- block count from `blocked`
- top active work modes from the current normalized state mix such as `edit`, `run`, `verify`, `plan`, or `scan`
- cross-project "needs you" queue for approval and input waits

### Browser live updates

Transport:

- `packages/web/src/fleet-live-service.ts`
- `packages/web/src/router.ts`
- `packages/web/src/client/index.ts`
- `packages/web/src/client/app-runtime.ts`
- `packages/web/src/client/runtime/ui-source.ts`
- `packages/web/src/client/multiplayer-source.ts`

How it works:

- the browser loads the initial page shell from `render-html.ts`
- `/api/fleet` provides the current normalized snapshot
- `/api/multiplayer` exposes the current multiplayer transport status; it is currently a disabled placeholder until a secured sync path exists
- `/api/events` streams live fleet updates over SSE
- `FleetLiveService` owns project monitors and publishes fresh fleet payloads to connected browser clients
- browser-side rendering starts from `client/index.ts`, executes the generated `app-runtime.ts` module, and then delegates behavior across the focused runtime section files
- optional PartyKit room sync, shared-room settings persistence, per-project share preferences, and remote-only floor cooldown handling live in `multiplayer-source.ts`

- server-sent events from `/api/events`

Important detail:

- the browser still receives refreshed fleet snapshots
- those snapshots now include normalized `events` derived from raw Codex notifications
- notification text is generated from both event-native `snapshot.events` and snapshot-diff compatibility paths

That means the browser is no longer snapshot-diff-only. It can react to real app-server event boundaries while still keeping snapshot diffs as a compatibility layer.

### Terminal and VS Code

Used in:

- `packages/cli/src/index.ts`
- `packages/vscode/src/extension.ts`

Both surfaces ride the same snapshot model. They do not have their own ingestion path.

That keeps:

- state naming consistent
- room mapping consistent
- Claude/Codex coexistence consistent

## Hooks We Are Not Fully Riding Yet

These are already available or nearly available, but not fully exploited:

### Raw Codex app-server notifications

Status:

- consumed in `ProjectLiveMonitor`
- normalized into `DashboardEvent`
- shipped to the browser inside the shared snapshot

Why it matters:

- better animation timing
- true start/finish/interrupt transitions
- less dependence on poll and re-read cadence

What is still missing:

- richer in-scene motion beyond notification text
- more explicit visual differences between started, completed, interrupted, and failed turns

### Full turn lifecycle

Status:

- represented in two layers today:
  - inferred from thread reads for stable current state
  - emitted from raw `turn/*` notifications for lifecycle transitions

Current representation:

- explicit turn started notification
- explicit turn completed notification
- explicit interrupted notification
- explicit failed notification

Missing representation:

- stronger state-specific motion inside the room, beyond the current notification path

### Approval and input request events

Status:

- represented from active flags and from raw notification events
- surfaced in a durable browser-side "needs you" queue across projects

Current representation:

- stronger event-driven alerts
- durable cross-project queue of agents waiting on the user
- anchored blocked/waiting notification text on the responsible agent
- raised-hand desk markers for approval/input waits, light markers for typed thinking before the first visible assistant message, exclamation markers for explicit failure blocks, and clipboard markers for planning

Missing representation:

- direct action affordances back into the originating Codex surface
- richer blocked-vs-waiting posture/motion in-scene

### Claude confidence signaling

Status:

- Claude is merged into the same snapshot model
- Claude agents carry `provenance = claude` and `confidence = inferred`
- Codex, cloud, and presence entries carry typed provenance

Current representation:

- visual distinction between typed Codex truth and inferred Claude activity in hover and session detail
- explicit confidence and provenance surfaces in the shared model

Missing representation:

- stronger in-scene styling differences between Codex-native and Claude-inferred agents

## Practical Summary

Today the project already rides:

- Codex thread discovery
- Codex full thread reads
- Codex status flags
- Codex turn-item summaries
- Codex raw app-server notifications
- Codex turn lifecycle events
- Codex approval and input request events
- Codex cloud task listing
- Codex thread file watches for fast refresh
- Claude local JSONL discovery
- Claude tool-use and message inference
- Claude provenance/confidence signaling

Today the project does not yet fully ride:

- richer turn lifecycle motion
- typed Claude waiting/blocking equivalents
- direct approval/input action affordances

That is the current observability contract of Codex Agents Office.
