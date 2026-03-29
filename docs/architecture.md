# Architecture

## Goal

Render Codex work as a room-based "agent office" without depending on private internals. The current pass keeps the official Codex integration surface and renders active workload as room-based office stations built from PixelOffice assets.

Behavior and renderer expectations now live in [docs/spec.md](./spec.md). This file stays focused on system structure and module boundaries.

## Codex hook strategy

The detailed hook inventory now lives in [docs/integration-hooks.md](./integration-hooks.md). This file stays focused on architecture and product shape.

1. `codex app-server`

   Official docs describe `thread/start`, `thread/list`, `thread/read`, and a live notification stream for `turn/*`, `item/*`, approvals, command execution, and file changes. That makes it the best local integration surface for CLI, IDE, and app-originated threads.

   In this codebase, that still means we need a runnable Codex executable. We prefer `codex` on `PATH`, allow `CODEX_CLI_PATH` overrides, fall back on native Windows to `wsl.exe --exec codex` when the CLI is only installed inside WSL, fall back to the macOS app bundle binary when present, and on Windows can extract the Store app's packaged `codex.exe` into a local cache and run that copy. When both native/WSL CLI and app runtimes exist, CLI still decides unless the override is set.

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
- active `thread/list` rows are always retained in the tracked local-thread set even when they are older than the normal recent-thread cutoff, so a live desktop session is subscribed on startup before its next visible delta
- active and recent threads are resumed on the observer connection so the app can receive live `turn/*`, `item/*`, approval, input, and `serverRequest/resolved` events
- observer runtime unload notifications such as `thread/closed` or `thread/status/changed -> notLoaded` are treated as subscription state, not as proof that the underlying thread resolved; `notLoaded` now gets a short 3-second confirmation cooldown before the monitor clears ongoing occupancy
- slow desktop `thread/resume` attaches now happen in the background so the web server does not block initial rendering on them
- desktop-backed `thread/resume` can still take tens of seconds, so the observer keeps a wider 60-second attach budget before it marks that live path degraded and falls back to read-only behavior
- watched thread JSONL paths trigger quick re-reads when a local session changes
- reread desktop rollout threads only synthesize message notifications from the newest assistant text when the live subscription path is degraded or read-only
- streamed `item/agentMessage/delta` notifications stay enabled on the observer connection so Codex reply toasts can update immediately from the typed live feed
- non-final commentary messages on interrupted desktop turns are still treated as active work so subscribed agents do not briefly vacate their desk between commentary updates
- completed process-only items such as `reasoning` or `contextCompaction` now settle out of synthetic `thinking` once the turn is done, so finished desktop threads do not keep reading as active
- process-neutral live states such as `plan` items or in-progress turns without stronger item evidence now map to `planning`, reserving `thinking` for stronger reasoning/commentary/compaction signals
- Cursor local typed hooks now follow the same split where possible, so generic session/tool fallback stays `planning` until Cursor emits clearer reply/reasoning-style evidence
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
  - fleet mode only keeps autodiscovered workspaces whose session timestamps are no older than 7 days; config-only roots without recent sessions do not stay visible just because the workspace metadata is newer
  - fleet map renders as a continuous tower of workspace floors instead of a stack of separate cards
  - Git-linked worktrees merge onto one repo floor by default, with a global split toggle available when one floor per worktree is more useful
  - deep-linkable single-project room view through `?project=<abs-path>`
  - explicit CLI project roots stay pinned to those roots instead of being replaced by auto-discovered workspace lists
  - live SSE updates for browser clients
  - all discovered workspaces stay live-monitored at once
  - reserved multiplayer status surface for a future secured sync transport
  - browser settings can also attach the page to a shared PartyKit room using `host`, `room`, and an optional short `nickname`; once connected, each local floor exposes a persisted `Shared` toggle that controls whether that project is broadcast into the room
  - remote shared-room activity now merges client-side onto matching local workspaces when possible, and otherwise stays visible as remote-only floors with a 1-hour cooldown before disappearing after updates stop
