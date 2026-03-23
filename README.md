# Codex Agents Office

<div align="center">

### The office view for real Codex work

Turn live Codex activity into a browser office, terminal snapshot, and VS Code panel that show who is working, which parent sessions are leading, which subagents are blocked or waiting, and where that work belongs in the project.

[Quick start](#quick-start) • [What it does](#what-it-does) • [How it works](#how-it-works) • [Docs](#docs)

</div>

## Why this exists

Codex already exposes real workload signals: threads, turns, item activity, approvals, file changes, and cloud tasks.

What is still hard is reading that workload at a glance across multiple workspaces.

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
- **Codex-native state first**
  Local Codex thread state and cloud task data drive the scene before any transcript-like fallback sources.

## Product surfaces

### Browser

The browser surface is the primary product view.

It supports:

- fleet summaries across multiple projects
- deep links into one project with `?project=/abs/project/path`
- office and terminal-style rendering with `?view=map` and `?view=terminal`
- live agents plus the 4 most recent lead sessions for each workspace
- a durable cross-project `Needs You` queue for approval and input waits
- provenance/confidence detail in session cards so Codex-native and Claude-inferred entries do not read the same
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

Pin the server to one project when needed:

```bash
npx codex-agents-office web /abs/project/path --port 4181
```

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
  Local thread discovery, thread reads, status, approvals, commands, file changes, and live notifications.
- `codex cloud list --json`
  Cloud and web task visibility.
- `.codex-agents/rooms.xml`
  Per-project room structure and directory-to-room mapping.
- `.codex-agents/agents.json`
  Per-project appearance persistence.

Claude local session logs are supported as a secondary source for discovery and best-effort recent activity inference, but they are intentionally weaker than the Codex-native path.

The normalized snapshot is then rendered into:

- desks for active work
- rec-area placement for waiting, resting, and the 4 most recent lead sessions
- hover cards and session panels for longer detail
- live event-native notifications for file changes, commands, turn lifecycle, approval waits, and user-input waits
- explicit provenance/confidence labels so Codex-native state and Claude-inferred state do not look equivalent

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
- live browser refresh over SSE
- raw app-server notification ingestion through the shared snapshot event stream
- anchored notifications for file changes, commands, turn lifecycle, approvals, and user-input waits
- a durable cross-project "needs you" queue for approval and input waits
- provenance/confidence signaling for Codex, Claude, cloud, and presence-derived entries
- fleet view and single-project office view

The main gap is richer event-to-motion mapping. The project now carries more typed Codex event signal end-to-end, but it still needs stronger in-scene posture and movement differences for reading, planning, editing, validating, delegating, interrupted, and waiting work.

## Docs

- [`docs/architecture.md`](docs/architecture.md)
  System design, scene model, and rendering approach.
- [`docs/integration-hooks.md`](docs/integration-hooks.md)
  Exact Codex and Claude hooks and how they map into the product.
- [`docs/self-development.md`](docs/self-development.md)
  Project-quality bar and current iteration priorities.
- [`docs/references.md`](docs/references.md)
  External references and source material used by the project.

## Pixel art credit

Pixel office art in this project is based on the [Pixel Office asset pack by 2dPig](https://2dpig.itch.io/pixel-office).

Source asset files live under [`packages/web/public/pixel-office`](packages/web/public/pixel-office), including the original atlas PNG and `.aseprite` files used by this repo's current sprite pipeline.

Non-runtime validation screenshots and sprite-debug leftovers live under [`artifacts`](artifacts) so the repository root stays focused on source files.
