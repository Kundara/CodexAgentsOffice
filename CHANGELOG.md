# Changelog

All notable changes to this project should be recorded in this file.

This changelog is maintained against the current root `package.json` version.
Entries stay under the active version until an explicit version bump is requested.

## [0.1.0] - 2026-03-25

### Added

- Added a shared adapter contract in `packages/core` with a static built-in registry for Codex local/cloud, Claude, Cursor local/cloud, OpenClaw, and presence sources.
- Added a shared snapshot assembler plus refresh-scheduler/domain helper layers so snapshot assembly, room mapping, and workload-currentness policy are no longer spread across several source-specific call sites.
- Added a bundled external browser client build under `packages/web/dist/client`, replacing inline HTML delivery of the main browser JS/CSS payloads.
- Added repo rail guards for file-size limits and import-boundary checks, plus adapter-registry and bundled-client asset tests.
- Added a server-backed Cursor API key field in the web Settings popup, persisting a machine-local key outside the repo so Cursor background-agent visibility can be enabled once without relaunch-time env wiring.
- Added inferred local Cursor session support by reading Cursor workspace storage and recent logs, so repos opened in the local Cursor app now surface read-only local Cursor activity alongside cloud agents.
- Added a neutral multiplayer status interface in the web server so a secured sync transport can plug in later without another contract change.
- Added browser-side PartyKit shared-room settings with persisted `host`, `room`, and short `nickname` inputs, publishing all tracked workspace activity into the room and labeling remote agents with that nickname when available.
- Added a bundled PartyKit relay package in `packages/party` plus root `party:dev` and `party:deploy` scripts so the shared-room transport can be hosted from this repo.
- Added a persisted shared-room on/off toggle so users can stop syncing without clearing the saved PartyKit host and room.
- Added this changelog and a repo-level maintenance policy for tracking notable additions, fixes, and behavior changes.
- Added a grid-first scene layout foundation in the web renderer with explicit tile-based scene configuration and scene grid helpers aligned to the `16px` PixelOffice unit.
- Added persisted browser scene settings and local furniture layout overrides, including a user-facing text-scale control for the office view.
- Added Windows Codex command fallback support by extracting the Microsoft Store app bundle into a local cache, with WSL path conversion support for mixed Windows/WSL setups.
- Added an opt-in OpenClaw integration that reads official Gateway session and config surfaces, discovers recent OpenClaw workspaces, and maps matching OpenClaw sessions into the shared office snapshot model.
- Added a Claude Agent SDK bridge in `packages/core` that can write typed Claude hook sidecars into `.codex-agents/claude-hooks/<session-id>.jsonl` for stronger session and tool correlation.
- Added committed project-level Cursor hooks in `.cursor/hooks.json` plus a repo hook recorder script that writes typed local Cursor sidecars into `.codex-agents/cursor-hooks/<conversation-id>.jsonl`.
- Added a root `npm start` bootstrap flow that installs if needed, rebuilds the workspace, and launches the web server on `4181`.

### Changed

