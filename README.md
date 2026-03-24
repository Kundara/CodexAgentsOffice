# Codex Agents Office

<div align="center">

### The office view for real Codex, Claude, and Cursor work

Turn live Codex activity into a browser office, terminal snapshot, and VS Code panel that show who is working, which parent sessions are leading, which subagents are blocked or waiting, and where that work belongs in the project.

[Quick start](#quick-start) • [What it does](#what-it-does) • [How it works](#how-it-works) • [Docs](#docs)

</div>

## Why this exists

Codex already exposes real workload signals: threads, turns, item activity, approvals, file changes, and cloud tasks.

What is still hard is reading that workload at a glance across multiple active projects.

Codex Agents Office turns those signals into a current-state office view instead of a transcript replay. The goal is operational visibility:

- which workspaces are active now
- which parent sessions are leading work
- which subagents are active, waiting, blocked, or done
- which room or project area that work maps to

## What it does

- **Browser office view**
  Live room-based office rendering with fleet view, single-project deep links, hover details, and a terminal-style fallback.
- **Terminal snapshot and watch mode**
  Fast shell output grouped by room, including current state, useful detail, and resume commands when available.
- **VS Code activity-bar panel**
  The same workload model inside the editor, backed by the same room and appearance data.
- **Data-driven rooms**
  Each project defines its own layout in `.codex-agents/rooms.xml` instead of using a fixed demo map.
- **Persistent appearance overrides**
  Agent looks are stored in `.codex-agents/agents.json`.
- **Current-workload-first rendering**
  The product is optimized for what is happening now, while still keeping the 4 most recent lead sessions visible in the rec area.
  Observer-owned unload transitions such as `thread/closed` or `thread/status/changed -> notLoaded` do not count as thread completion by themselves.
  Desk occupancy now follows real ongoing / waiting / blocked / grace-window thread state instead of a generic "fresh non-idle summary" fallback.
- **Codex-native state first**
  Local Codex thread state and cloud task data drive the scene before any transcript-like fallback sources.

## Product surfaces

### Browser

The browser surface is the primary product view.

It supports:

- fleet summaries across multiple projects
- a continuous fleet tower where each workspace renders as a full-width floor instead of a separate card
- deep links into one project with `?project=/abs/project/path`
- office and terminal-style rendering with `?view=map` and `?view=terminal`
- live agents plus the 4 most recent lead sessions for each workspace
- a durable cross-project `Needs You` queue built from typed Codex approval and input requests
- provenance/confidence detail in session cards so Codex-native, Claude transcript, Claude hook-backed, and Cursor API-backed entries do not read the same
- static screenshot rendering through `?screenshot=1`

### Terminal

The terminal surface is the quickest way to inspect current workload without opening a browser.

It groups sessions by room and shows:

- state
- recent useful action
- active paths
- provenance/confidence in the shared snapshot model
- resume commands for local Codex threads when available

### VS Code

The VS Code extension adds a `Codex Office` activity-bar entry with an `Agents Office` view for the current workspace.
It rides the same normalized snapshot, including event-native notifications, approval/input state, and provenance metadata.

## Quick start

### Requirements

- Node.js and npm
- local Codex CLI access if you want live Codex session visibility
- optional Claude local logs if you want best-effort secondary discovery
- optional `CURSOR_API_KEY` if you want Cursor background-agent visibility for the currently opened repo
- optional Aseprite CLI if you want to inspect source art files

### Install and build

```bash
npm install
npm run build
npm run typecheck
```

### Run the disposable preview harness

```bash
npx codex-agents-office demo preview --port 4181
```

This creates a disposable fake app in your temp directory, writes demo `.codex/agents`, demo `.codex/skills`, `.codex-agents/rooms.xml`, and a scripted `presence.json` timeline, then hosts that workspace in the office view.

By default the preview auto-stops after 75 seconds and removes the fake app. Use `--duration 0` to keep it running until interrupted, or `--keep` to preserve the generated workspace for inspection.

### Run the web view

```bash
npx codex-agents-office web --port 4181
```

Open [http://127.0.0.1:4181](http://127.0.0.1:4181).
This is the default fleet-mode launch and should be the normal deploy path.

Pin the server to one project when needed:

```bash
npx codex-agents-office web /abs/project/path --port 4181
```

When debugging a stale browser, check [http://127.0.0.1:4181/api/server-meta](http://127.0.0.1:4181/api/server-meta) and confirm `explicitProjects` is `false` for normal fleet deploys.

### Run the terminal view

Print one snapshot:

```bash
npx codex-agents-office snapshot /abs/project/path
```

Watch live updates:

```bash
npx codex-agents-office watch /abs/project/path
```

### Run the VS Code panel

Build the extension host code:

```bash
npm run build -w packages/vscode
```

Then open this repo in VS Code and press `F5` to launch the extension in an Extension Development Host.

## How it works

Codex Agents Office is an observability layer over real Codex work.

It prefers official Codex surfaces first:

- `codex app-server`
  Local thread discovery, hybrid live subscriptions for active/recent threads, thread reads for stable state, typed approvals/input requests, commands, file changes, live notifications, and fallback reply toasts synthesized from reread desktop rollout threads.
  Ongoing desk occupancy now follows `thread/read` turn state as well as loaded runtime status, so `notLoaded` threads with an in-progress turn still stay visible as live work.
  The observer opts out of streamed `item/agentMessage/delta` notifications and prefers full reply items or reread thread messages for browser toasts.
- `codex cloud list --json`
  Cloud and web task visibility.
- `.codex-agents/rooms.xml`
  Per-project room structure and directory-to-room mapping.
- `.codex-agents/agents.json`
  Per-project appearance persistence.

Claude local session logs are supported as a secondary source for discovery and best-effort recent activity inference. When a project writes Claude hook sidecars into `.codex-agents/claude-hooks/<session-id>.jsonl`, Claude sessions can also surface typed permission, tool, subagent, and stop state without pretending to be Codex app-server.

Cursor background agents are supported as an additional official source when `CURSOR_API_KEY` is set. The current adapter matches Cursor agents to the selected project by normalized git `remote.origin.url`, then surfaces typed remote status, summary, branch, and target URL data from Cursor's background-agent API.

### Source capability matrix

The UI renders all three sources in the same office, but they do not expose the same event fidelity:

| Capability | Codex | Claude | Cursor |
| --- | --- | --- | --- |
| Workspace discovery | Yes, official local discovery | Yes, from `~/.claude/projects` | No, matched onto an already-known local repo |
| Current activity summary | Yes, typed thread + turn state | Yes, inferred from transcript or typed from hook sidecars | Yes, typed background-agent status + summary |
| Message/reply visibility | Yes, typed agent messages and turn lifecycle | Partial, transcript/head-tail sampling or hook-backed prompt/session events | Partial, summary/conversation API rather than a live local reply stream |
| File-change events | Yes, typed file-change events and paths | Partial, inferred from tool use or typed from hook sidecars | No typed file-path event stream |
| Command/tool events | Yes, typed command execution events | Partial, inferred from transcript or typed from hook sidecars | No command/tool event stream |
| Web-search visibility | Partial, only when Codex exposes a native `webSearch` item on the observer path | No dedicated typed web-search surface | No |
| Approval / input waits | Yes, typed request events | Partial, only when Claude hook sidecars exist | No |
| Subagent / delegation visibility | Yes, typed hierarchy and lifecycle | Partial, hook-backed start/stop exists but hierarchy is weaker | No |
| Resume / open affordance | Yes, local resume command and thread URL when available | No native resume/open affordance in this project | Partial, target URL / PR URL when Cursor exposes them |
| Live push into this observer | Yes, app-server notifications | No direct push here; polled transcript and optional hook sidecars | No direct local push here; API polling today |

Codex web-search toasts only appear when the Codex observer actually receives a native `webSearch` item or event. Desktop-side search helpers that do not surface through app-server or the rollout observer path are not yet visible as typed web-search toasts here.

The normalized snapshot is then rendered into:

- desks for active work
  local Codex threads stay on their desk while the thread is still ongoing, even if the latest turn already looks done or there is a lull in fresh commentary or tool output
  once a local thread actually stops, it lingers for about 5 seconds so the final message can still be seen before the avatar leaves
  only inactive recent lead sessions cool down into the rec area after that grace window; finished subagents despawn instead of taking lounge slots
- fixed workstation slots
  desk columns are pinned instead of repacked when new agents appear, with role-biased cubicles and tighter back-to-back workstation rows
- boss offices on demand
  lead sessions with multiple subagents move into a slimmer left-side lead lane with its own floor treatment and horizontal separators, instead of a large boxed office
- rec-area placement for waiting, resting, and the 4 most recent lead sessions
- hover cards and session panels for longer detail
- boss hover relationship lines
  hovering a boss highlights arrow lines from that office to the related spawned subagents on the floor
- live event-native notifications for file changes, commands, turn lifecycle, approval waits, and user-input waits
  subagents now split in near their lead on arrival with a short retro blink, while departures still head back through the main doorway
  File changes now rise from the workstation, showing the filename and any available `+/-` line deltas.
  Command notifications render as a tiny terminal-style window with monospace command text and a blinking cursor.
  Each agent keeps one command window toast at a time; new commands append to the bottom, keep only the last 3 lines, and extend the toast lifetime.
  read-like shell actions such as `sed`, `cat`, `rg`, `ls`, `find`, and `tree` now collapse into short summary toasts like `Read workload.ts` or `Exploring 2 files` instead of echoing the raw shell command.
- explicit provenance/confidence labels so Codex-native state, Claude transcript or hook-derived state, and Cursor API-backed state do not look equivalent

Fleet mode now keeps every discovered workspace live instead of rebuilding monitor state around the currently opened tab.
The browser fleet map now renders those workspaces as stacked tower floors over a shared sky backdrop with parallax pixel clouds, while single-project focus stays available through selection or `?project=...`.

## Project layout

- [`packages/core`](packages/core)
  Shared discovery, room parsing, workload classification, appearance storage, and snapshot plumbing.
- [`packages/web`](packages/web)
  Browser server and renderer for office and terminal browser views.
- [`packages/cli`](packages/cli)
  CLI entrypoints for `watch`, `snapshot`, room scaffolding, Aseprite inspection, and web hosting.
- [`packages/vscode`](packages/vscode)
  VS Code activity-bar integration.
- [`artifacts`](artifacts)
  Visual validation captures, sprite-debug working files, and troubleshooting snapshots kept out of the repo root.
- [`docs`](docs)
  Architecture, hooks, references, and project priorities.

## Current status

The current implementation already supports:

- room placement from active paths
- parent and subagent visibility
- active, waiting, blocked, done, and idle state derivation
- small typed file-change notifications for local Codex edits
- real Codex exec edits produce typed file-change events
- live browser refresh over SSE
- raw app-server notification ingestion through the shared snapshot event stream
- hybrid app-server observation:
  active/recent threads are resumed for live `turn/*`, `item/*`, and request events, while older threads stay read-only
- server-request visualization for approval and input waits without acting on those requests
- anchored notifications for file changes, commands, turn lifecycle, approvals, and user-input waits
  File-change toasts anchor to the desk instead of the avatar and prefer filename-first rendering.
- exact-method toast icons under `packages/web/public/pixel-office/sprites/icons/<app-server method>.svg`
- semantic thread-item icons covering the current official app-server item list, plus a visual audit page at `/icon-audit`
- short summary toasts for read-only shell actions instead of raw command text
- single command-window toasts per agent that aggregate the last 3 command lines and extend their visible lifetime
- ongoing local Codex threads stay desk-present until the thread actually stops, and stopped threads get a short 5-second leave delay
- a durable cross-project "needs you" queue built from typed request hooks rather than inferred detail strings
- provenance/confidence signaling for Codex, Claude transcript inference, Claude hook-backed state, cloud, and presence-derived entries
- fleet view and single-project office view
- selected-workspace focus mode in the browser via `[] Expand`, `Close`, `F` to toggle, and `Escape` to exit

The web layer is now split into smaller modules instead of one large server file:

- [`packages/web/src/server.ts`](packages/web/src/server.ts)
  Startup and shutdown only.
- [`packages/web/src/router.ts`](packages/web/src/router.ts)
  HTTP route handling for HTML, SSE, fleet/meta APIs, refresh, appearance cycling, and room scaffolding.
- [`packages/web/src/fleet-live-service.ts`](packages/web/src/fleet-live-service.ts)
  Project monitor lifecycle, fleet publication, and SSE fan-out.
- [`packages/web/src/render-html.ts`](packages/web/src/render-html.ts)
  HTML shell composition.
- [`packages/web/src/client-script.ts`](packages/web/src/client-script.ts)
  Browser-side office and terminal rendering logic.
- [`packages/web/src/client-styles.ts`](packages/web/src/client-styles.ts)
  Browser styles for the office surface.
- [`packages/web/src/http-helpers.ts`](packages/web/src/http-helpers.ts)
  Shared asset, project-file, JSON, and response helpers.

The main gap is richer event-to-motion mapping. The project now carries more typed Codex event signal end-to-end, but it still needs stronger in-scene posture and movement differences for reading, planning, editing, validating, delegating, interrupted, and waiting work.

## Docs

- [`docs/architecture.md`](docs/architecture.md)
  System design, scene model, and rendering approach.
- [`docs/integration-hooks.md`](docs/integration-hooks.md)
  Exact Codex, Claude, and Cursor integration surfaces and how they map into the product.
- [`docs/self-development.md`](docs/self-development.md)
  Project-quality bar and current iteration priorities.
- [`docs/references.md`](docs/references.md)
  External references and source material used by the project.

## Pixel art credit

Pixel office art in this project is based on the [Pixel Office asset pack by 2dPig](https://2dpig.itch.io/pixel-office).

Source asset files live under [`packages/web/public/pixel-office`](packages/web/public/pixel-office), including the original atlas PNG and `.aseprite` files used by this repo's current sprite pipeline.

Non-runtime validation screenshots and sprite-debug leftovers live under [`artifacts`](artifacts) so the repository root stays focused on source files.
