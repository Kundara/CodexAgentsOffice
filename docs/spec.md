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
- `needsUser` is the durable per-agent approval/input state used by the browser `Needs You` queue and raised-hand desk marker.
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

Renderer actor states are derived from those universal modes:

- Desk-seated: `planning`, `scanning`, `thinking`, `editing`, `running`, `validating`, `delegating`, `waiting`
- Desk-blocked-standing: `blocked`
- Resting/recent-finished: `done`, `idle`
- Non-local/cloud: `cloud`

Per-mode actor handling:

- `planning` -> desk-seated, clipboard marker above the head
- `scanning` -> desk-seated
- `thinking` -> desk-seated, light marker above the head until the first visible assistant message/toast arrives
- `editing` -> desk-seated
- `running` -> desk-seated
- `validating` -> desk-seated
- `delegating` -> desk-seated
- `waiting` -> desk-seated; if `needsUser` is set, use the raised-hand marker above the head and keep the session in the durable `Needs You` queue
- `blocked` -> desk-blocked-standing; use the raised-hand marker for `needsUser` approval/input waits and the exclamation marker only for explicit system/tool/command/file failure blocks
- `done` -> resting/recent-finished with a short post-stop desk cooldown before cooling off
- `idle` -> resting/inactive off-desk state
- `cloud` -> non-local/cloud state

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
- a persisted `Split Worktrees` toggle that restores one floor per worktree instead of the default merged repo floor
- a debug tile overlay toggle for layout diagnostics
- machine-local Cursor API key save/clear controls
- shared-room sync toggle plus `host`, `room`, and short `nickname` fields
- a per-floor persisted `Shared` toggle for local projects while shared-room sync is enabled, defaulting to on and controlling whether that local project is broadcast into the room

### Workload placement

- Use current workload by default.
- Active local Codex work should occupy desks.
- A local Codex session should stay on a desk whenever app-server still reports `status.type = "active"`, even if its active flags currently mean waiting for approval or user input, or the latest visible item has already reached a recent `done` summary.
- Active local subagents should remain visible from that same runtime-active signal even if the transient `isCurrent` flag has already moved to a sibling update or the parent thread.
- Waiting sessions stay on-desk; only resting lead sessions belong in the rec area after the session is no longer active at the app-server/runtime level.
- A local thread that is still truly ongoing may keep its workstation through short-lived freshness/current signal dips between polls, and `notLoaded` locals now get a short 3-second confirmation cooldown before the monitor accepts that unload as real.
- Workstation release should be conservative. Ordinary poll jitter, UI rerenders, debug toggles, or temporary freshness gaps must not pull a still-working agent off a desk.
- A workstation should only be released when the thread has actually settled into a resting/finished state according to the browser placement rules, with the explicit post-stop cooldown described below.
- The rec area should keep at most the 4 most recent lead sessions visible;
  it may show fewer while one of those visible resting leads is back at work.
- If one of those visible resting leads becomes active again, older hidden leads should not pop back into the rec area just to fill that seat for a moment.
- Finished subagents should despawn instead of taking rec-area slots.
- Finished subagents should keep a visibly readable post-finish desk cooldown before exiting, and that cooldown should be longer than the top-level lead cooldown so child completion is easier to observe in-scene.
- Finished subagents should then walk out through the room door instead of blinking away.
- Empty rooms should read as quiet space, not as errors.

### Scene layout and tiles

- The office floor should use a tile grid as its primary layout system.
- Scene sprite metadata and room-interaction definitions should load from startup-read config files instead of being hard-coded inside the browser runtime strings.
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
- Floor-level depth sorting should use each sprite's ground-contact pivot rather than sprite top or center; for avatars this pivot is the feet.
- Depth ordering should resolve from logical floor rows first, not from ad hoc pixel ties.
- Moving agents should sort from their current foot-tile row while they walk.
- Seated avatars and workstation shell sprites should sort from the workstation footprint row they occupy.
- Lower on-screen foot/base position must sort in front of higher on-screen foot/base position.
- Agents, chairs, desks, workstations, and other floor props that can visually overlap should follow that same foot/base sorting rule so overlap reads spatially correct.
- If an agent's feet are still above a workstation or desk base on screen, the workstation/desk must render in front of that agent; once the agent's feet move below that base, the agent must render in front.
- Depth sorting must update continuously during routed movement and idle motion, not only when an agent first spawns or is assigned to a seat.
- Agent movement in the retained browser scene should follow walkable tile paths instead of straight-line tween resets.
- Tile pathfinding should avoid occupied cells from furniture, workstation footprints, and already-seated agents.
- Visual-only updates such as debug overlays, text-scale changes, or scene host rerenders must not be treated as a new placement instruction.
- A newly visible active agent should enter from the room door and walk to its assigned workstation.
- That same door-entry behavior applies to subagents, not just top-level leads.
- If a resting lead becomes active again, it should leave its rec-area seat and walk to its newly assigned workstation instead of despawning and respawning.
- When an agent truly leaves the visible scene, it should walk back out through the room door.
- Each room door should render as a two-part sliding door with a dark recess behind it.
- The door should slide open while an agent enters or exits through that room and then close again after a short hold-open delay.

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
- Git-linked worktrees should merge onto a shared repo floor by default when they belong to the same underlying repository identity.
- The browser should expose a global `Split Worktrees` toggle that restores the current one-floor-per-worktree presentation without changing the monitored workspace set.
- When worktrees are split into separate floors, a worktree floor title should use the worktree name with a distinct bright-blue worktree badge/icon treatment.
- Fleet startup should include configured Codex workspaces from `~/.codex/config.toml` when available, not only workspaces that already emitted recent local thread activity.
- Fleet mode should hide autodiscovered workspaces once their last session timestamp is more than 7 days old.
- The selected workspace changes browser focus only; it does not change the monitor set.
- `/api/server-meta` must report the live bound fleet project set, not only startup seed projects.