- Reworked the core internals so dashboard snapshot assembly now lives in `snapshot-lib`, app-server event and rollout-hook parsing live in `live-monitor-lib`, and Cursor local/cloud helpers live in `cursor-lib` instead of staying stacked inside `snapshot.ts`, `live-monitor.ts`, and `cursor.ts`.
- Changed the browser runtime composition so `packages/web/src/client/runtime-source.ts` now only joins the final runtime sections; layout, scene, navigation, render, settings, and UI behavior are edited directly in their own section modules instead of being rewritten through string patch helpers.
- Changed file-size and import-boundary guards to walk source files with Node filesystem helpers instead of shelling out to `rg`, so the repo rails keep working in restricted environments.
- Changed Codex app-server event handling so `turn/plan/updated` now summarizes the documented `{ explanation?, plan }` payload, `turn/diff/updated` summarizes the documented `{ diff }` payload, and `item/tool/call` is labeled as a generic tool-call request instead of an MCP-specific event.
- Changed fleet startup discovery so Codex workspaces configured in `~/.codex/config.toml` now seed the live project set even before any thread has been spawned in this browser session, and fleet refresh now asks for a broad enough discovery window to keep the full configured/discovered workspace list visible.
- Changed fleet-mode workspace visibility so autodiscovered projects now age out after 7 days without session activity, and config-only Codex roots no longer stay visible unless a session-backed source also reports recent activity for that workspace.
- Changed `buildDashboardSnapshotFromState()` to assemble source snapshots in parallel and evaluate workload currentness against snapshot start time, fixing the stale-freshness race for recently finished local threads.
- Changed project discovery to consult the shared adapter registry instead of hardcoding every secondary source in one discovery function.
- Changed the web server structure to use `server/`, `render/`, and `client/` internal folders while keeping the public routes and `startWebServer` surface stable.
- Changed Cursor API key resolution so saved app settings now backfill `CURSOR_API_KEY` for Cursor background-agent loading across snapshot and watch flows, while the process environment still takes precedence.
- Changed Cursor documentation and settings copy to distinguish automatic local Cursor visibility from optional API-key-backed Cursor cloud/background agents.
- Changed local Cursor session loading so project hook sidecars in `.codex-agents/cursor-hooks` are now the only local Cursor source; transcript and workspace-state inference no longer drive the office view.
- Expanded the shared snapshot shape with git-backed project identity metadata and generic remote-agent provenance so a future secured multiplayer sync path can reuse the existing model.
- Reworked the office renderer around internal scene settings, grid-based placement, and reusable scene render state instead of looser ad hoc layout math.
- Expanded Cursor integration to treat agents as cloud work, support paginated agent fetches, and normalize repository identity across direct repo URLs and PR or merge-request URLs.
- Updated the main docs to describe the new grid-first renderer direction, minimal viewer controls, and the Windows Codex runtime fallback path.
- Reframed the README around the current `Agents Office Tower` product name with a shorter multi-source support matrix instead of a mostly Codex-centric landing page.
- Moved scene controls into a toggleable settings popup in the web header, removing the manual refresh and rooms scaffold actions from the main toolbar and hiding the toast preview trigger.
- Changed the scene text-size slider to apply on release instead of during drag so the settings popup stays stable while adjusting scale.
- Extracted browser toast queueing, stacking, preview, and DOM rendering from the main client script into a dedicated `toast-script` module.
- Extracted PartyKit shared-room transport, settings persistence, and remote fleet merge helpers from the main client script into a dedicated `multiplayer-script` module.
- Removed the unused DOM office-map renderer path from the web client so the browser map now runs through the retained Pixi scene only.
- Changed Claude secondary discovery to prefer the official Agent SDK `listSessions()` and `getSessionMessages()` APIs before falling back to raw JSONL transcript sampling.

### Docs

- Updated the README and architecture/self-development docs to describe the new `snapshot-lib`, `live-monitor-lib`, `cursor-lib`, and browser runtime section boundaries.
- Documented the current official Codex app-server event coverage more precisely, including the dynamic-tool meaning of `item/tool/call` and the documented notifications we still ignore for workload rendering (`thread/tokenUsage/updated`, `fuzzyFileSearch/*`, and `windowsSandbox/setupCompleted`).
- Updated the README and integration/architecture/reference docs to describe the new Cursor Hooks path, the committed `.cursor/hooks.json`, and the typed `.codex-agents/cursor-hooks` sidecars.
- Expanded the README with explicit step-by-step instructions for copying the committed Cursor hook files into another repo and verifying that local sidecars are being written.
- Updated the README and architecture/self-development docs to describe the adapter-first core layout, async snapshot assembly, and external bundled browser client delivery.
- Added a short PartyKit hosting walkthrough to the README and references so shared-room setup includes the current official create, deploy, and generated-host flow.
- Expanded the README shared-room section with the rebuild steps for a missing `/vendor/partysocket/index.js` browser import and clarified that connection is room-based via shared `Host` and `Room` values.
- Clarified that Codex CLI is the preferred runtime, the desktop app is a fallback, and native Windows can bridge to a WSL-installed CLI.
- Expanded the product spec with the current normalized snapshot definitions, browser/runtime settings surfaces, shared-room behavior, and live API contract notes.

### Fixed

