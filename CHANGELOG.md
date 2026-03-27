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
- Added a root `npm start` bootstrap flow that installs if needed, rebuilds the workspace, and launches the web server on `4181`.

### Changed

- Changed Codex app-server event handling so `turn/plan/updated` now summarizes the documented `{ explanation?, plan }` payload, `turn/diff/updated` summarizes the documented `{ diff }` payload, and `item/tool/call` is labeled as a generic tool-call request instead of an MCP-specific event.
- Changed `buildDashboardSnapshotFromState()` to assemble source snapshots in parallel and evaluate workload currentness against snapshot start time, fixing the stale-freshness race for recently finished local threads.
- Changed project discovery to consult the shared adapter registry instead of hardcoding every secondary source in one discovery function.
- Changed the web server structure to use `server/`, `render/`, and `client/` internal folders while keeping the public routes and `startWebServer` surface stable.
- Changed Cursor API key resolution so saved app settings now backfill `CURSOR_API_KEY` for Cursor background-agent loading across snapshot and watch flows, while the process environment still takes precedence.
- Changed Cursor documentation and settings copy to distinguish automatic local Cursor visibility from optional API-key-backed Cursor cloud/background agents.
- Changed local Cursor session loading to prefer `~/.cursor/projects/*/agent-transcripts/*.jsonl` when available, falling back to workspace `state.vscdb` inference only for older or transcript-less sessions.
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

- Documented the current official Codex app-server event coverage more precisely, including the dynamic-tool meaning of `item/tool/call` and the documented notifications we still ignore for workload rendering (`thread/tokenUsage/updated`, `fuzzyFileSearch/*`, and `windowsSandbox/setupCompleted`).
- Updated the README and architecture/self-development docs to describe the adapter-first core layout, async snapshot assembly, and external bundled browser client delivery.
- Added a short PartyKit hosting walkthrough to the README and references so shared-room setup includes the current official create, deploy, and generated-host flow.
- Expanded the README shared-room section with the rebuild steps for a missing `/vendor/partysocket/index.js` browser import and clarified that connection is room-based via shared `Host` and `Room` values.
- Clarified that Codex CLI is the preferred runtime, the desktop app is a fallback, and native Windows can bridge to a WSL-installed CLI.
- Expanded the product spec with the current normalized snapshot definitions, browser/runtime settings surfaces, shared-room behavior, and live API contract notes.

### Fixed

- Fixed workspace/project labels in the web UI so camel-case names like `CodexAgentsOffice` and `ProjectAtlas` render with spaces between words.
- Fixed Codex runtime discovery on native Windows so the app can fall back to `wsl.exe --exec codex` when Codex CLI is only installed inside WSL.
- Fixed the silent empty-state path for Cursor integration so snapshots now explain when the current process is missing `CURSOR_API_KEY` or when a project has no `git remote.origin.url`.
- Fixed Claude agent labels so synthetic/system transcript model placeholders like `<synthetic>` no longer appear in the office UI.
- Fixed Cursor project matching when the API only exposes GitHub pull request, GitLab merge request, or similar PR-backed repository URLs.
- Fixed inferred local Cursor chat discovery so a new Cursor chat no longer revives every stale retained composer as a separate live office agent.
- Improved Cursor cloud tracking by polling the official agent conversation API for active/recent agents and mapping newly seen prompts/replies into typed office events without replaying old history on startup.
- Fixed Codex local startup hydration so the first full `thread/read` no longer replays preloaded assistant history as a fresh live reply, while later rereads still surface genuinely new replies.
- Fixed local Cursor active/inactive inference so stale `selectedComposerIds` no longer outrank the most recently focused composer when tab order and actual chat focus diverge.
- Fixed Cursor message toasts so user-authored prompts no longer render as if the Cursor agent said them.
- Fixed workstation occupancy so waiting leads cool down into the rec area while finished top-level threads keep a 5-second desk cooldown for final-message readability before returning to rec-area idle visibility.
- Fixed workload currentness so future-skewed source timestamps no longer keep finished local threads marked active indefinitely, while genuinely live local sessions still remain visible.
- Fixed Codex local startup hydration so the first fleet snapshot now waits for initial `thread/resume` hydration and immediately rereads resumed threads, preventing an actively replying desktop thread from appearing as stale `readOnly/notLoaded` rec-room idle after a web-server restart.
- Fixed browser workstation seating so stale local `notLoaded` threads no longer occupy desks just because workload currentness still marks them recent; only truly ongoing local work or the explicit done cooldown can keep a workstation.
- Fixed completed Codex process items such as context compaction and reasoning so they no longer leave finished desktop threads stuck in a synthetic `thinking` state after the turn has ended.
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
