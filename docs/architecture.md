# Architecture

## Goal

Render Codex work as a room-based "agent office" without depending on private internals. The current pass keeps the official Codex integration surface and renders active workload as room-based office stations built from PixelOffice assets.

Behavior and renderer expectations now live in [docs/spec.md](/mnt/f/AI/CodexAgentsOffice/docs/spec.md). This file stays focused on system structure and module boundaries.

## Codex hook strategy

The detailed hook inventory now lives in [docs/integration-hooks.md](/mnt/f/AI/CodexAgentsOffice/docs/integration-hooks.md). This file stays focused on architecture and product shape.

1. `codex app-server`

   Official docs describe `thread/start`, `thread/list`, `thread/read`, and a live notification stream for `turn/*`, `item/*`, approvals, command execution, and file changes. That makes it the best local integration surface for CLI, IDE, and app-originated threads.

   In this codebase, that still means we need a runnable Codex executable. We prefer `codex` on `PATH`, allow `CODEX_CLI_PATH` overrides, fall back to the macOS app bundle binary when present, and on Windows can extract the Store app's packaged `codex.exe` into a local cache and run that copy. When both WSL CLI and Windows app runtimes exist, `PATH` still decides unless the override is set.

   Source: [App Server](https://developers.openai.com/codex/app-server)

2. `codex cloud list --json`

   Codex web/cloud tasks are exposed through the CLI cloud surface. That gives us a supported way to surface web tasks next to local sessions.

   Source: [Codex web](https://developers.openai.com/codex/cloud)

3. Claude local session logs

   `~/.claude/projects/*.jsonl` is a usable secondary source for project discovery and recent Claude activity. It is not equivalent to Codex app-server: the data is transcript-like and requires inference. That makes it suitable as a best-effort adapter layer, not as the primary truth source.

4. OpenClaw gateway sessions

   OpenClaw exposes an official Gateway control plane with agent-scoped sessions, session hierarchy, system presence, and agent workspace config. The current adapter treats that as a typed secondary source for session and workspace visibility, then maps configured agent workspaces back onto discovered office projects.

5. Cursor cloud agents

   Cursor exposes an official cloud-agent API with account-level agent status, target URLs, conversation history, webhooks, and model listing. The current adapter matches those agents back onto the selected project through normalized git remote URLs plus PR-backed repository URLs, so it is official and typed, but still weaker than Codex local app-server visibility.

6. Per-project room config

   Each project can define its own spatial hierarchy in `.codex-agents/rooms.xml`. Rooms map to directory prefixes so the same session can move between rooms as its working files change.

7. Per-project appearance roster

   New sessions get a deterministic random appearance. Overrides are stored in `.codex-agents/agents.json`, which locks their look until changed.

8. Codex subagent roles

   Codex ships with built-in subagents such as `default`, `worker`, and `explorer`, and custom agents can define `nickname_candidates` for more readable spawned names. The visual layer groups booths by the underlying role, while still showing the friendlier label when available.

   Source: [Subagents](https://developers.openai.com/codex/subagents)

## Why not only tail JSONL files?

Local session JSONL files are still useful as a fallback, and Codex can persist history/session data and export OTel logs. But app-server gives a cleaner normalized thread/item model first, with approvals and file changes already typed.

The live browser path now uses a hybrid approach:

- `thread/list` and `thread/read` stay authoritative for stable thread state
- `thread/list` is discovery-oriented only; ongoing occupancy also follows `thread/read` turn state so a `notLoaded` thread with an in-progress turn still stays live on the floor
- active and recent threads are resumed on the observer connection so the app can receive live `turn/*`, `item/*`, approval, input, and `serverRequest/resolved` events
- observer runtime unload notifications such as `thread/closed` or `thread/status/changed -> notLoaded` are treated as subscription state, not as proof that the underlying thread resolved
- slow desktop `thread/resume` attaches now happen in the background so the web server does not block initial rendering on them
- watched thread JSONL paths trigger quick re-reads when a local session changes
- reread desktop rollout threads can synthesize message notifications from the newest assistant text when the live subscription path is degraded
- streamed `item/agentMessage/delta` notifications are intentionally opted out on the observer connection; reply toasts prefer full reply items or reread thread messages
- non-final commentary messages on interrupted desktop turns are still treated as active work so subscribed agents do not briefly vacate their desk between commentary updates
- periodic discovery still runs so newly created sessions appear without a page refresh

In fleet mode, every discovered workspace now keeps a live `ProjectLiveMonitor`. Selection in the UI only changes what is centered in the browser; it does not rebuild the live monitor set.

The observer does attach to resumable threads now, but only for active/recent sessions and only to observe. It does not answer approval or input requests; it only visualizes them.

Sources:

- [Advanced configuration / telemetry](https://developers.openai.com/codex/config-advanced)
- [Configuration reference / history persistence](https://developers.openai.com/codex/config-reference)

## UI shape

- VS Code tab
  - left: room map
  - right: session inspector
  - actions: refresh, open/scaffold room XML, resume local thread, open cloud task, cycle appearance

- Terminal watcher
  - grouped by room
  - local thread state, last action, resume command
  - cloud task list

- Demo preview harness
  - disposable fake app workspace for visual/testing passes
  - scripted presence timeline with demo agents, demo skills, and room config
  - auto-cleanup on exit unless launched with `--keep`

- Browser mode
  - fleet view across multiple configured project roots
  - fleet map renders as a continuous tower of workspace floors instead of a stack of separate cards
  - deep-linkable single-project room view through `?project=<abs-path>`
  - explicit CLI project roots stay pinned to those roots instead of being replaced by auto-discovered workspace lists
  - live SSE updates for browser clients
  - all discovered workspaces stay live-monitored at once
  - optional LAN federation can discover nearby peers over UDP broadcast and merge their agent state into matching local projects
- map and terminal-style views through `?view=map|terminal`
- live agents only on desks, plus the 4 most recent top-level lead sessions resting in the rec area
- local threads remain seated while the thread is still ongoing, even if they pause between visible events or the latest turn already looks done
- once a thread actually stops, it remains seated for a short 2-second grace window so final replies are still readable
- after that grace window, only recent top-level lead sessions cool down into the rec area; finished subagents despawn instead of idling there
- lead sessions with more than one active subagent now use a slimmer left-side lead lane with a distinct floor treatment and horizontal separators, instead of a large boxed office
- session panel includes a durable cross-project "needs you" queue for approval/input waits
  these entries now come from typed request hooks, not from regexes over session detail
  - session cards expose provenance/confidence so Codex-native, Claude transcript, Claude hook-backed, and Cursor API-backed state stay distinguishable
  - snapshot-only rendering through `?screenshot=1`
  - session-card hover/focus dims unrelated agents so the visible thread cluster for that session stands out in the map
  - HTTP endpoints for snapshot refresh, room scaffolding, and appearance cycling
  - PixelOffice art served from `/assets/pixel-office/...`
  - auto-generated room activity based on the currently mapped agent set
  - repeated workstation rows for repeated Codex agent roles
  - agent-anchored file-change notifications for current agents, showing filename-first copy and available `+/-` line deltas
  - shared fleet-only sky backdrop with parallax pixel-cloud layers behind the tower, while individual rooms no longer paint their own cloud mural
- hover/session detail surfaces for longer text instead of large scene overlays
- browser map layout now derives from a tile-grid settings model instead of renderer-local pixel literals
- internal scene settings define prefab geometry and spacing such as tile size, boss-booth size, desk-pod span, top-band depth, cubicle-group spacing, column spacing, and rec-strip depth
- the scene tile is now a fixed `16px` unit in both normal and compact map modes so grid placement aligns with native PixelOffice asset sizing
- global browser settings currently expose only text scale; it applies to hover/toast/map text but does not change room or prefab geometry
- the retained browser map path now uses a persistent Pixi scene host plus HTML anchor overlays for toast positioning, so map updates can mutate scene entities without replacing the scene shell
- routed avatar movement in the Pixi scene now uses a lightweight grid pathfinder against room occupancy instead of direct straight-line scene tweens

### Web package composition

The web package now separates transport, lifecycle, and rendering concerns instead of keeping them in one oversized entry file.

- `packages/web/src/server.ts`
  Starts the HTTP server, wires shutdown, and delegates everything else.
- `packages/web/src/server-options.ts`
  Parses CLI args and normalizes project descriptors.
- `packages/web/src/server-metadata.ts`
  Builds startup fleet placeholders and the shared `/api/server-meta` payload shape.
- `packages/web/src/fleet-live-service.ts`
  Owns `ProjectLiveMonitor` instances, refreshes the active project set, publishes fleet snapshots, exposes the live bound project list for `/api/server-meta`, merges matching LAN peer state into local projects, and fans them out over SSE. Fleet-wide cloud task polling also lives here now so `codex cloud list` runs once per fleet refresh cycle instead of once per project monitor, with shared backoff when the upstream cloud surface rate-limits.
- `packages/web/src/lan-peer-service.ts`
  Advertises the local web listener over UDP broadcast, tracks nearby peers that share the same optional LAN key, and fetches their local-only fleet payloads so remote agents can be merged without re-export loops.
- `packages/web/src/router.ts`
  Maps routes to handlers for HTML, static assets, project image previews, fleet/meta APIs, refresh, appearance cycling, and room scaffolding. In fleet mode, the meta route now reports the live project set from `FleetLiveService`, not just the startup seed options.
- `packages/web/src/render-html.ts`
  Builds the HTML shell and injects the browser assets.
- `packages/web/src/client-script.ts`
  Holds the browser-side office/terminal renderer, scene state wiring, and live update client.
- `packages/web/src/toast-script.ts`
  Holds browser-side toast queueing, stacking, timing, preview, and DOM rendering so notification behavior does not stay embedded in the main renderer script.
- `packages/web/src/client-styles.ts`
  Holds the browser CSS.
- `packages/web/src/http-helpers.ts`
  Centralizes JSON/body helpers and static/project-file response handling.

This keeps the browser behavior the same, but makes the server easier to extend and test without threading unrelated concerns through the entrypoint.

## Room XML

```xml
<agentOffice version="1">
  <room id="root" name="Project" path="." x="0" y="0" width="24" height="16">
    <room id="src" name="Source" path="src" x="1" y="1" width="11" height="6" />
    <room id="tests" name="Validation" path="tests" x="13" y="1" width="10" height="6" />
  </room>
</agentOffice>
```

`path` is interpreted as a project-relative directory prefix in this first version. Nested rooms allow local hierarchy without inventing a second config format.

## Pixel-agents takeaways

The closest open-source reference is [pixel-agents](https://github.com/pablodelucca/pixel-agents). The useful ideas to keep are:

- a host-specific adapter layer
- room/layout persistence separate from live activity state
- status driven by tool and transcript activity instead of only terminal focus
- lightweight NPC behavior where active agents stay at their desk while idle or blocked agents visibly break formation

The main change here is swapping transcript-only heuristics for Codex app-server + cloud surfaces first.

## Transparency Model

The reader should be able to answer two questions for any visible state:

1. Why is this agent shown as active, waiting, blocked, or done?
2. Which Codex signal caused that representation?

The current implementation already has the right base surfaces:

- thread status from `thread/list` and `thread/read`
- active flags for approval waits and user-input waits
- turn and item history for summarization
- app-server notifications and server requests for live changes
- file-change driven activity events

The browser now carries a stronger event attribution path:

- raw app-server notifications are normalized into snapshot `events`
- server-initiated approval/input requests are normalized into both snapshot `events` and per-agent `needsUser` state
- browser notifications can react to those event-native records directly
- approval and input waits are also surfaced in a durable cross-project "needs you" queue
- Claude-derived sessions are explicitly marked through provenance/confidence metadata so transcript inference and hook-backed state do not read the same

What is still missing is richer motion and posture tied to those events. The product can now explain more of what changed; the next step is making those changes feel more visible in-scene.

## Event-driven notification model

Codex exposes enough signal for a more explicit notification model than the current one.

Current mapping:

- `waitingOnApproval`
  blocked indicator, approval-needed toast, and durable needs-you queue entry
- `waitingOnUserInput`
  waiting indicator, ask-user toast, and durable needs-you queue entry
- `item/*` command execution
  running / completed / failed command notifications, rendered as a command-prompt style mini window with monospace command text
  one command window toast is kept per agent; new commands append to the bottom, keep the last 3 lines, and extend the visible lifetime
- read-only shell inspection actions
  short summary toasts such as `Read workload.ts` or `Exploring 2 files`, instead of replaying the full shell command string
- `fileChange`
  agent-anchored create / edit / delete / move toasts, with filename-first copy, optional `+/-` line deltas, and image preview when possible
- shared toast stack model
  command and file-change toasts now use the same stacking and lifetime path, while preserving their distinct visual shells
- `turn/*`
  turn started / finished / interrupted / failed status transitions
- `webSearch`
  dedicated web-search toast only when a native Codex `webSearch` event reaches the observer; desktop-side search activity that only surfaces as commentary cannot yet be reconstructed into a typed search toast
- subagent spawn and completion
  parent-linked spawn/finish notifications and motion updates
- exact app-server method icons
  toast icons resolve from `/assets/pixel-office/sprites/icons/<method>.svg` when a matching pixel icon exists
- semantic thread-item icons
  generic item fallbacks and the visual audit page resolve from `/assets/pixel-office/sprites/icons/thread-item/*.svg` plus reused exact-method icons where appropriate
- icon audit route
  `/icon-audit` renders the current official thread-item list and every exact method icon for visual inspection

Remaining roadmap:

- stronger in-scene motion for turn and approval lifecycle
- direct action affordances from queue items back into the originating Codex surface
- clearer styling differences between typed Codex truth and Claude inference

## Current workstation model

The active office view currently favors an open station language over enclosed cubicles:

- mirrored two-seat workstation pods define the primary desk language
- workstation slots are pinned to a fixed floor grid instead of being repacked when new agents appear
- workstation slot ownership should be sticky across incremental scene updates; a scene rerender or non-positional refresh must not discard prior slot memory
- desk columns start around one-fifth of the room width, leaving room for a compact lead lane on the left when needed
- each workstation column now uses a single visible cubicle stack with 3 tightly stacked workstation rows so active desks stay inside a standard room height
- role grouping prefers to keep the same agent types inside the same visible workstation stack before spilling into a new column
- a pod collapses to a single centered seat when only one live agent occupies it
- newly occupied seats use a short retro blink reveal so the workstation appears before the worker settles
- avatars themselves no longer flash on enter or exit; only the workstation reveal animates, and removals disappear immediately once the thread leaves current workload
- left and right seats face opposite directions inside each pod
- seated agents flip with the workstation direction and align to the desk/chair reach point
- lead-session arrivals and all departures use the center-top room entrance as the path anchor so workers visibly leave through the doorway
- entering subagents split off from a nearby position around their parent, blink briefly in place, then move to their assigned desk or wall-side slot
- lead sessions with more than one spawned subagent move into a dedicated left-side lead lane with a distinct floor treatment and open separators instead of a boxed wall
- hovering a boss reveals arrow lines from that office to the related spawned subagents
- chairs and seated reach points sit slightly outward from the desk so the monitor relationship reads cleanly
- workstation computers currently use the single complete desk cut, avoiding the broken narrow pseudo-monitor asset
- waiting and resting agents move to an integrated wall-side rec strip instead of a detached room
- rec-room seating should be keyed by stable agent identity and furniture-relative sofa slots, not recomputed purely from per-render sort order
- the browser view no longer exposes a current/history toggle; it always shows current agents plus 4 recent lead sessions
- rec facilities sit on the same raised upper floor band as the wall-side walkway, not in a floating inset
- the rec strip combines vending, counter, doors, clock, plants, sofa, and shelf props inside the same scene
- long task titles stay in hover cards and the session panel instead of being drawn over the map
- the floor is restored to the blue office-strip language from the reference art, including an upper wall-side walkway for rec facilities
- layout constants are now expressed as internal tile-grid settings instead of only pixel literals, so boss booths, desk columns, rec-strip depth, and inter-cubicle spacing all derive from a single floor grid
- global viewer settings are separate from internal scene settings; the first user-facing control is text scale, clamped from `0.75x` to `2.00x`, while prefab sizing and spacing stay internal
- the current browser renderer is Pixi-first for the office map, with HTML retained only for overlays, controls, and fallback terminal output
- browser placement rules are intentionally a little stickier than raw workload freshness, because a live local thread should not visually bounce desk -> rec -> desk during short polling gaps

## Secondary Claude support

Claude support uses a deliberately weaker contract than Codex:

- project discovery merges Codex-discovered roots with roots inferred from `~/.claude/projects`
- when the Anthropic Agent SDK is available, Claude project discovery prefers `listSessions()` and per-session `cwd` metadata before falling back to raw directory scanning
- the snapshot builder can include recent Claude sessions for matching project roots
- recent Claude session messages can now be read through the supported Agent SDK `getSessionMessages()` API before falling back to raw JSONL transcript sampling
- transcript-only Claude session state is still inferred from recent tool uses such as read, edit, bash, and task delegation when no typed hook signal exists
- optional project-local hook sidecars in `.codex-agents/claude-hooks/<session-id>.jsonl` can be produced either by a Claude Code hook script or by the exported Agent SDK sidecar bridge, and they upgrade Claude sessions to typed permission, tool, subagent, and stop state
- Claude agents are rendered in the same room model, but with explicit provenance/confidence so transcript inference and hook-backed state do not pretend to have Codex-grade app-server coverage

This is useful because it broadens observability across the machine, but it should remain visually and architecturally secondary to the official Codex path.

## Secondary Cursor support

Cursor support currently uses the official cloud-agent API instead of local transcript scraping:

- the adapter calls Cursor's account-level cloud-agent API when `CURSOR_API_KEY` is configured
- agents are matched to the selected project by normalized git `remote.origin.url`, `source.repository`, or PR-backed repository URLs when Cursor reports `source.prUrl` or `target.prUrl`
- Cursor agents are rendered in the same room and session model with `confidence = typed`
- the current integration surfaces typed status, summary, branch, repo, and target URL data
- Cursor does not currently provide Codex-style local live thread subscriptions here, so the integration is closer to a richer cloud-task feed than to local Codex app-server visibility

This makes Cursor a useful third official source without pretending that it offers Codex-grade local observability.

## Secondary OpenClaw support

OpenClaw support uses the official Gateway session model instead of trying to reinterpret OpenClaw as a task board:

- the adapter connects to the OpenClaw Gateway when `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, or `OPENCLAW_GATEWAY_PASSWORD` is configured
- it reads typed session rows from `sessions.list` and typed workspace config from `config.get`
- it maps OpenClaw agent workspaces onto office projects by normalized workspace path equality
- parent and child OpenClaw sessions are carried through `parentThreadId` and depth so delegated session trees stay visible
- the current integration is read-only and surfaces session/workspace presence, not OpenClaw action controls

This keeps OpenClaw aligned with its real abstraction boundary, which is sessions inside configured agent workspaces rather than project tasks.


## Asset pipeline

- The source PixelOffice atlas PNG and `.aseprite` files are kept in the repo for reference and future export work.
- The runtime path now uses standalone PNG cuts under `/assets/pixel-office/sprites/...` instead of CSS background-position math against the atlas.
- The supplied `.aseprite` files can still be inspected through `codex-agents-office aseprite inspect <file>`.
- Official Aseprite docs recommend exporting slice metadata into JSON via sprite sheet export or `--data`; that is still the likely bridge from authored Aseprite assets into a richer scene manifest later.

Sources:

- [Aseprite files](https://www.aseprite.org/docs/files)
- [Aseprite slices export](https://www.aseprite.org/docs/slices/)
