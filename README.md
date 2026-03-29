# Agents Office Tower

Live workload visibility for coding agents.

Agents Office Tower shows active work across local and cloud agent sessions in three places:

- a browser office view
- a terminal snapshot/watch view
- a VS Code activity-bar panel

It is built for current workload visibility, not transcript replay.

![Agents Office Tower preview](docs/images/tower-preview.png)

## What It Does

- Discovers active workspaces and renders them in fleet mode by default.
- Supports a focused single-project view when you want one repo at a time.
- Normalizes Codex, Claude, Cursor, OpenClaw, presence, and cloud inputs into one shared snapshot model.
- Keeps the browser, terminal, and VS Code views on that same model.
- Treats current work as the primary scene, with only light recent-history visibility.

## Current Surfaces

- Browser office view
- Terminal `snapshot` and `watch`
- VS Code activity-bar panel

## Supported Sources

- Codex local runtime via `codex app-server`
- Codex cloud tasks via `codex cloud list --json`
- Claude local logs, hooks, and Agent SDK signals
- Cursor local hook sidecars and Cursor cloud agents
- OpenClaw gateway sessions

Codex is still the strongest integration path.

## Quick Start

Run the web view:

```bash
npm start
```

Open [http://127.0.0.1:4181](http://127.0.0.1:4181).

`npm start` installs dependencies if needed, rebuilds the workspace, and launches the web server on port `4181` unless you pass another port.

## Other Modes

Web, single-project focus:

```bash
npm start -- /abs/project/path --port 4181
```

Terminal snapshot:

```bash
node packages/cli/dist/index.js snapshot /abs/project/path
```

Terminal watch:

```bash
node packages/cli/dist/index.js watch /abs/project/path
```

Demo preview:

```bash
node packages/cli/dist/index.js demo preview --port 4181
```

Build and typecheck:

```bash
npm run build
npm run typecheck
```

## Browser Notes

- Fleet mode is the default browser mode.
- Fleet mode only keeps autodiscovered workspaces with session activity in the last 7 days.
- Git worktrees from the same repo merge onto one floor by default.
- The browser exposes a global `Split Worktrees` toggle when you want one floor per worktree instead.
- Single-project focus uses the same compact scene geometry as the tower view.
- Desk behavior follows normalized modes: working and waiting sessions stay on-desk, blocked failures stand at the desk, done/idle sessions cool into resting visibility, and cloud work stays separate.
- The office view uses smaller above-head state markers for needs-user waits, planning, pre-message typed thinking moments, and blocked-error states in addition to the toast layer.

## Optional Integrations

- Codex CLI for the best local visibility
- Codex desktop app as a fallback runtime
- Cursor local hooks in `.cursor/hooks.json`
- Cursor cloud-agent API via `CURSOR_API_KEY` or the browser settings flow
- PartyKit-backed shared browser room sync

<details>
<summary>Cursor hooks</summary>

This repo ships project-level Cursor hooks in [`.cursor/hooks.json`](.cursor/hooks.json) and [`.cursor/hooks/capture-cursor-hook.mjs`](.cursor/hooks/capture-cursor-hook.mjs).

When the repo is opened in a trusted Cursor workspace, those hooks append typed local sidecars into `.codex-agents/cursor-hooks/`. Agents Office reads local Cursor activity from those sidecars.

To add the same integration to another repo:

1. Create a `.cursor/` folder in that repo.
2. Copy [`.cursor/hooks.json`](.cursor/hooks.json).
3. Copy [`.cursor/hooks/capture-cursor-hook.mjs`](.cursor/hooks/capture-cursor-hook.mjs).
4. Keep the command path as `node .cursor/hooks/capture-cursor-hook.mjs <event-name>`.
5. Open that repo in a trusted Cursor workspace and send one fresh prompt.

Minimal verification:

1. Confirm a new `.codex-agents/cursor-hooks/<conversation-id>.jsonl` file appears.
2. Refresh Agents Office.

For Cursor cloud-agent visibility, set `CURSOR_API_KEY` or save the key in the browser `Settings` popup.

More detail: [docs/integration-hooks.md](docs/integration-hooks.md)
</details>

<details>
<summary>PartyKit shared-room sync</summary>

The browser can join a shared PartyKit room from the `Settings` popup.

Fields:

- `Sharing`: toggle sync on or off
- `Host`: your PartyKit host such as `your-app.partykit.dev`
- `Room`: a shared room name such as `team/project-name`
- `Nickname`: an optional short label shown on remote agents

Once connected, each local project floor also gets a persisted `Shared` toggle in its header so you can stop broadcasting that project without leaving the room. Remote-only projects exposed by the room now stay visible even when they are not local to your machine, show active participant nicknames in the floor header, grey the title slightly when you are not involved locally, and cool down for 1 hour before disappearing after sharing stops.

Quick relay flow:

```bash
npm run party:dev
npm run party:deploy
```

After deploy, use the generated `partykit.dev` host in the browser `Settings`.

More detail:

- [docs/references.md](docs/references.md)
- [docs/architecture.md](docs/architecture.md)
</details>

## VS Code

Build the extension:

```bash
npm run build -w packages/vscode
```

Then open the repo in VS Code and press `F5`.

## Repo Layout

- `packages/core`: shared model, discovery, adapters, snapshot assembly, and workload policies
- `packages/web`: HTTP server and bundled browser client
- `packages/cli`: `web`, `snapshot`, `watch`, and demo entrypoints
- `packages/vscode`: VS Code panel
- `packages/party`: optional PartyKit relay
- `docs`: architecture, hooks, references, and priorities

## Docs

- [docs/spec.md](docs/spec.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/integration-hooks.md](docs/integration-hooks.md)
- [docs/self-development.md](docs/self-development.md)
- [docs/references.md](docs/references.md)
- [CHANGELOG.md](CHANGELOG.md)


## Asset Credits

- Main PixelOffice environment assets come from [2D Pig's Pixel Office pack](https://2dpig.itch.io/pixel-office).
- Pixel food/drink held-item icons in `packages/web/public/pixel-office/sprites/props/drinks/` come from [Alex Kovacs Art's "100 Free Pixel Art Foods!"](https://alexkovacsart.itch.io/free-pixel-art-foods), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
