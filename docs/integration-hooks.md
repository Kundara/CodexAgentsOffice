# Integration Hooks

## Purpose

This document answers two questions:

1. What signals can Codex Agents Office read from Codex and Claude today?
2. How does each signal get represented in this project?

The goal is practical transparency. This is not a generic event catalog. It is the list of hooks this codebase can already ride, plus the places where we are still leaving signal on the table.

## Normalized Model

Everything eventually lands in the shared `DashboardSnapshot` and `DashboardAgent` model from `packages/core/src/types.ts`.

The important normalized agent fields are:

- `source`
  `local`, `cloud`, `presence`, or `claude`
- `sourceKind`
  where the session came from, such as `cli`, `vscode`, `subAgent`, or `claude:<model>`
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
- `resumeCommand`
  local Codex resume affordance when available

That normalized model is what the web view, terminal view, and VS Code panel render.

## Codex Hooks

### `codex app-server`

Primary code path:

- `packages/core/src/app-server.ts`

Current use:

- spawns `codex app-server`
- initializes a JSON-RPC-like session
- requests `thread/list`
- requests `thread/read`
- parses app-server notifications

Important note:

- raw notifications are parsed and exposed through `onNotification(...)`
- the current product does not yet consume those raw notifications directly
- instead, it re-reads thread state and projects that into snapshots

This means app-server is already the main truth source, but not yet the full event bus for motion and animation.

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
- infer subagent parentage and depth
- generate `resumeCommand`
- map the session into project rooms using extracted paths

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
| `webSearch` | `scanning` | active worker, no explicit notification |
| `mcpToolCall` | `scanning` or `blocked` | active worker, detail text names `server.tool` |
| `collabAgentToolCall` | `delegating` | active worker, delegation summary |
| `collabToolCall` | `delegating` | active worker, subagent spawn/wait summary |
| `plan` | `planning` | active worker, planning summary |
| `reasoning` | `thinking` | active worker, thinking summary |
| `agentMessage` | `thinking` or `done` | message summary, optional notification |
| `userMessage` | `planning` or `idle` | assigned-work summary |

### File change semantics

Mapped in:

- `packages/core/src/snapshot.ts`
- `packages/web/src/server.ts`

What we read from Codex:

- changed file paths
- change kind such as create, delete, move, rename, or edit

How we use it:

- set `activityEvent.type = fileChange`
- set `activityEvent.action = created|deleted|moved|edited`
- mark image paths so the browser can show image previews
- map changed paths into rooms
- show floating text such as `Edited client.tsx` or `Created rooms.xml`

### Command execution semantics

Mapped in:

- `packages/core/src/snapshot.ts`
- `packages/web/src/server.ts`

What we read from Codex:

- command string
- command cwd
- command status

How we use it:

- classify validation-like commands as `validating`
- classify other commands as `running`
- failed or declined commands become `blocked`
- render floating text such as `Ran npm run build`

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

- currently not wired into `ProjectLiveMonitor`
- the product still depends on periodic discovery and re-read

Why it matters:

- this is the cleanest next hook for more precise animation timing
- it would let the browser react to actual event boundaries instead of only to snapshot diffs

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

Claude support is intentionally second priority and inference-based.

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
- record timestamps
- message model names
- `cwd`
- `gitBranch`

How we use it:

- identify the session
- derive a display label from the Claude model
- infer the most recent meaningful activity
- assign an appearance and render it as a `claude` agent

### Claude record types we currently map

Mapped in:

- `packages/core/src/claude.ts`

Current Claude inference rules:

| Claude signal | State | Representation |
| --- | --- | --- |
| assistant `tool_use` with `edit`, `write`, `multiedit` | `editing` | file-change style notification and room mapping from paths |
| assistant `tool_use` with `bash`, `shell` | `running` or `validating` | command-style notification |
| assistant `tool_use` with `read`, `grep`, `glob`, `search`, `ls`, `list` | `scanning` | active worker without explicit notification |
| assistant `tool_use` with `task`, `delegate`, `agent` | `delegating` | delegation summary |
| latest user text newer than latest assistant text | `planning` | planning summary |
| recent assistant text | `thinking` | message summary, optional recent update notification |
| older assistant text | `done` then `idle` | finished or idle state |

### Claude activity events

What we synthesize:

- `fileChange`
- `commandExecution`
- `agentMessage`

How we use it:

- exactly the same browser notification path as Codex agents
- same room mapping via normalized `paths`
- same session-card and hover-card surfaces

What Claude does not currently provide here:

- typed waiting-on-approval state
- typed waiting-on-user-input state
- official parent/subagent hierarchy
- official resume/open command
- raw push notifications

## Representation In This Project

### Shared snapshot

Built in:

- `packages/core/src/snapshot.ts`

The snapshot builder merges:

- local Codex threads
- cloud tasks
- optional synthetic presence entries
- Claude inferred sessions

Then it:

- maps paths to rooms
- assigns appearances
- flags current workload with `isCurrent`

### Browser office

Rendered in:

- `packages/web/src/server.ts`

How normalized fields become visuals:

| Normalized field | Browser representation |
| --- | --- |
| `roomId` | desk placement inside a room |
| `state` | desk pose, rec-room placement, waiting/blocked bubbles, session labels |
| `activityEvent` | floating text notifications and image previews |
| `isCurrent` | default current-workload filtering |
| `parentThreadId` and `role` | grouping into lead clusters and role pods |
| `detail` | hover summary and session-card text |
| `resumeCommand` and `url` | session actions when available |

- block count from `blocked`
- top active work modes from the current normalized state mix such as `edit`, `run`, `verify`, `plan`, or `scan`

### Browser live updates

Transport:

- server-sent events from `/api/events`

Important detail:

- the browser does not receive raw Codex notifications
- it receives refreshed fleet snapshots
- notification toasts are generated by diffing the previous and next snapshots

That means browser notifications are currently snapshot-derived, not event-native.

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

- available in `CodexAppServerClient`
- not yet consumed by `ProjectLiveMonitor`

Why it matters:

- better animation timing
- true start/finish/interrupt transitions
- less dependence on poll and re-read cadence

### Full turn lifecycle

Status:

- inferred from thread reads today

Missing representation:

- explicit turn started
- explicit turn completed
- explicit interrupted
- explicit failed transition notification

### Approval and input request events

Status:

- represented from active flags today

Missing representation:

- stronger event-driven alerts
- durable cross-project queue of agents waiting on the user

### Claude confidence signaling

Status:

- Claude is merged into the same snapshot model

Missing representation:

- visual distinction between typed Codex truth and inferred Claude activity
- explicit confidence or provenance surfaces in hover/session detail

## Practical Summary

Today the project already rides:

- Codex thread discovery
- Codex full thread reads
- Codex status flags
- Codex turn-item summaries
- Codex cloud task listing
- Codex thread file watches for fast refresh
- Claude local JSONL discovery
- Claude tool-use and message inference

Today the project does not yet fully ride:

- raw Codex app-server notifications as first-class UI events
- richer turn lifecycle motion
- typed Claude waiting/blocking equivalents

That is the current observability contract of Codex Agents Office.