Worktree identity rules:

- Shared repo/worktree grouping should work across Codex, Claude, and Cursor-backed snapshots; it must not rely on one source family alone.
- Shared worktree grouping should prefer actual Git common-dir identity when available, then fall back to other stable repo identity fields only when necessary.
- Agent hover cards should expose the source worktree name with the same worktree icon so duplicate repo clones remain distinguishable even when the tower floor is merged.
- Agent labels, hover titles, and session-card titles should normalize repo-local paths into readable relative labels and must not surface raw WSL mount paths like `/mnt/f/...` as the primary visible title.
- Agent-facing labels in the scene and session list should normalize repo-local paths so raw `/mnt/...` WSL paths do not appear as the primary visible title.

### Shared-room behavior

- Shared-room sync is an optional browser-side overlay, not the primary local transport.
- Shared-room settings are persisted client-side and should survive browser reloads.
- Local project share preferences should be persisted client-side per project root and default to sharing until the user turns a floor off.
- The browser should broadcast only the local project roots whose `Shared` floor toggle is still on.
- Remote workspace activity should merge into locally matching workspaces when names match, but remote-only room workspaces should also remain visible as standalone floors when they do not exist locally.
- Remote-only floors should grey the project-title treatment slightly so “not my workspace” reads as a distinct state without hiding the floor.
- Each floor header should list the active participant nicknames currently visible in that workspace; when a remote-only floor is cooling down and has no active agents left, it may fall back to the most recent participant labels.
- Remote shared-room agents should preserve peer labeling and peer-host context so they remain visibly distinct from local sessions.
- Remote-only shared projects should cool down for 1 hour before disappearing after room updates stop.
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
- Facility-provider placement is also furniture-relative. If a provider furniture item moves, agents must walk to that furniture item's current live service point instead of an old default tile.
- Rec-room seat stability matters more than strict most-recent sorting once an agent is already visibly seated; ordinary updates should not create a visible shuffle party.

### Idle rec-area behavior

- Resting lead avatars in the rec area should occasionally mirror their facing direction while seated.
- Idle seated flips should happen on a randomized interval between 4 and 20 seconds.
- Resting lead avatars may autonomously stand up, walk to a rec-area facility provider, collect one serviced item, and return to their sofa seat with that item held in-hand.
- Resting lead avatars should visit providers relatively rarely instead of pacing constantly; the current default trip interval is a randomized 30 to 90 seconds.
- Resting lead autonomous walks should read as leisurely movement, at about 60% of the regular avatar travel speed.
- After returning to the sofa, the held item should follow the avatar hand position until its per-item hold duration expires.
- The first implementation uses a default hold duration of 15 seconds per item, while still allowing duration overrides per serviced item in configuration.
- If a resting lead stops being idle/done and becomes active again before the hold duration ends, the held item should be discarded immediately with a small jump-plus-fade animation and must stop following the avatar.

### Facility providers and held items

- Rec-area furniture should be expandable through a provider definition model instead of one-off hard-coded logic per furniture sprite.
- A facility provider definition should live on the furniture item itself and contain:
  - a randomizable list of serviced item ids
  - a live service tile definition derived from the placed furniture position
  - an optional visual approach offset so the avatar can keep its 1x1 foot collider on the walkable tile while reaching closer to the furniture sprite
- A held-item definition should live in startup-loaded scene config and contain:
  - the sprite key to render
  - the default hold duration
  - the hand offset for where it should follow the avatar sprite
- Held-item rendering should treat source sprites as base 16px pixel art by default, then apply one global held-item scale from scene config so all carried items can be made smaller together without editing each item entry.
- Initial provider/item mappings:
  - bookshelf provides `book`
  - water machine / cooler provides `water-bottle`
  - snack machine / vending provides a randomizable pool including `snack` plus soda and juice variants
- The runtime should make it easy to add new providers and new serviced items without editing the core routing logic.

## State and workload rules

- `waitingOnApproval` maps to `blocked`.
- `waitingOnUserInput` maps to `waiting`.
- failed command or turn state maps to `blocked`.
- in-progress turns map to active desk work unless a more specific state exists.
- `plan` items and in-progress turns without stronger evidence map to `planning`.
- `thinking` is reserved for stronger signals such as live reasoning, commentary, or context compaction.
- Secondary adapters should follow the same rule where possible: generic active-but-unspecified state should prefer `planning`, while `thinking` should imply visible reply/reasoning/compaction evidence.
- recent completed replies map to `done`.
- old inactive threads map to `idle`.
- `needsUser` waits keep a raised-hand marker above the actor's head; blocked errors without `needsUser` use the exclamation marker only when the block is backed by explicit system or failed activity evidence.
- `thinking` uses the light marker above the actor's head only before the first visible assistant message/toast arrives.
- `planning` uses the clipboard marker above the actor's head.
- head markers render at a reduced small-icon size so they stay readable without overpowering the sprite or toast layers
- when the exclamation marker is shown, the hover summary should prefer the current error detail over stale latest-message text
- blocked failure hover summaries should render that error text in red so it reads as the reason for the `!`, not as ordinary chat

Current-workload rules:

- local threads stay current while the live monitor still considers them ongoing
- `notLoaded` threads still stay current when `thread/read` shows an in-progress turn
- observer-owned unload/runtime-idle transitions do not count as an immediate stop by themselves; `thread/status/changed -> notLoaded` now waits about 3 seconds and a reread confirmation before the monitor drops the thread out of ongoing work
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
