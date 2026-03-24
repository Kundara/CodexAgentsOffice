# Integration Hooks

## Purpose

This document answers two questions:

1. What signals can Codex Agents Office read from Codex, Claude, and Cursor today?
2. How does each signal get represented in this project?

The goal is practical transparency. This is not a generic event catalog. It is the list of hooks this codebase can already ride, plus the places where we are still leaving signal on the table.

## Normalized Model

Everything eventually lands in the shared `DashboardSnapshot` and `DashboardAgent` model from `packages/core/src/types.ts`.

The important normalized agent fields are:

- `source`
  `local`, `cloud`, `cursor`, `presence`, or `claude`
- `sourceKind`
  where the session came from, such as `cli`, `vscode`, `subAgent`, `claude:<model>`, or `cursor:<model>`
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
  whether the visible state comes from typed Codex data, typed Cursor API data, inferred Claude data, cloud tasks, or synthetic presence
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

- spawns `codex app-server`
- initializes a JSON-RPC-like session
- opts into `experimentalApi`
- opts out of streamed `item/agentMessage/delta` notifications so browser reply toasts can prefer full-message state
- requests `thread/list`
- requests `thread/read`
- resumes active/recent threads with `thread/resume`
- unsubscribes stale observer-owned subscriptions with `thread/unsubscribe`
- parses app-server notifications
- parses server-initiated JSON-RPC requests such as approvals and input prompts

Important note:

- raw notifications are parsed and exposed through `onNotification(...)`
- server requests are parsed and exposed through `onServerRequest(...)`
- `ProjectLiveMonitor` now consumes both streams directly
- targeted `thread/read` refreshes still happen, but they are triggered behind the event stream instead of replacing it
- the observer does not answer approval/input requests; it only visualizes them

This means app-server is now both the main truth source and the first-class local event bus for browser notifications.

### `thread/list`

Used in:

- `packages/core/src/app-server.ts`
- `packages/core/src/project-paths.ts`
- `packages/core/src/snapshot.ts`
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

### `thread/read`

Used in:

- `packages/core/src/app-server.ts`
- `packages/core/src/snapshot.ts`
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
- infer subagent parentage and depth
- generate `resumeCommand`
- map the session into project rooms using extracted paths
- keep read-only visibility for older threads outside the live subscription window
- synthesize fallback assistant-message events from reread desktop rollout threads when live `thread/resume` delivery is unavailable, so normal reply text can still toast

### `thread/resume` / `thread/unsubscribe`

Used in:

- `packages/core/src/app-server.ts`
- `packages/core/src/live-monitor.ts`

How we use it:

- active threads and threads updated in the last 10 minutes are resumed on the observer connection
- the observer keeps at most 8 project threads subscribed at once
- subscription sync now runs in the background so the web server can render before slow desktop thread attaches finish
- stale observer-owned subscriptions are unsubscribed
- subscribed threads surface as `liveSubscription = subscribed`; older threads stay `readOnly`

In fleet mode, every discovered workspace keeps a live monitor. The selected workspace only changes browser focus; it does not change which projects are subscribed.

### Thread status and active flags

Consumed in:

- `packages/core/src/snapshot.ts`

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
- in-progress turn with no better signal -> `thinking`
- recent completed answer -> `done`
- old inactive thread -> `idle`

Current-workload occupancy rules on top of that state:

- a local thread stays `isCurrent` while the live monitor still considers the thread ongoing, even if the latest turn now reads as `done`
- a `notLoaded` thread still stays `isCurrent` when `thread/read` shows its latest turn is `inProgress`
- observer-owned unload/runtime-idle transitions such as `thread/closed` or `thread/status/changed -> notLoaded` are not treated as stop signals by themselves; the monitor confirms stops from turn-terminal events plus reread thread state
- local desk occupancy no longer uses a generic freshness fallback for non-idle summaries; if a thread is not ongoing, not waiting on the user, and not inside the stop grace window, it is no longer `isCurrent`
- once the thread actually stops, it stays `isCurrent` for about 5 seconds so its final reply can still be read before it leaves the desk
- non-local `idle` sessions still drop out of current-workload filtering immediately

In the browser this becomes:

- workstation occupancy
- waiting / blocked indicators
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
| `plan` | `planning` | active worker, planning summary |
| `reasoning` | `thinking` | active worker, thinking summary |
| `enteredReviewMode` | `validating` | review-start summary and icon coverage |
| `exitedReviewMode` | `thinking` or `done` | review-finished summary and icon coverage |
| `contextCompaction` | `thinking` | compaction summary and icon coverage |
| `agentMessage` | `thinking` or `done` | message summary, live notification when subscribed, fallback notification from reread desktop threads |
| `userMessage` | `planning` or `idle` | assigned-work summary and icon coverage |

### File change semantics

Mapped in:

- `packages/core/src/snapshot.ts`
- `packages/web/src/client-script.ts`

### Web search visibility

Mapped in:

- `packages/core/src/live-monitor.ts`
- `packages/core/src/snapshot.ts`
- `packages/web/src/client-script.ts`

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
- `packages/web/src/client-script.ts`

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

### Tool call semantics

Mapped in:

- `packages/core/src/live-monitor.ts`
- `packages/core/src/snapshot.ts`
- `packages/web/src/pixel-office.ts`
- `packages/web/src/client-script.ts`

What we read from Codex:

- `item/tool/call` server requests
- `dynamicToolCall` / `mcpToolCall` items when present in thread data
- exact app-server method names for typed snapshot events

How we use it:

- normalize tool-call requests into typed `DashboardEvent.kind = tool`
- keep dynamic tool activity visible in the local thread summary path
- resolve toast icons from exact method-shaped asset paths such as `sprites/icons/item/tool/call.svg`
- resolve semantic thread-item icons from `sprites/icons/thread-item/*.svg` or reused exact-method icons
- expose a visual verification surface at `/icon-audit` so every thread-item icon can be inspected side by side

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
- `packages/core/src/snapshot.ts`

What we read:

- task id
- URL
- title
- status
- updated time
- environment label
- file/line change summary

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

- `~/.claude/projects/*/*.jsonl`

How we use it:

- scan project directories
- sample the head and tail of each log
- infer the project root from `cwd`
- merge Claude-discovered roots into workspace discovery

### Claude session sampling

What we read:

- recent JSONL records from the head and tail of each session file
- optional project-local hook sidecars in `.codex-agents/claude-hooks/<session-id>.jsonl`
- record timestamps
- message model names
- `cwd`
- `gitBranch`

How we use it:

- identify the session
- derive a display label from the Claude model
- infer the most recent meaningful activity from transcript data when no hook sidecar exists
- prefer typed Claude hook events when a sidecar exists for that session
- assign an appearance and render it as a `claude` agent

### Official Claude hook surface

Official docs:

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

How this project uses that surface:

- we do not scrape Claude internals directly from the hook stream
- instead, we support a project-owned bridge that writes hook JSONL sidecars into `.codex-agents/claude-hooks/<session-id>.jsonl`
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
| `UserPromptSubmit` | `planning` | typed user-prompt state with `userMessage` activity |
| `SessionStart` | `planning` | typed session-start state |
| `SessionEnd` | `done` | typed session-ended state |
| `PreCompact` | `thinking` | typed context-compacting state |
| `PreToolUse` / `PostToolUse` with edit or write tools | `editing` | file-change style notification and room mapping from paths |
| `PreToolUse` / `PostToolUse` with bash or shell tools | `running` or `validating` | command-style notification |
| `PostToolUseFailure` | `blocked` | failed command/tool state |
| `SubagentStart` | `delegating` | typed delegation summary |
| `SubagentStop` | `done` | typed subagent-finished summary |
| `Stop` / `TaskCompleted` | `done` | typed completion state |
| `StopFailure` | `blocked` | typed turn-failure summary |

### Claude activity events

What we synthesize:

- `userMessage`
- `fileChange`
- `commandExecution`
- `agentMessage`

How we use it:

- exactly the same browser notification path as Codex agents
- same room mapping via normalized `paths`
- same session-card and hover-card surfaces

What Claude still does not provide here:

- Codex-style resume/open command
- Codex app-server style live push stream into this process without a user-configured hook bridge
- Codex-grade parent/subagent hierarchy with stable parent thread ids in the shared snapshot

## Cursor Background Agents

Cursor support uses the official background-agent API as a typed secondary source.

Primary code path:

- `packages/core/src/cursor.ts`

### Cursor project matching

What we read:

- project git `remote.origin.url`
- Cursor background-agent `source.repository`

How we use it:

- normalize both repo URLs into a comparable HTTPS form
- match Cursor background agents onto the currently selected project
- avoid transcript scraping or private local storage parsing

### Official Cursor surface

Official docs:

- [Cursor background agents](https://docs.cursor.com/en/background-agents)
- [Cursor background-agent API overview](https://docs.cursor.com/background-agent/api/overview)

What Cursor exposes:

- `GET /v0/agents` for agent ids, status, summary, repo/ref, branch, and target URLs
- agent conversation history
- status-change webhooks
- model listing for background-agent creation

How this project uses that surface:

- reads the official Cursor API when `CURSOR_API_KEY` is configured
- matches agents by normalized repository URL
- maps agent status into shared workload state
- renders Cursor agents with `confidence = typed`
- keeps them read-only because this project is observing, not driving Cursor agent execution

### Cursor state mapping

| Cursor status | State | Representation |
| --- | --- | --- |
| `CREATING` / `RUNNING` | `running` | active typed Cursor work item |
| `FINISHED` | `done` | recently completed Cursor task |
| `ERROR` | `blocked` | typed failure state |
| `EXPIRED` | `idle` | no longer active |

What Cursor does not yet provide here:

- Codex-style local live thread subscriptions
- stable room mapping from typed file paths
- automatic workspace discovery for Cursor-only projects without an explicit local repo context

## Representation In This Project

### Shared snapshot

Built in:

- `packages/core/src/snapshot.ts`

The snapshot builder merges:

- local Codex threads
- cloud tasks
- optional synthetic presence entries
- Claude sessions from transcript inference or optional hook sidecars
- Cursor background agents matched by normalized repository URL

Then it:

- maps paths to rooms
- assigns appearances
- flags current workload with `isCurrent`
- carries recent event-native notifications in `events`

### Browser office

Rendered in:

- `packages/web/src/render-html.ts`
- `packages/web/src/client-script.ts`

How normalized fields become visuals:

| Normalized field | Browser representation |
| --- | --- |
| `roomId` | desk placement inside a room |
| `state` | desk pose, rec-room placement, waiting/blocked bubbles, session labels |
| `activityEvent` | floating text notifications and image previews |
| `events` | event-native command, file, approval, input, subagent, and turn notifications |
| `needsUser` | durable per-agent approval/input state for queueing and waiting posture |
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
- `packages/web/src/client-script.ts`

How it works:

- the browser loads the initial page shell from `render-html.ts`
- `/api/fleet` provides the current normalized snapshot
- `/api/events` streams live fleet updates over SSE
- `FleetLiveService` owns project monitors and publishes fresh fleet payloads to connected browser clients
- browser-side rendering and event reaction live in `client-script.ts`

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
