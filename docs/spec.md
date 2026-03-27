# Product Spec

## Purpose

Codex Agents Office is a workspace-level observability layer for Codex sessions.

It is not a chat replay UI. It is a live workload view that answers:

- which workspaces are active now
- which parent sessions are leading work
- which subagents are active, waiting, blocked, or done
- which room or project area that work maps to

## Product surfaces

### Browser

The browser office is the primary surface.

It should show:

- current desk occupancy for live work
- the 4 most recent lead sessions resting in the rec area
- hover cards and session panels for longer detail
- a durable cross-project `Needs You` queue when approvals or inputs are pending
- subtle in-scene motion and placement cues rather than a detached dashboard

The browser map should be treated as a retained 2D scene, not a stream of HTML snapshots.
Live data should update scene entities in place instead of rebuilding the office subtree by `innerHTML`.

### Terminal

The terminal surface is the fast inspection mode.

It should group sessions by room and show:

- state
- recent useful action
- active paths
- provenance/confidence
- resume commands when available

### VS Code

The VS Code panel should expose the same snapshot model as the browser and terminal views instead of inventing a separate state system.

## Shared model

All renderers should consume the same normalized snapshot model.

- A `DashboardSnapshot` represents one tracked workspace and includes `projectRoot`, `projectLabel`, `projectIdentity`, `generatedAt`, `rooms`, `agents`, `cloudTasks`, `events`, and `notes`.
- A `DashboardAgent` represents one visible session or agent and carries identity, currentness, room placement, state, detail text, latest useful message, resume/open affordances, provenance/confidence, and optional `needsUser` or shared-room `network` metadata.
- A `DashboardEvent` is the normalized event log used for browser notifications and event-native state surfaces such as approvals, input waits, command/file activity, subagent events, and typed messages.
- `needsUser` is the durable per-agent approval/input state used by the browser `Needs You` queue and waiting posture.
- `network` marks a remote shared-room agent and should preserve peer label and peer host metadata distinctly from local sessions.

Normalized activity states are:

- `planning`
- `scanning`
- `thinking`
- `editing`
- `running`
- `validating`
- `delegating`
- `waiting`
- `blocked`
- `done`
- `idle`
- `cloud`

Normalized provenance/confidence rules are:

- `provenance` identifies the source family such as `codex`, `claude`, `cloud`, `cursor`, `presence`, or `openclaw`
- `confidence` distinguishes typed source truth from inferred best-effort state

## Source priority

Prefer official Codex surfaces first:

- `codex app-server`
- `codex cloud list --json`
- `.codex-agents/rooms.xml`
- `.codex-agents/agents.json`

Claude local logs and Cursor background agents are secondary inputs. They can enrich visibility, but they should not blur the distinction between typed Codex truth and inferred state.

## Browser behavior

### Modes and controls

- The browser should support both `map` and `terminal` views.
- `?view=map|terminal` should deep-link the active browser view.
- Selecting a workspace changes focus only; it does not change fleet monitoring scope.
- A selected workspace can enter a focused single-workspace mode through the browser control and `?focus=1`.
- Selected and focused single-workspace map views should reuse the same compact scene geometry as the tower overview; focus may change whole-scene fit scaling and browser chrome, but it must not swap in a different avatar, workstation, or pod scale.
- `?screenshot=1` should disable live SSE-only behavior that would make still captures unstable and should report snapshot connection state instead of live streaming.
- The browser header Settings popup is the home for viewer controls and machine-local integration settings.

Current browser settings surfaces are:

- text scale
- a debug tile overlay toggle for layout diagnostics
- machine-local Cursor API key save/clear controls
- shared-room sync toggle plus `host`, `room`, and short `nickname` fields

### Workload placement

