# Codex Agents Office

<div align="center">

### The office view for real Codex work

Turn live Codex activity into a browser office, terminal snapshot, and VS Code panel that show which workspaces are active, which parent sessions are leading, which subagents are blocked or waiting, and where that work belongs in the project.

[Quick start](#quick-start) • [What it does](#what-it-does) • [How it works](#how-it-works) • [Docs](#docs)

</div>

## Why this exists

Codex already exposes real workload signals: threads, turns, item activity, approvals, file changes, and cloud tasks.

What is still hard is reading that workload at a glance across multiple active projects.

Codex Agents Office turns those signals into a live observability surface instead of a transcript replay.

## What it does

- **Browser office view**
  Live room-based rendering with fleet view, single-project focus, hover details, and a terminal-style fallback.
- **Terminal snapshot and watch mode**
  Fast shell output grouped by room, including current state, useful detail, and resume commands when available.
- **VS Code activity-bar panel**
  The same workload model inside the editor, backed by the same room and appearance data.
- **Data-driven rooms**
  Each project maps paths to rooms through `.codex-agents/rooms.xml`.
- **Persistent appearance overrides**
  Agent looks are stored in `.codex-agents/agents.json`.
- **Current-workload-first rendering**
  The product is optimized for what is happening now, with recent history kept visible only where it helps the scene read cleanly.

## Quick start

### Requirements

- Node.js and npm
- a runnable Codex command if you want live Codex session visibility
  The normal path is Codex CLI on `PATH`. On macOS, Codex Agents Office also falls back to the bundled app binary in `/Applications/Codex.app/Contents/Resources/codex` when the CLI is absent. On Windows, the desktop app alone is not yet a reliable substitute for a runnable `codex` command.
- optional Claude local logs if you want secondary discovery
- optional `CURSOR_API_KEY` if you want Cursor background-agent visibility

### Install and build

```bash
npm install
npm run build
npm run typecheck
```

### Run the web view

```bash
npx codex-agents-office web --port 4181
```

Open [http://127.0.0.1:4181](http://127.0.0.1:4181).

This is the normal fleet-mode launch. For a focused single-project run:

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

### Run the disposable preview

```bash
npx codex-agents-office demo preview --port 4181
```

This creates a temporary demo workspace with scripted activity so you can see the office view without wiring a real project first.

### Run the VS Code panel

```bash
npm run build -w packages/vscode
```

Then open this repo in VS Code and press `F5` to launch the extension host.

## How it works

Codex Agents Office is an observability layer over real Codex work.

It prefers official surfaces first:

- `codex app-server` for local threads, turns, approvals, input waits, commands, file changes, and live notifications
- `codex cloud list --json` for cloud and web tasks
- `.codex-agents/rooms.xml` for room layout and path mapping
- `.codex-agents/agents.json` for persistent appearance overrides

If `codex` is not on `PATH`, set `CODEX_CLI_PATH` to a runnable Codex executable.
On Windows+WSL, make sure the observer and the Codex app share the same `CODEX_HOME`; otherwise WSL-side discovery can miss Windows app sessions entirely.

Claude local logs and Cursor background agents are supported as secondary sources, but the product is designed to treat Codex-native signals as the primary truth when they exist.

## Project layout

- [`packages/core`](packages/core)
  Shared discovery, room parsing, workload classification, appearance storage, and snapshot plumbing.
- [`packages/web`](packages/web)
  Browser server and renderer for office and terminal browser views.
- [`packages/cli`](packages/cli)
  CLI entrypoints for `watch`, `snapshot`, room scaffolding, preview demos, and web hosting.
- [`packages/vscode`](packages/vscode)
  VS Code activity-bar integration.
- [`docs`](docs)
  Internal architecture, spec, hook mapping, references, and project priorities.

## Docs

- [docs/spec.md](docs/spec.md)
  Product expectations, current behavior rules, and renderer contract.
- [docs/architecture.md](docs/architecture.md)
  Internal system design and package/module responsibilities.
- [docs/integration-hooks.md](docs/integration-hooks.md)
  Exact Codex, Claude, Cursor, and cloud integration surfaces.
- [docs/self-development.md](docs/self-development.md)
  Priorities and improvement backlog.
- [docs/references.md](docs/references.md)
  External references that shaped the implementation.

## Development

Useful commands:

```bash
npm install
npm run build
npm run typecheck
npx codex-agents-office web --port 4181
npx codex-agents-office watch /abs/project/path
```

For runtime operations, behavioral expectations, and debugging details, use the internal docs instead of extending this landing page.