- Fixed the remaining `cursor.ts` monolith by moving Cursor cloud-agent loading, repo normalization helpers, and local discovery into focused modules, bringing the file back under the repo size guard.
- Fixed snapshot activity precedence so a recent typed file-change event can override a trailing summary message without reactivating a completed thread, while fresh command-start events still do not wake a finished desk back into running state.
- Fixed the browser client tests to assert against the real runtime section modules after the runtime patch-assembler removal, so the suite now validates behavior instead of legacy string-rewrite scaffolding.
- Fixed freshly opened or otherwise empty selected workspaces staying visually blank by reusing the 4 most recent resting lead sessions as rec-room placeholders until that workspace has its own live or recent local agents.
- Fixed Codex local state classification so completed command, file-change, and tool turns now settle to done/idle instead of remaining `running`/`validating`/`editing`, and recent command/file events no longer reactivate a thread that already finished.
- Fixed typed Codex `Needs You` handling so approval waits surface as blocked desk work, input waits surface as waiting work, and browser workstation seating now respects those visible states instead of treating every `status.type = active` thread as desk-active.
- Fixed browser desk motion so `running` and `validating` workers stay in the seated workstation pose, and current local desk-live work now gets a short grace window through transient `status.type = notLoaded` gaps instead of bouncing into the rec area between live updates.
- Fixed Pixi workstation reveal flicker so newly occupied desks once again carry their `enteringReveal` flags through the assembled scene runtime, and desk returns now blink based on workstation slot transitions instead of only firing for brand-new agent keys.
- Fixed browser scene continuity so current local threads remain visible in the map while they transition between desk and rec-area placement, and active local `idle`/`done` wobbles now get a short desk settle window instead of making the agent and workstation pop out between updates.
- Fixed rec-room rendering so only the 4 most recent top-level resting lead sessions occupy the rec seats, preventing older hidden resters and subagents from wrapping onto duplicate sofa coordinates.
- Fixed rec-room sofa seat anchors so resting avatars now sit on centered cushion points derived from the actual sofa sprite width instead of drifting left from older hard-coded placement offsets.
- Fixed office map scaling so selected and focused single-workspace views now reuse the same compact scene geometry as the tower overview instead of inflating avatars and workstations with a separate prefab scale.
- Fixed desk-pod placement so workstation pods and their internal seat cells now snap back onto the shared `16px` tile grid, matching the rec-strip furniture alignment contract.
- Fixed Codex workstation visibility so local sessions that app-server still reports as `active` no longer fall through the browser’s `waiting/done` seating exclusions and disappear from desks while they are still live.
- Fixed slow desktop Codex observer attaches from degrading too early by widening the live `thread/resume` subscription timeout, so restarted fleet servers recover current threads back to `subscribed` instead of lingering in stale `readOnly` mode.
- Fixed two-seat workstation growth so a pod's first occupied seat stays anchored to its grid cell and a second seat expands on the right instead of recentering the original workstation.
- Fixed workstation desk geometry so adding the right-side seat no longer shifts the already placed left desk shell and computer inside the pod.
- Fixed boss-lane rendering so boss sessions now render inside compact square office shells with centered workstations, using a stacked left-column layout that fits four 3-tile-tall boss offices in a standard room instead of the old rounded offset frame.
- Fixed workspace/project labels in the web UI so camel-case names like `CodexAgentsOffice` and `ProjectAtlas` render with spaces between words.
- Fixed Codex runtime discovery on native Windows so the app can fall back to `wsl.exe --exec codex` when Codex CLI is only installed inside WSL.
- Fixed the silent empty-state path for Cursor integration so snapshots now explain when the current process is missing `CURSOR_API_KEY` or when a project has no `git remote.origin.url`.
- Fixed Claude agent labels so synthetic/system transcript model placeholders like `<synthetic>` no longer appear in the office UI.
- Fixed Cursor project matching when the API only exposes GitHub pull request, GitLab merge request, or similar PR-backed repository URLs.
- Fixed inferred local Cursor chat discovery so a new Cursor chat no longer revives every stale retained composer as a separate live office agent.
- Fixed local Cursor observability by upgrading repos opened in trusted Cursor workspaces from transcript/workspace inference to typed hook-backed session state when the committed project hooks run.
- Fixed the committed Cursor project hook recorder on Windows-style shells by restoring multi-encoding stdin decoding and stable project-root resolution, so fresh local Cursor hook activity writes sidecars again instead of silently dropping payloads.
- Fixed Cursor hook-backed local session selection so stale future-skewed rows in an existing `.codex-agents/cursor-hooks/<conversation-id>.jsonl` file no longer mask newer appended Cursor activity from the same conversation.
- Fixed browser speech bubbles and other display-text surfaces so Markdown emphasis markers like `**bold**` are stripped while preserving the readable text.
- Improved Cursor cloud tracking by polling the official agent conversation API for active/recent agents and mapping newly seen prompts/replies into typed office events without replaying old history on startup.
- Fixed Codex local startup hydration so the first full `thread/read` no longer replays preloaded assistant history as a fresh live reply, while later rereads still surface genuinely new replies.
- Fixed local Cursor active/inactive inference so stale `selectedComposerIds` no longer outrank the most recently focused composer when tab order and actual chat focus diverge.
- Fixed Cursor message toasts so user-authored prompts no longer render as if the Cursor agent said them.
- Fixed workstation occupancy so waiting leads cool down into the rec area while finished top-level threads keep a 5-second desk cooldown for final-message readability before returning to rec-area idle visibility.
- Fixed workload currentness so future-skewed source timestamps no longer keep finished local threads marked active indefinitely, while genuinely live local sessions still remain visible.
- Fixed Codex local startup hydration so the first fleet snapshot now waits for initial `thread/resume` hydration and immediately rereads resumed threads, preventing an actively replying desktop thread from appearing as stale `readOnly/notLoaded` rec-room idle after a web-server restart.
- Fixed Codex local thread discovery so `status.type = active` sessions are always kept in the tracked startup/refresh set even when newer idle threads would otherwise consume the recent-thread limit, preventing a real active desktop session from appearing only after its first fresh update.
- Fixed browser workstation seating so stale local `notLoaded` threads no longer occupy desks just because workload currentness still marks them recent; only truly ongoing local work or the explicit done cooldown can keep a workstation.
- Fixed Codex desk occupancy so non-current local threads no longer stay seated on the live floor from a separate browser-side "recently live" fallback; workstation seating now matches the current-workload/session-panel model.
- Fixed completed Codex process items such as context compaction and reasoning so they no longer leave finished desktop threads stuck in a synthetic `thinking` state after the turn has ended.
- Fixed Codex local activity detection so future-skewed or invalid subscribed thread timestamps no longer keep idle `running` or `thinking` sessions counted as current workload just because they still look live.
- Fixed Codex reply streaming so the browser now reads official `item/agentMessage/delta` notifications directly instead of replaying old assistant history as fresh startup events after `thread/read` hydration.
- Fixed Codex read-only thread fallback so reread assistant replies still surface as typed events when live `thread/resume` delivery is unavailable, without reintroducing startup replay for healthy subscribed threads.
- Fixed Codex runtime discovery on Windows and Windows+WSL environments where the CLI is absent but the Codex desktop app is installed.
- Improved Cursor agent loading compatibility by tolerating auth scheme differences and multi-page API responses.
- Extended text message toast lifetime by 1 second without changing other toast types.
- Fixed stacked toast behavior so file-change toasts append new rows into the active toast body and both file-change and command toasts restart their upward float when new stacked content extends their lifetime.
- Fixed text-message toasts so they spawn from the same agent-head anchor as other agent toasts instead of starting from workstation height.
- Removed the generic `OK` speech bubble from idle and validating avatars so the office scene does not imply a separate approval or success state that is not otherwise modeled.
- Fixed Claude typed hook handling so official events such as `FileChanged`, `Notification`, `TeammateIdle`, `Setup`, and compaction transitions map into normalized office states instead of dropping back to transcript-only inference.
- Fixed stale Claude hook-backed live states so quiet Claude chats age into done/idle instead of holding a workstation indefinitely after activity stops.
- Fixed Claude hook-backed sessions so assistant reply text from transcripts or Agent SDK session messages still surfaces in the UI instead of only showing user prompts and tool-state updates.
- Fixed Claude session snapshots so they now emit normalized events with stable session-backed `threadId` values, restoring file-change bubbles and later message updates in the browser.

### Removed

- Removed the experimental LAN peer transport and UDP discovery path while leaving a disabled multiplayer interface in place for a future secured sync implementation.
