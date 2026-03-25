# Changelog

All notable changes to this project should be recorded in this file.

This changelog is maintained against the current root `package.json` version.
Entries stay under the active version until an explicit version bump is requested.

## [0.1.0] - 2026-03-25

### Added

- Added this changelog and a repo-level maintenance policy for tracking notable additions, fixes, and behavior changes.
- Added a grid-first scene layout foundation in the web renderer with explicit tile-based scene configuration and scene grid helpers aligned to the `16px` PixelOffice unit.
- Added persisted browser scene settings and local furniture layout overrides, including a user-facing text-scale control for the office view.
- Added Windows Codex command fallback support by extracting the Microsoft Store app bundle into a local cache, with WSL path conversion support for mixed Windows/WSL setups.
- Added an opt-in OpenClaw integration that reads official Gateway session and config surfaces, discovers recent OpenClaw workspaces, and maps matching OpenClaw sessions into the shared office snapshot model.
- Added a Claude Agent SDK bridge in `packages/core` that can write typed Claude hook sidecars into `.codex-agents/claude-hooks/<session-id>.jsonl` for stronger session and tool correlation.
- Added a root `npm start` bootstrap flow that installs if needed, rebuilds the workspace, and launches the web server on `4181`.

### Changed

- Reworked the office renderer around internal scene settings, grid-based placement, and reusable scene render state instead of looser ad hoc layout math.
- Expanded Cursor integration to treat agents as cloud work, support paginated agent fetches, and normalize repository identity across direct repo URLs and PR or merge-request URLs.
- Updated the main docs to describe the new grid-first renderer direction, minimal viewer controls, and the Windows Codex runtime fallback path.
- Reframed the README around the current `Agents Office Tower` product name with a shorter multi-source support matrix instead of a mostly Codex-centric landing page.
- Moved scene controls into a toggleable settings popup in the web header, removing the manual refresh and rooms scaffold actions from the main toolbar and hiding the toast preview trigger.
- Changed the scene text-size slider to apply on release instead of during drag so the settings popup stays stable while adjusting scale.
- Extracted browser toast queueing, stacking, preview, and DOM rendering from the main client script into a dedicated `toast-script` module.
- Removed the unused DOM office-map renderer path from the web client so the browser map now runs through the retained Pixi scene only.
- Changed Claude secondary discovery to prefer the official Agent SDK `listSessions()` and `getSessionMessages()` APIs before falling back to raw JSONL transcript sampling.

### Fixed

- Fixed Claude agent labels so synthetic/system transcript model placeholders like `<synthetic>` no longer appear in the office UI.
- Fixed Cursor project matching when the API only exposes GitHub pull request, GitLab merge request, or similar PR-backed repository URLs.
- Fixed Codex runtime discovery on Windows and Windows+WSL environments where the CLI is absent but the Codex desktop app is installed.
- Improved Cursor agent loading compatibility by tolerating auth scheme differences and multi-page API responses.
- Extended text message toast lifetime by 1 second without changing other toast types.
- Fixed stacked toast behavior so file-change toasts append new rows into the active toast body and both file-change and command toasts restart their upward float when new stacked content extends their lifetime.
- Fixed text-message toasts so they spawn from the same agent-head anchor as other agent toasts instead of starting from workstation height.
- Removed the generic `OK` speech bubble from idle and validating avatars so the office scene does not imply a separate approval or success state that is not otherwise modeled.
- Fixed Claude typed hook handling so official events such as `FileChanged`, `Notification`, `TeammateIdle`, `Setup`, and compaction transitions map into normalized office states instead of dropping back to transcript-only inference.
- Fixed stale Claude hook-backed live states so quiet Claude chats age into done/idle instead of holding a workstation indefinitely after activity stops.