- map and terminal-style views through `?view=map|terminal`
- live agents only on desks, plus the 4 most recent top-level lead sessions resting in the rec area
- local threads remain seated while the thread is still ongoing, even if they pause between visible events or the latest turn already looks done
- transient `status.type = notLoaded` unloads now wait about 3 seconds for a confirming reread before a local thread is allowed to lose ongoing occupancy
- once a top-level thread actually stops, it keeps its workstation for a short 5-second cooldown so the final reply remains readable before it cools into rec-area visibility
- stale local `notLoaded` sessions no longer occupy desks just because they are still recent; workstation seating now requires true ongoing work or the explicit stop cooldown
- after that grace window, only recent top-level lead sessions cool down into the rec area; finished subagents despawn instead of idling there
- lead sessions with active subagents now move into a compact stacked left-side boss-office column, with each boss workstation rendered inside its own small office shell
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
- selected-workspace and focused single-workspace rendering reuse the same compact scene prefab geometry as the tower overview; only whole-scene fit scaling changes between those views
- desk-pod origins and the workstation seat cells inside them are expected to stay tile-aligned, matching the same grid contract used by rec-strip furniture
- global browser settings currently expose text scale plus a persisted worktree split toggle; text scale still applies to hover/toast/map text without changing room or prefab geometry
- the retained browser map path now uses a persistent Pixi scene host plus HTML anchor overlays for toast positioning, so map updates can mutate scene entities without replacing the scene shell
- routed avatar movement in the Pixi scene now uses a lightweight grid pathfinder against room occupancy instead of direct straight-line scene tweens
- floor-depth sorting in the Pixi scene now uses explicit logical rows: moving agents sort from their current foot-tile row, while workstation shells and seated avatars sort from the workstation footprint row, so overlap follows the same "lower floor cell stays in front" rule during pass-bys
- rec-area idle behavior is scene-config-driven: seated flip cadence, provider-trip rarity, resting walk speed, held-item base size, and global held-item scale all come from `packages/web/src/config/scene-definitions.json`
- provider furniture definitions now also carry optional visual approach offsets so resting avatars can keep their 1x1 foot tile on the walkable row while still reaching close to the vending machine, cooler, or shelf sprite
- the current default rec-provider mapping is bookshelf -> `book`, cooler -> `water-bottle`, and vending -> a mixed snack/soda/juice pool

### Web package composition

The web package now separates transport, lifecycle, rendering, and client delivery concerns instead of keeping them in one oversized entry file.

### Core package composition

- `packages/core/src/adapters`
  Defines the shared `ProjectAdapter` and `ProjectSource` contracts plus the built-in source registry for Codex local/cloud, Claude, Cursor local/cloud, OpenClaw, and presence.
- `packages/core/src/snapshot-lib`
  Holds thread summarization and dashboard-building helpers so `snapshot.ts` stays a thin public surface instead of a cross-layer sink.
- `packages/core/src/live-monitor-lib`
  Holds app-server event normalization plus rollout-hook parsing so `ProjectLiveMonitor` keeps orchestration responsibility without also owning every parser.
- `packages/core/src/cursor-lib`
  Holds Cursor local discovery and shared repository normalization helpers so local workspace parsing, cloud API loading, and repo identity are separated.
- `packages/core/src/services`
  Holds cross-cutting orchestration such as project discovery re-exports, refresh scheduling, snapshot assembly, and the live-monitor compatibility surface.
- `packages/core/src/domain`
  Holds workload/currentness policy and other state rules shared across snapshot assembly and tests.
- `packages/core/src/utils`
  Holds small reusable JSON/text helpers extracted from the older source-specific modules.

Snapshot assembly now happens in one place through `SnapshotAssembler`, which merges cached adapter snapshots, applies room mapping once, and evaluates workload currentness against the snapshot start time so slow secondary adapters do not incorrectly evict freshly finished local work.

- `packages/web/src/server/server.ts`
  Starts the HTTP server, wires shutdown, and delegates everything else.
- `packages/web/src/server/server-options.ts`
  Parses CLI args and normalizes project descriptors.
- `packages/web/src/server/server-metadata.ts`
  Builds startup fleet placeholders and the shared `/api/server-meta` payload shape.
- `packages/web/src/server/fleet-live-service.ts`
  Owns `ProjectLiveMonitor` instances, refreshes the active project set, publishes fleet snapshots, exposes the live bound project list for `/api/server-meta`, exposes disabled multiplayer status for future secured sync work, and fans snapshots out over SSE. Fleet-wide cloud task polling still lives here so `codex cloud list` runs once per fleet refresh cycle instead of once per project monitor, with shared backoff when the upstream cloud surface rate-limits. Startup now publishes a placeholder fleet immediately and warms project monitors in the background.
- `packages/web/src/server/router.ts`
  Maps routes to handlers for HTML, static assets, project image previews, fleet/meta APIs, refresh, appearance cycling, and room scaffolding. In fleet mode, the meta route now reports the live project set from `FleetLiveService`, not just the startup seed options.
- `packages/web/src/render/render-html.ts`
  Builds the HTML shell and injects the browser assets.
- `packages/web/src/client/index.ts`
  Bundled browser entrypoint that loads the external client assets and starts the generated browser runtime module against server-injected bootstrap config.
- `packages/web/src/client/app-runtime.ts`
  Generated browser runtime module emitted at build time from the focused runtime section sources so the shipped client no longer relies on `new Function(...)` evaluation.