- Use current workload by default.
- Active local Codex work should occupy desks.
- A local Codex session should stay on a desk whenever app-server still reports `status.type = "active"`, even if its active flags currently mean waiting for approval or user input, or the latest visible item has already reached a recent `done` summary.
- Waiting/resting lead sessions belong in the rec area only after the session is no longer active at the app-server/runtime level.
- A local thread that is still truly ongoing may keep its workstation through short-lived freshness/current signal dips between polls, but stale `notLoaded` locals must not hold desks just because they were recently current.
- Workstation release should be conservative. Ordinary poll jitter, UI rerenders, debug toggles, or temporary freshness gaps must not pull a still-working agent off a desk.
- A workstation should only be released when the thread has actually settled into a resting/finished state according to the browser placement rules, with the explicit post-stop cooldown described below.
- The rec area should keep at most the 4 most recent lead sessions visible;
  it may show fewer while one of those visible resting leads is back at work.
- If one of those visible resting leads becomes active again, older hidden leads should not pop back into the rec area just to fill that seat for a moment.
- Finished subagents should despawn instead of taking rec-area slots.
- Empty rooms should read as quiet space, not as errors.

### Scene layout and tiles

- The office floor should use a tile grid as its primary layout system.
- Rooms from `.codex-agents/rooms.xml` define the outer floor bounds; internal furniture/layout is then placed on a tile grid inside those room bounds.
- The grid starts at the end of the wall band and continues through the whole visible floor area to the bottom of the room.
- The renderer may scale tiles to fit available width, but object placement should stay grid-derived rather than free-floating.
- Whole-scene fit scaling may vary by container, but prefab geometry should stay consistent across tower, selected-workspace, and focused single-workspace rendering.
- Desk pods, workstation furniture, and their seat cells should resolve from tile columns/rows and tile spans, not ad hoc pixel offsets inside the room.
- Some prefabs can span multiple tiles; the layout contract is based on tile spans, not only `1x1` occupancy.
- The tile system should preserve stable desk slots so agents do not repack across the room on routine live updates.
- Existing seated agents keep their assigned desk slot unless occupancy truly changes enough to force a new allocation.
- New active agents should take the next available desk slot; they must not steal an already-occupied stable slot from another live agent during an ordinary update.
- Resting agents in the rec area should keep stable sofa/wall-side seats by agent identity instead of being reassigned purely by sorted array index.
- Z-order should be explicit and deterministic so floor bands, furniture, agents, effects, and toasts stack consistently.
- Agent movement in the retained browser scene should follow walkable tile paths instead of straight-line tween resets.
- Tile pathfinding should avoid occupied cells from furniture, workstation footprints, and already-seated agents.
- Visual-only updates such as debug overlays, text-scale changes, or scene host rerenders must not be treated as a new placement instruction.
- A newly visible active agent should enter from the room door and walk to its assigned workstation.
- If a resting lead becomes active again, it should leave its rec-area seat and walk to its newly assigned workstation instead of despawning and respawning.
- When an agent truly leaves the visible scene, it should walk back out through the room door.

### Scene settings model

- Scene settings are split into internal settings and global user settings.
- Internal settings define prefab and layout behavior that should not be user-configurable yet.
- Global settings define viewer-facing controls that should apply consistently across the browser office.

Internal settings should include at least:

- base tile size
- compact tile size
- boss office footprint
- boss office top inset
- desk pod size
- desk pod capacity
- desk-area start ratio
- wall-depth / top-band depth
- space between related-work cubicle groups
- space between desk columns
- rec-area top row and walkway row
- maximum rec-area depth from the top of the grid

Current internal tile rule:

- base tile size is fixed at `16px`
- compact tile size is also fixed at `16px`
- the browser may scale the whole scene for fit, but grid math and prefab footprints are defined in `16px` tiles

Global user settings should currently include:

- text scale for toasts, hover cards, and browser-office text

Diagnostic browser controls may also exist for development visibility, such as a debug tile overlay toggle, but they should not redefine the stable layout contract.

Global text scale rules:

- allowed range is `0.75x` through `2.00x`
- default is `1.00x`
- it should scale browser map text, toast text, and tooltip/hover text together
- it should not change internal prefab geometry or room assignment rules

