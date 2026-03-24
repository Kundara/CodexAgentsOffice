# AGENTS

## Purpose

`CodexAgentsOffice` is a workspace-level observability layer for Codex sessions.
It renders current workload across local and cloud Codex work as:

- a browser office view
- a terminal snapshot/watch view
- a VS Code panel

The project goal is not generic chat replay. It is live workload visibility:

- which Codex workspaces are active now
- which parent sessions are leading work
- which subagents are active, waiting, blocked, or done
- what room or project area that work maps to

## Repo map

- `packages/core`
  Shared project discovery, room parsing, appearance storage, workload classification, and live snapshot plumbing.
- `packages/web`
  Browser server and renderer for the office / terminal views.
- `packages/cli`
  CLI entrypoints for watch, snapshot, room scaffolding, Aseprite inspection, and web hosting.
- `packages/vscode`
  VS Code activity-bar integration.
- `docs/architecture.md`
  High-level system design and current rendering model.
- `docs/integration-hooks.md`
  Exact Codex, Claude, and Cursor integration surfaces, plus how they map into the product.
- `docs/self-development.md`
  Project-quality bar, iteration priorities, and what to improve next.
- `docs/references.md`
  External references used by this project.
- `.codex/agents`
  Local Codex subagent definitions used for demos and role testing.
- `.codex-agents`
  Per-project runtime data such as `rooms.xml` and appearance overrides.

## Working rules

- Treat the current workload view as the primary product surface.
- Prefer official Codex surfaces over transcript scraping.
- Keep rooms data-driven through `.codex-agents/rooms.xml`.
- Keep appearance persistence in `.codex-agents/agents.json`.
- Do not introduce fake “boss” agents as the main solution path.
  If current desktop visibility is missing, prefer improving real session discovery.
- The office map should communicate activity mostly through motion, placement, hover cards, and the session panel.
  Avoid large task-title overlays inside the room scene.
- Prefer small in-scene transparency cues over separate dashboard furniture.
  High-level summaries should stay subtle and not read like a detached admin panel.
- Keep Codex-native typed state visually distinct from Claude-inferred state.
  Hover cards, session panels, and event surfaces should expose provenance/confidence when that distinction matters.
- Avoid avatar flash-in/flash-out effects for workstation occupancy.
  Workstations may reveal on entry, but exits should disappear cleanly without a lingering blink.
- PixelOffice art should be assembled from the asset sheet intentionally.
  Do not use the example scene PNG as a runtime collage substitute.

## Commands

```bash
npm install
npm run build
npm run typecheck
npx codex-agents-office demo preview --port 4181
npx codex-agents-office watch
npx codex-agents-office snapshot /abs/project/path
npx codex-agents-office web --port 4181
```

## Web ops

- Treat the listener on `4181` as explicit runtime state.
  Do not assume the page in the browser matches the latest source tree unless the server was rebuilt and restarted.
- If the browser shell looks stale or empty, verify the live server first:

```bash
curl http://127.0.0.1:4181/api/server-meta
curl http://127.0.0.1:4181/api/fleet
```

- `api/server-meta` is the source of truth for:
  - `pid`
  - `startedAt`
  - `buildAt`
  - `explicitProjects`
  - `entry`
  - bound projects / port
- Default browser deploys must run in fleet mode.
  Launch `web` without a project argument so all discovered Codex workspaces remain visible.
  Only pass explicit project roots for temporary focused debugging, and verify `explicitProjects: false` in `api/server-meta` after normal restarts.
- If a stale listener is on `4181`, kill it explicitly:

```bash
lsof -iTCP:4181 -sTCP:LISTEN -n -P
lsof -tiTCP:4181 -sTCP:LISTEN | xargs -r kill
pkill -f 'packages/web/dist/server.js --port 4181'
```

- If launching through the CLI entrypoint, rebuild both packages first:

```bash
npm run build -w packages/web
npm run build -w packages/cli
node packages/cli/dist/index.js web --port 4181
```

- If you only need the raw web server path for validation, this is acceptable:

```bash
node packages/web/dist/server.js --port 4181
```

- The in-page `Refresh` button refreshes fleet data.
  It does not replace a stale Node listener with a fresh build.
- If the UI suddenly shows only the current repo again, assume the listener was restarted in explicit-project mode first.
  Check `api/server-meta` before debugging discovery logic.
- For visual validation, prefer real browser captures against `4181`.
  Snapshot mode is acceptable when you want a stable still render:

```bash
'/mnt/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless --disable-gpu --no-first-run \
  --disable-background-networking --disable-sync \
  --window-size=920,1600 \
  --virtual-time-budget=20000 \
  --timeout=25000 \
  --screenshot='F:\AI\CodexAgentsOffice\validate.png' \
  'http://127.0.0.1:4181/?project=/abs/project/path&screenshot=1'
```

## Renderer expectations

- Use current workload by default.
- Keep the browser map fixed to live agents on desks plus the 4 most recent lead sessions in the rec area.
- Keep browser layout responsive across wide and narrow screens.
- Empty rooms should read as quiet space, not error states.
- Rec Room is for waiting/resting agents only.
- Workstations should match the chosen PixelOffice station language consistently across rows.
- Command-window toasts should aggregate per agent instead of stacking duplicate windows.
  Keep one toast per agent, append new command lines at the bottom, and cap the bubble at 3 visible lines.
- The session panel should keep the durable approval/input "Needs You" queue visible when those states exist.
- Hover details should expose the useful live state:
  - name
  - role
  - state
  - last useful action
  - provenance / confidence when relevant
  - resume/open affordance when available

## Documentation expectations

When architecture or behavior changes materially, update:

- `README.md`
- `docs/architecture.md`
- `docs/integration-hooks.md` if hook usage or representation changed
- `docs/self-development.md` if priorities changed
- `docs/references.md` if a new external source shaped the implementation