- `packages/web/src/client/runtime-source.ts`
  Thin browser runtime composition entry that still mirrors the focused runtime section order while the generated `app-runtime.ts` output is the actual shipped browser module.
- `packages/web/src/client/runtime`
  Holds focused runtime sections so browser behavior can be edited by concern instead of by patch order or by one giant client script.
  Current ownership is:
  - `settings-source.ts`: persisted scene settings, furniture overrides, and browser-side settings state bootstrap.
  - `layout-source.ts`: DOM wiring, fleet/workspace selection state, summary helpers, role grouping, and display-text normalization.
  - `seating-source.ts`: current-workload workstation policy, local grace windows, and rec-room eligibility.
  - `render-source.ts`: cubicle/workstation visual models, notification copy shaping, and display-path formatting.
  - `scene-source.ts`: room-to-scene model assembly, Pixi renderer lifecycle, and retained scene orchestration.
  - `navigation-source.ts`: navigation grid, avatar routing, scene hit-target focus, terminal/fleet summaries, and the durable "Needs You" queue.
  - `ui-source.ts`: browser render loop, DOM patching, fleet ingestion, and session-card rendering.
- `packages/web/src/client/multiplayer-source.ts`
  Holds the browser-side PartyKit room sync overlay, shared-room settings persistence, per-project share preferences, remote-only floor cooldown memory, and remote fleet merge helpers so the realtime room transport stays outside the main renderer script.
- `packages/party`
  Holds the deployable PartyKit room relay that validates and rebroadcasts the browser `fleet-sync` payloads over shared room sockets.
- `packages/web/src/client/toast-source.ts`
  Holds browser-side toast queueing, stacking, timing, preview, and DOM rendering so notification behavior does not stay embedded in the main renderer script.
- `packages/web/src/client/styles.css`
  Holds the browser CSS that now builds into `/client/app.css`.
- `packages/web/src/http-helpers.ts`
  Centralizes JSON/body helpers and static/project-file response handling.

This keeps the browser behavior broadly the same, but it stops HTML responses from embedding giant JS/CSS strings, removes brittle runtime string surgery, moves the shipped browser bootstrap onto a generated real module, and gives the repo clearer ownership seams for future client-runtime work.

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
  blocked standing-on-desk pose, raised-hand marker, approval-needed toast, and durable needs-you queue entry
- `waitingOnUserInput`
  waiting-on-desk pose, raised-hand marker, ask-user toast, and durable needs-you queue entry
- blocked failures without `needsUser`
  blocked standing-on-desk pose, exclamation marker only for explicit system or failed activity evidence, and failure toast treatment
- head markers now render smaller than the original 16px pass so they sit above the sprite more quietly and stay visually secondary to toasts
- the thinking light is intentionally transient and drops away once the first visible assistant message/toast is present, so speech evidence replaces the generic “still thinking” cue
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
- desk columns start around one-fifth of the room width, leaving room for a compact stacked boss-office column on the left when needed
- each workstation column now uses a single visible cubicle stack with 3 tightly stacked workstation rows so active desks stay inside a standard room height
- role grouping prefers to keep the same agent types inside the same visible workstation stack before spilling into a new column
- a single occupied two-seat pod stays anchored to a real seat cell instead of collapsing to a centered pseudo-seat
- the first occupied seat in a pod defaults to the left seat cell, and a second occupied seat expands into the right seat cell without shifting the first workstation
- newly occupied seats use a short retro blink reveal so the workstation appears before the worker settles
- avatars themselves no longer flash on enter or exit; only the workstation reveal animates, and removals disappear immediately once the thread leaves current workload
- left and right seats face opposite directions inside each pod
- seated agents flip with the workstation direction and align to the desk/chair reach point
- lead-session arrivals, subagent arrivals, and all departures use the center-top room entrance as the path anchor so workers visibly enter and leave through the doorway
- finished subagents now keep a longer readable desk cooldown before they walk back out through that doorway instead of vanishing immediately
- lead sessions with active subagents move into a dedicated left-side boss-office column; the column starts one floor tile below the floor start and uses contiguous 3-tile-tall office slots so four bosses can stack in a standard room while still reading as offices instead of rounded placeholder frames
- hovering a boss reveals arrow lines from that office to the related spawned subagents
- chairs and seated reach points sit slightly outward from the desk so the monitor relationship reads cleanly
- workstation computers currently use the single complete desk cut, avoiding the broken narrow pseudo-monitor asset
- waiting and resting agents move to an integrated wall-side rec strip instead of a detached room when they are actually off-desk
- current waiting sessions now stay on-desk, using the same workstation actor lane as other desk work instead of cooling into the rec strip
- rec-room seating should be keyed by stable agent identity and furniture-relative sofa slots, not recomputed purely from per-render sort order
- the browser view no longer exposes a current/history toggle; it always shows current agents plus 4 recent lead sessions
- rec facilities sit on the same raised upper floor band as the wall-side walkway, not in a floating inset
- the rec strip combines vending, counter, doors, clock, plants, sofa, and shelf props inside the same scene
- a selected workspace with no local or recent agents may temporarily reuse the 4 most recent resting lead sessions from other tracked workspaces as rec-room stand-ins, so a freshly opened floor is not completely empty before its first local thread appears
- long task titles stay in hover cards and the session panel instead of being drawn over the map
- the floor is restored to the blue office-strip language from the reference art, including an upper wall-side walkway for rec facilities
- layout constants are now expressed as internal tile-grid settings instead of only pixel literals, so boss-office footprints, desk columns, rec-strip depth, and inter-cubicle spacing all derive from a single floor grid
- global viewer settings are separate from internal scene settings; the first user-facing control is text scale, clamped from `0.75x` to `2.00x`, while prefab sizing and spacing stay internal
- the current browser renderer is Pixi-first for the office map, with HTML retained only for overlays, controls, and fallback terminal output
- browser placement rules are intentionally a little stickier than raw workload freshness, because a live local thread should not visually bounce desk -> rec -> desk during short polling gaps
- Codex-local desk seating now also treats app-server `status.type = "active"` as the decisive occupancy signal, so an active session does not drop into the rec strip just because its summarized state temporarily reads waiting or recently done
- actor behavior is now explicitly split from universal modes: desk-seated work (`planning`, `scanning`, `thinking`, `editing`, `running`, `validating`, `delegating`, `waiting`), desk-blocked-standing (`blocked`), resting/recent-finished (`done`, `idle`), and non-local/cloud (`cloud`)