### Fleet behavior

- Default browser deploys should run in fleet mode.
- Fleet mode should keep every discovered workspace live.
- Fleet startup should include configured Codex workspaces from `~/.codex/config.toml` when available, not only workspaces that already emitted recent local thread activity.
- Fleet mode should hide autodiscovered workspaces once their last session timestamp is more than 7 days old.
- The selected workspace changes browser focus only; it does not change the monitor set.
- `/api/server-meta` must report the live bound fleet project set, not only startup seed projects.

### Shared-room behavior

- Shared-room sync is an optional browser-side overlay, not the primary local transport.
- Shared-room settings are persisted client-side and should survive browser reloads.
- Remote workspace activity should only merge into local rendering when the remote workspace name matches a workspace that exists locally.
- Remote shared-room agents should preserve peer labeling and peer-host context so they remain visibly distinct from local sessions.
- Screenshot mode should disable shared-room sync.
- `/api/multiplayer` should expose the current server multiplayer transport status even when the transport is currently disabled.

### Boss / lead behavior

- Lead sessions with active subagents should move into a dedicated left-side boss-office column.
- Each boss slot in that column should render as a compact office shell with the boss workstation placed inside the office footprint.
- The boss-office column should start one floor tile below the floor start and continue contiguously to the bottom of the room.
- In the standard room height, the default internal boss-office layout should fit four stacked bosses by using contiguous 3-tile-tall office slots with no vertical gap.
- The boss-office column must stay compact enough for several bosses to stack vertically on the left side of the room without consuming the main desk floor.
- Boss-to-subagent relationships may be shown on hover, but they should stay secondary to desk occupancy and scene motion.
- Boss-to-subagent relationship arrows should only appear when the user is hovering or focusing that boss in the scene; hovering a child, a generic desk agent, or a session card should not reveal them.
- Relationship arrows should render above offices and avatars inside the map scene, but still remain behind toasts, hover cards, and other browser chrome.
- Relationship arrows should use smooth spline-like curves with explicit arrowheads aligned to the curve's end direction so the target is unambiguous.
- Boss office footprint should come from internal tile settings rather than per-renderer pixel literals.
- If the selected workspace is otherwise empty, the rec area may temporarily show up to the 4 most recent resting lead sessions from other tracked workspaces until local workspace activity exists.

### Desk spacing and grouping

- A desk pod is the basic active-work prefab and should keep a stable tile footprint.
- Desk pod origins should snap to the same tile grid used by rec-area furniture instead of starting from free-floating pixel math.
- Related work should stay visually grouped by cubicle/workstation group before spilling into a new column.
- Space between related-work cubicle groups should stay tighter than space between major desk columns.
- The current internal defaults are:
  `space between cubicle groups = 1 tile`
  `space between columns = 4 tiles`
- A single occupied two-seat pod should keep the live workstation anchored to a real seat cell on the grid instead of recentring within the whole pod footprint.
- The two seat cells inside a pod should be tile-aligned halves of that pod footprint so the workstation and avatar read as part of the same pixel grid as the surrounding room furniture.
- By default, the first occupied seat in a two-seat pod should use the left seat cell, and a newly added second seat should grow in the right seat cell.
- Within a two-seat pod, left/right seat choice should remain stable for an already-seated agent whenever possible, including across ordinary rerenders and refreshes.

### Rec-area placement

- The rec strip belongs on the upper floor band, not as a detached inset room.
- Rec-area furniture should start on the first row of the tile grid.
- Rec-area furniture should not extend deeper than 2 tiles from the start of the floor grid.
- Waiting and resting agents can occupy the walkway / wall-side slots beneath that first furniture row.
- The rec strip should use the same PixelOffice object language as the work floor: vending, shelf, sofa, counter, plants, doors, and wall props.
- Sofa placement is furniture-relative. If the sofa moves, the derived idle/rest seats move with it.
- Rec-room seat stability matters more than strict most-recent sorting once an agent is already visibly seated; ordinary updates should not create a visible shuffle party.

