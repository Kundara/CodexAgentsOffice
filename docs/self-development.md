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

## Known weak spots

- Codex desktop session visibility may still be incomplete depending on app-server exposure.
- Claude support is still inference-based and only as strong as the local session logs.
- PixelOffice workstation composition still needs refinement and stricter prefab rules.
- Most Codex event types now reach the snapshot as explicit events, but many of them still share the same notification/motion treatment.
- Room empty states are still visually heavier than ideal.
- Live movement is still simpler than the intended office-life simulation.
- History view and current view share most layout logic; some visual tuning should diverge.

## Acceptance checks for future changes

- `npm run build`
- `npm run typecheck`
- browser render for current mode
- browser render for history mode
- browser render for explicit `web /abs/project/path` launch
- `demo preview` creates a disposable workspace, serves it, and removes it when the run ends
- verify workspace tabs show real Codex workspaces
- verify explicit project launch stays pinned to the requested project roots
- verify Claude-discovered projects do not displace explicit Codex project roots when the CLI pins roots
- verify no large task-title overlay is rendered inside the room scene
- verify active agents are visibly placed at workstations, not floating below them
- verify a single active agent does not spawn an empty mirrored workstation
- verify waiting/resting agents use the Rec Room instead of staying at desks
- verify approval, input-wait, file-change, command-run, and turn lifecycle states have clear visible notification paths
- verify the browser session panel exposes the durable approval/input "needs you" queue
- verify Claude-derived sessions are visibly marked as inferred in hover/session detail

## Near-term roadmap

- map more app-server `turn/*` and `item/*` events into explicit character motion
- make started/completed/interrupted/failed turn phases visually distinct beyond shared toast styling
- add direct approval/input action affordances from the browser queue back into Codex
- tighten the workstation prefab using only the intended PixelOffice station slices
- improve side-facing avatar placement and interaction poses
- add stronger state-specific animation for blocked, waiting, and validating work
- refine empty-room presentation
- improve SSE-driven movement so entry/exit paths feel intentional instead of abrupt

## Not the goal

- full transcript replay inside the room scene
- replacing the Codex thread UI
- using decorative pixel art that weakens status clarity
