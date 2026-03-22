# Codex Agents Office

Greenfield prototype for a Codex activity viewer with two entry points:

- a VS Code tab that renders project rooms and active agents
- a terminal watcher that prints the same room/session model
- a browser-hosted web mode for fleet and per-project room views

The current vertical slice is built around official Codex surfaces instead of transcript heuristics first:

- `codex app-server` for local thread discovery and thread reads
- `codex cloud list --json` for Codex web/cloud tasks
- per-project `.codex-agents/rooms.xml` for room layout
- per-project `.codex-agents/agents.json` for persisted appearance overrides
- PixelOffice CC0 assets under `packages/web/public/pixel-office/` for browser sprites and room dressing

## Workspace

- [docs/architecture.md](/mnt/f/AI/CodexAgentsOffice/docs/architecture.md)
- [packages/core](/mnt/f/AI/CodexAgentsOffice/packages/core)
- [packages/cli](/mnt/f/AI/CodexAgentsOffice/packages/cli)
- [packages/vscode](/mnt/f/AI/CodexAgentsOffice/packages/vscode)

## Commands

```bash
npm install
npm run build
npm run typecheck
```

For the terminal watcher after install/build:

```bash
npx codex-agents-office watch
```

To include historical sessions in the terminal view:

```bash
npx codex-agents-office watch --history
```

To inspect an Aseprite source file and print the export command this project expects:

```bash
npx codex-agents-office aseprite inspect packages/web/public/pixel-office/PixelOfficeAssets.aseprite
```

To surface the current desktop session as a synthetic live “boss” agent in a project:

```bash
npx codex-agents-office presence boss /mnt/f/AI/CodexAgentsOffice
```

To clear that boss marker:

```bash
npx codex-agents-office presence clear /mnt/f/AI/CodexAgentsOffice
```

For browser mode:

```bash
npx codex-agents-office web --port 4181
```

Then open [http://127.0.0.1:4181](http://127.0.0.1:4181).

For LAN or reverse-proxy deployment from the current machine:

```bash
npx codex-agents-office web /mnt/f/AI/CodexAgentsOffice --host 0.0.0.0 --port 4181
```

Direct deep link to a single project:

```text
http://127.0.0.1:4181/?project=/mnt/f/AI/CodexAgentsOffice
```

Browser view modes:

- `?view=map` for the room layout
- `?view=terminal` for the terminal-style project view
- default mode shows current workload only
- `?history=1` to include older sessions
- `?screenshot=1` to render a static snapshot without opening the live SSE stream

## Pixel Office visuals

- The web renderer now serves the supplied PixelOffice PNG and `.aseprite` files directly from `/assets/pixel-office/...`.
- Room shells still come from `.codex-agents/rooms.xml`, but booth interiors are generated live from the current agents mapped into each room.
- Booths are grouped by Codex agent role, so repeated subagent types such as `worker` or `explorer` naturally produce repeated booth clusters.
- Agent looks still persist through `.codex-agents/agents.json`; cycling a look changes the saved appearance and the sprite selection derived from it.
- `.codex-agents/presence.json` can inject a live “boss” or observer agent for the current Codex desktop session when that thread is not surfaced by `codex app-server`.
- Web mode refreshes that boss presence automatically for the server workspace so the current Codex desktop work does not disappear after a few minutes.
- Runtime rendering uses the shipped PNG sheets. When Aseprite CLI is available, export JSON with `--data` and `--list-slices` so slices/tags can become a richer manifest later.
