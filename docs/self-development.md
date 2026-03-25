# Self Development

## Product bar

This project should answer one glance-level question well:

`What is Codex working on right now?`

A good iteration improves at least one of these:

- accuracy of current workload detection
- clarity of session-to-room mapping
- readability of the office scene
- confidence that web, CLI, and VS Code reflect the same state model

## Current design principles

- Current workload first, history second.
- Workspace tabs should mirror Codex workspaces, not arbitrary local folders.
- Parent sessions are the primary actors.
- Subagents should visually attach to their parent session and role cluster.
- Room visuals should stay legible without text banners pasted over the scene.
- High-level transparency should stay inside the office scene when possible, using motion, placement, hover cards, and session detail instead of detached dashboard slabs.
- Decorative art must not obscure agent state.

## Current technical priorities

1. Improve real session discovery before inventing synthetic presence.
2. Keep the shared snapshot model authoritative across all front ends.
3. Increase event-level transparency so visible state is traceable to real Codex signals.
4. Make the workstation prefab visually coherent and consistent.
5. Preserve enough structure in the scene that busy workspaces still scan quickly.
6. Move the browser map toward a retained 2D scene renderer instead of HTML subtree replacement.

## Known weak spots

- Codex desktop session visibility may still be incomplete depending on app-server exposure.
- Claude support still falls back to transcript inference when no project-local hook sidecars are configured.
- OpenClaw support is currently workspace-path exact-match only, so broader OpenClaw workspaces do not yet project into per-repo office floors.
- Cursor support currently covers official background agents only; it does not yet discover local Cursor sessions or Cursor-only workspaces by itself.
- PixelOffice workstation composition still needs refinement and stricter prefab rules.
- Most Codex event types now reach the snapshot as explicit events, but many of them still share the same notification/motion treatment.
- Room empty states are still visually heavier than ideal.
- Live movement is still simpler than the intended office-life simulation.
- Map and terminal browser views still share some presentation assumptions that should diverge further.
- The office map now renders through a retained Pixi scene; remaining work is about refining prefab composition, motion, and editor parity rather than migrating off the old HTML map path.

## Acceptance checks for future changes

- `npm run build`
- `npm run typecheck`
- browser render for default map mode
- browser render for terminal mode
- verify default `web --port 4181` launch stays in fleet mode and does not pin to the current cwd
- browser render for explicit `web /abs/project/path` launch
- `demo preview` creates a disposable workspace, serves it, and removes it when the run ends
- verify workspace tabs show real Codex workspaces
- verify explicit project launch stays pinned to the requested project roots
- verify Claude-discovered projects do not displace explicit Codex project roots when the CLI pins roots
- verify no large task-title overlay is rendered inside the room scene
- verify active agents are visibly placed at workstations, not floating below them
- verify a single active agent does not spawn an empty mirrored workstation
- verify waiting/resting agents use the Rec Room instead of staying at desks
- verify desk layout remains grid-derived and stable across live updates instead of repacking on ordinary state changes
- verify a newly active agent takes a free desk instead of stealing an already-occupied stable seat from another live agent
- verify resting/rec agents do not reshuffle seats on ordinary live updates
- verify visual-only updates such as debug overlays do not trigger desk/recside movement
- verify rec-strip furniture starts on the first floor-grid row and does not exceed 2 tiles of depth from the top band
- verify global text scale changes hover/toast/map text without changing room geometry or desk assignment
- verify approval, input-wait, file-change, command-run, and turn lifecycle states have clear visible notification paths
- verify the browser session panel exposes the durable approval/input "needs you" queue
- verify Claude-derived sessions are visibly marked as inferred in hover/session detail
- verify Claude hook-backed sessions are visibly marked as typed rather than inferred when `.codex-agents/claude-hooks/<session-id>.jsonl` exists
- verify OpenClaw gateway sessions appear only for projects whose normalized root matches the configured OpenClaw agent workspace
- verify OpenClaw sessions preserve parent-child structure through the shared `parentThreadId` hierarchy
- verify Cursor background agents appear only for repos whose normalized `remote.origin.url` matches the selected project
- verify Cursor API-backed sessions are visibly marked as typed rather than inferred in hover/session detail

## Near-term roadmap

- map more app-server `turn/*` and `item/*` events into explicit character motion
- make started/completed/interrupted/failed turn phases visually distinct beyond shared toast styling
- add direct approval/input action affordances from the browser queue back into Codex
- decide whether Cursor local CLI/history is strong enough for an official local-session adapter
- decide whether OpenClaw needs broader workspace containment rules beyond exact workspace-root equality
- tighten the workstation prefab using only the intended PixelOffice station slices
- improve side-facing avatar placement and interaction poses
- add stronger state-specific animation for blocked, waiting, and validating work
- refine empty-room presentation
- improve SSE-driven movement so entry/exit paths feel intentional instead of abrupt
- harden seat ownership and rec-seat stability so ordinary polling never creates a visible shuffle party
- verify live toast styling remains readable when browser zoom is reduced
- keep command-window aggregation readable when several commands arrive quickly for the same agent
- keep the retained Pixi scene stable across scene refreshes with predictable entity ids, z-order, and incremental updates
- keep user-facing scene controls minimal and global, starting with text scale, while prefab sizing and spacing remain internal until furniture editing exists
- finish translating the previous office look into the tile system so the retained scene feels like the established PixelOffice floor instead of temporary placeholder geometry

## Not the goal

- full transcript replay inside the room scene
- replacing the Codex thread UI
- using decorative pixel art that weakens status clarity