## Secondary Claude support

Claude support uses a deliberately weaker contract than Codex:

- project discovery merges Codex-discovered roots with roots inferred from `~/.claude/projects`
- Codex fleet startup also seeds workspace discovery from configured roots in `~/.codex/config.toml`, so trusted Codex projects can appear before their first visible thread update
- when the Anthropic Agent SDK is available, Claude project discovery prefers `listSessions()` and per-session `cwd` metadata before falling back to raw directory scanning
- the snapshot builder can include recent Claude sessions for matching project roots
- recent Claude session messages can now be read through the supported Agent SDK `getSessionMessages()` API before falling back to raw JSONL transcript sampling
- transcript-only Claude session state is still inferred from recent tool uses such as read, edit, bash, and task delegation when no typed hook signal exists
- optional project-local hook sidecars in `.codex-agents/claude-hooks/<session-id>.jsonl` can be produced either by a Claude Code hook script or by the exported Agent SDK sidecar bridge, and they upgrade Claude sessions to typed permission, tool, subagent, and stop state
- Claude agents are rendered in the same room model, but with explicit provenance/confidence so transcript inference and hook-backed state do not pretend to have Codex-grade app-server coverage

This is useful because it broadens observability across the machine, but it should remain visually and architecturally secondary to the official Codex path.

## Secondary Cursor support

Cursor support now has two paths:

- a local typed adapter that reads Cursor hook sidecars under `.codex-agents/cursor-hooks/*.jsonl`, with the repo-shipped project hooks defined in `.cursor/hooks.json`
- the official cloud-agent API when `CURSOR_API_KEY` is configured or a saved app-level Cursor API key exists

The local typed adapter:

- consumes project-owned Cursor hook sidecars written from the official Cursor Hooks surface
- maps typed local prompt, tool, shell/MCP, file-edit, thought/response, compaction, and session lifecycle events into the shared workload model
- keeps those sessions visibly distinct from cloud polling with `confidence = typed`

The cloud typed adapter:

- matches agents to the selected project by normalized git `remote.origin.url`, `source.repository`, or PR-backed repository URLs when Cursor reports `source.prUrl` or `target.prUrl`
- polls the official agent conversation endpoint for active/recent Cursor agents so newly seen prompts and replies can flow into the shared toast/event model
- keeps typed prompt/input history distinct from assistant/output history so only Cursor replies render as visible agent speech or text toasts
- renders Cursor cloud agents in the same room and session model with `confidence = typed`
- surfaces typed status, summary, branch, repo, and target URL data

Cursor still does not provide Codex-style local live thread subscriptions here, and the documented webhook surface only covers terminal `ERROR` / `FINISHED` cloud-agent status changes, so Cursor visibility remains hook-and-poll based rather than app-server-grade live streaming.

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