## State and workload rules

- `waitingOnApproval` maps to `blocked`.
- `waitingOnUserInput` maps to `waiting`.
- failed command or turn state maps to `blocked`.
- in-progress turns map to active desk work unless a more specific state exists.
- recent completed replies map to `done`.
- old inactive threads map to `idle`.

Current-workload rules:

- local threads stay current while the live monitor still considers them ongoing
- `notLoaded` threads still stay current when `thread/read` shows an in-progress turn
- observer-owned unload/runtime-idle transitions do not count as a stop by themselves
- once a local top-level thread actually stops, it should keep its workstation for about 5 seconds so the last reply can still be read before cooling into rec-area idle visibility
- stale local `notLoaded` threads that are no longer ongoing must not keep a workstation just because freshness/currentness still marks them recent
- completed process-only items such as `plan`, `reasoning`, and `contextCompaction` should settle to `done` while recent, then age to `idle`; they must not leave a finished thread stuck in synthetic `thinking`
- stale blocked/waiting history should not remain current forever without ongoing state or a current user need
- browser workstation seating may be intentionally stickier than raw `isCurrent` only for truly ongoing live local work and the explicit stop cooldown, not for stale `notLoaded` summaries

## Notifications and toasts

- File changes, commands, approvals, input waits, turn lifecycle events, and useful reply text should surface as toasts.
- Command-window toasts should aggregate per agent instead of stacking duplicates.
- Keep one command toast per agent, append new command lines at the bottom, and cap it at 3 visible lines.
- Read-like shell actions such as `sed`, `cat`, `rg`, `ls`, `find`, and `tree` should collapse into short summary toasts instead of echoing raw commands.
- Final reply text should not disappear just because command/read toasts also happened on the same thread.
- Agent-anchored toasts should track the agent root while the agent is moving, instead of staying frozen at the original spawn point.

## Visual expectations

- The office map should communicate state mostly through motion, placement, hover cards, and the session panel.
- Entering, leaving, and seat-change movement should read as short routed walks across the floor, not teleports between idle and desk states.
- Ordinary polling or view refresh must not look like movement. If a destination did not meaningfully change, the agent should keep its current placement.
- Avoid large task-title overlays inside the room scene.
- Keep Codex-native typed state visually distinct from inferred Claude state when provenance matters.
- Avoid avatar flash-in/flash-out effects for workstation occupancy.
- Exits should disappear cleanly without a lingering blink.
- PixelOffice art should be assembled intentionally from the asset sheet, not from a pasted example scene.
- Tile translation should preserve the feel of the existing PixelOffice scene language even when exact pixel-for-pixel placement is relaxed.
- Temporary placeholder geometry is acceptable during development, but not as the final renderer language.

## Runtime expectations

- Treat the listener on `4181` as explicit runtime state.
- Do not assume the browser matches the latest source tree until the server has been rebuilt and restarted.
- `api/server-meta` is the source of truth for PID, start time, build time, fleet mode, and live bound projects.
- `api/fleet` is the source of truth for the current normalized fleet snapshot.
- `api/events` is the live SSE stream for browser fleet refreshes.
- `api/settings/integrations` is the machine-local browser integration settings surface, currently used for Cursor API key storage.
- `api/multiplayer` reports the current multiplayer transport status, even when that status is disabled or placeholder-only.
- In fleet mode, cloud polling should run once centrally and be shared across monitors.
- Rate limits from the cloud surface should degrade into a human-readable note plus backoff, not repeated raw per-project failure spam.

## Internal doc map

- [architecture.md](./architecture.md)
  System design and module ownership.
- [integration-hooks.md](./integration-hooks.md)
  Exact upstream surfaces and how they map into the product.
- [self-development.md](./self-development.md)
  Improvement priorities.
- [references.md](./references.md)
  External sources.
