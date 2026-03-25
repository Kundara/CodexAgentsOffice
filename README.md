# Agents Office Tower

<div align="center">

### Live workload visibility for coding agents

Browser office view, terminal snapshot, and VS Code panel for current Codex, Claude, Cursor, and OpenClaw work.

[Quick start](#quick-start) • [Support matrix](#support-matrix) • [How it works](#how-it-works) • [Docs](#docs)

</div>

## What it is

- Workspace-level observability for active agent work.
- Focused on current workload, not transcript replay.

## What you get

- Browser office view with fleet mode and single-project focus.
- Opt-in LAN peer mode that can merge remote work into the same local project view.
- Terminal snapshot and watch mode.
- VS Code activity-bar panel.
- Current-workload-first scene with subtle recent history.
- Shared model across all renderers.

## Support matrix

| Source | Project discovery | Live state | Typed approvals/input | Subagent correlation | Resume/open |
| --- | --- | --- | --- | --- | --- |
| Codex app-server | V | V | V | V | V |
| Claude Agent SDK + hooks | V | basic | V | basic | X |
| Claude local transcripts only | V | inferred | X | X | X |
| Cursor cloud agents | V | cloud | X | basic | V |
| OpenClaw gateway | V | basic | X | basic | X |

## Quick start

### One line

From the cloned repo root:

```bash
npm start
```

That bootstraps the workspace if needed, rebuilds, and starts the web server on `http://127.0.0.1:4181`.

### Requirements

- Node.js and npm
- a cloned copy of this repo

### Optional integrations

- Codex CLI or Codex app for the strongest local visibility
- Claude local sessions for passive Claude visibility
- Claude hooks or Agent SDK bridge for stronger typed Claude visibility
- `CURSOR_API_KEY` for Cursor cloud-agent visibility
- OpenClaw gateway access for OpenClaw visibility

### Run the web view

```bash
npm start
```

Open [http://127.0.0.1:4181](http://127.0.0.1:4181).

Fleet mode is the default. For a focused single-project run:

```bash
npm start -- /abs/project/path --port 4181
```

For cheap same-Wi-Fi visibility across matching clones:

```bash
npm start -- --lan --lan-key office-demo
```

`--lan` enables UDP peer discovery and widens the default bind host to `0.0.0.0` unless you explicitly pass `--host`. Remote agents are merged only when the peer snapshot reports the same git remote identity as the local project.

Optional dev check:

```bash
npm run typecheck
```

### Run the terminal view

Snapshot once:

```bash
node packages/cli/dist/index.js snapshot /abs/project/path
```

Watch live:

```bash
node packages/cli/dist/index.js watch /abs/project/path
```

### Run the demo

```bash
node packages/cli/dist/index.js demo preview --port 4181
```

### Run the VS Code panel

```bash
npm run build -w packages/vscode
```

Then open this repo in VS Code and press `F5`.

## How it works

The product normalizes everything into one shared workload model, then renders it in the browser, terminal, and VS Code.

Preferred sources:

- `codex app-server` for local Codex threads, approvals, turns, and notifications
- `codex cloud list --json` for cloud and web tasks
- Claude Agent SDK session APIs and Claude hook sidecars when available
- Claude local transcripts as fallback
- Cursor cloud-agent API
- OpenClaw gateway sessions

Important product rule:

- Codex is still the strongest integration surface today.
- Claude, Cursor, and OpenClaw are useful secondary sources.
- Provenance and confidence stay visible so inferred state does not look like typed state.

## Repo layout

- `packages/core`: shared discovery, normalization, rooms, appearance, and snapshot plumbing
- `packages/web`: browser server and office renderer
- `packages/cli`: `watch`, `snapshot`, demo, and web entrypoints
- `packages/vscode`: VS Code activity-bar integration
- `docs`: architecture, integration hooks, references, and priorities

## Docs

- [docs/spec.md](docs/spec.md): product and renderer expectations
- [docs/architecture.md](docs/architecture.md): system design and package boundaries
- [docs/integration-hooks.md](docs/integration-hooks.md): exact source surfaces and mappings
- [docs/self-development.md](docs/self-development.md): priorities and backlog
- [docs/references.md](docs/references.md): external references
- [CHANGELOG.md](CHANGELOG.md): notable shipped changes

## Notes

- The repo and package names still use `codex-agents-office` for now.
- The product name in the UI and docs is `Agents Office Tower`.
