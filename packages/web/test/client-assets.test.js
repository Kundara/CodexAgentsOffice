const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { renderHtml } = require("../dist/render-html.js");

test("renderHtml loads external client assets and bootstrap config", () => {
  const html = renderHtml({
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/tmp/project", label: "project" }]
  });

  assert.match(html, /<link rel="stylesheet" href="\/client\/app\.css\?v=/);
  assert.match(html, /<script src="\/client\/app\.js\?v=.*"><\/script>/);
  assert.match(html, /window\.__AGENTS_OFFICE_CLIENT_CONFIG__/);
});

test("renderHtml can bootstrap a discovered fleet project list distinct from the seed options", () => {
  const html = renderHtml(
    {
      host: "127.0.0.1",
      port: 4181,
      explicitProjects: false,
      projects: [{ root: "/tmp/seed", label: "Seed" }]
    },
    [
      { root: "/tmp/seed", label: "Seed" },
      { root: "/tmp/discovered", label: "Discovered" }
    ]
  );

  assert.match(html, /"root":"\/tmp\/seed","label":"Seed"/);
  assert.match(html, /"root":"\/tmp\/discovered","label":"Discovered"/);
});

test("client runtime keeps current local desk-live work on a workstation through notLoaded transport gaps", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );
  const seatingSource = readFileSync(
    join(__dirname, "../src/client/runtime/seating-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_CURRENT_LOCAL_DESK_GRACE = patchRuntimeSection('),
    "runtime source should patch a short current-local desk grace into the assembled layout runtime"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_NOTLOADED_DESK_GRACE = patchRuntimeSection('),
    "runtime source should patch notLoaded desk grace into the assembled layout runtime"
  );
  assert.ok(
    runtimeSource.includes('const CURRENT_LOCAL_LIVE_WORKSTATION_GRACE_MS = 8000;'),
    "layout runtime should bound current local desk grace to a short window"
  );
  assert.ok(
    runtimeSource.includes('return agent.isOngoing === true || hasCurrentLocalDeskGrace(agent);'),
    "layout runtime should keep current desk-live work seated through notLoaded gaps"
  );
  assert.ok(
    runtimeSource.includes('if (agent.state === "done") {\n              const updatedAt = parseAgentUpdatedAt(agent.updatedAt);'),
    "layout runtime should honor a short done grace before cooling a notLoaded current thread into the rec area"
  );
  assert.match(
    seatingSource,
    /const CURRENT_LOCAL_LIVE_WORKSTATION_GRACE_MS = 8000;/
  );
  assert.match(
    seatingSource,
    /function hasCurrentLocalDeskGrace\(agent\) {\n\s+const updatedAt = parseAgentUpdatedAt\(agent && agent\.updatedAt\);/
  );
  assert.match(
    seatingSource,
    /if \(agent\.statusText === "notLoaded"\) {\n\s+if \(agent\.state === "done"\) {\n\s+const updatedAt = parseAgentUpdatedAt\(agent\.updatedAt\);/
  );
  assert.match(
    seatingSource,
    /return agent\.isCurrent === true\n\s+&& Number\.isFinite\(updatedAt\)\n\s+&& Date\.now\(\) - updatedAt <= workstationDoneGraceMs\(agent\);/
  );
  assert.match(
    seatingSource,
    /return agent\.isOngoing === true \|\| hasCurrentLocalDeskGrace\(agent\);/
  );
});

test("client runtime keeps active local desks live, leaves waiting in the rec area, and gives current idle/done work a short settle window", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );
  const seatingSource = readFileSync(
    join(__dirname, "../src/client/runtime/seating-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_WAITING_ACTIVE_DESKS = patchRuntimeSection('),
    "runtime source should patch waiting active threads out of workstation seating"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_ACTIVE_SEAT_COOLDOWN = patchRuntimeSection('),
    "runtime source should patch a short active-seat cooldown for current local idle/done threads"
  );
  assert.ok(
    runtimeSource.includes('if (agent.state === "waiting") {\n              return false;\n            }'),
    "layout runtime should keep waiting agents out of workstation seating"
  );
  assert.ok(
    runtimeSource.includes('if ((agent.state === "idle" || agent.state === "done") && hasCurrentLocalSeatCooldown(agent)) {\n              return true;\n            }'),
    "layout runtime should keep current local idle/done work on the desk through a short settle window"
  );
  assert.ok(
    runtimeSource.includes('return agent.isCurrent === true\n              && agent.state !== "idle"\n              && agent.state !== "done";'),
    "layout runtime should still require current non-resting work after the settle window"
  );
  assert.match(
    seatingSource,
    /function hasCurrentLocalSeatCooldown\(agent\) {\n\s+const updatedAt = parseAgentUpdatedAt\(agent && agent\.updatedAt\);/
  );
  assert.match(
    seatingSource,
    /if \(agent\.statusText === "active"\) {\n\s+if \(agent\.state === "waiting"\) {\n\s+return false;\n\s+}\n\s+if \(\(agent\.state === "idle" \|\| agent\.state === "done"\) && hasCurrentLocalSeatCooldown\(agent\)\) {\n\s+return true;\n\s+}\n\s+return agent\.isCurrent === true\n\s+&& agent\.state !== "idle"\n\s+&& agent\.state !== "done";/
  );
});

test("client runtime only keeps ordinary local desks for current workload", () => {
  const layoutSource = readFileSync(
    join(__dirname, "../src/client/runtime/layout-source.ts"),
    "utf8"
  );
  const seatingSource = readFileSync(
    join(__dirname, "../src/client/runtime/seating-source.ts"),
    "utf8"
  );

  assert.match(layoutSource, /if \(agent\.isCurrent !== true\) \{\\n\s+return false;/);
  assert.doesNotMatch(layoutSource, /const recentlyLive = Number\.isFinite\(updatedAt\)/);
  assert.match(seatingSource, /if \(agent\.isCurrent !== true\) {\n\s+return false;/);
  assert.doesNotMatch(seatingSource, /const recentlyLive = Number\.isFinite\(updatedAt\)/);
});

test("runtime source keeps desk seats stable when a second workstation appears in a pod", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_SCENE_SOURCE_WITH_STABLE_DESK_SEATS = patchRuntimeSection('),
    "runtime source should patch the raw scene source for stable desk seats"
  );
  assert.ok(
    runtimeSource.includes('const tile = sceneTileSize(compact);'),
    "desk seating should derive seat cells from the scene tile size"
  );
  assert.ok(
    runtimeSource.includes('const leftCellX = 0;'),
    "single-seat pods should anchor to the left seat cell"
  );
  assert.ok(
    runtimeSource.includes('const rightCellX = Math.max(0, entry.slot.width - cellWidth);'),
    "second-seat pods should use the grid-aligned right seat cell"
  );
  assert.ok(
    runtimeSource.includes('const seatMirrored = hasBothSides'),
    "desk seating should preserve a stable left/right seat choice"
  );
  assert.ok(
    runtimeSource.includes('const cellX = seatMirrored ? rightCellX : leftCellX;'),
    "desk seating should derive workstation X from stable seat cells"
  );
  assert.ok(
    runtimeSource.includes('mirrored: seatMirrored,'),
    "desk visuals should propagate the stable seat choice into mirrored workstation state"
  );
  assert.ok(
    runtimeSource.includes('function patchRuntimeSectionIfPresent(source: string, from: string, to: string): string {'),
    "runtime source should provide an optional patch helper for scene fragments that may drift in generated literals"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_SCENE_SOURCE_WITH_STABLE_DESK_GEOMETRY = patchRuntimeSectionIfPresent('),
    "stable desk geometry should no longer hard-fail startup when the raw scene literal shape changes"
  );
  assert.ok(
    runtimeSource.includes('return source.includes(from) ? source.replace(from, to) : source;'),
    "optional runtime patches should leave the assembled source unchanged when a fragment is absent"
  );
  assert.ok(
    runtimeSource.includes('`        const centerInset = options.sharedCenter ? 0 : innerInset;\n        const deskEdgeClamp = options.sharedCenter ? 0 : 2;`'),
    "desk geometry patch should still target the shared-center recentering branch when that fragment exists"
  );
  assert.ok(
    runtimeSource.includes('`        const centerInset = innerInset;\n        const deskEdgeClamp = 2;`'),
    "desk geometry patch should still replace the shared-center recentering branch with fixed insets when present"
  );
});

test("runtime source keeps running and validating workers seated at their workstation", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_SCENE_SOURCE_WITH_SEATED_ACTIVE_WORK = patchRuntimeSection('),
    "runtime source should patch the raw scene source for seated active workstation poses"
  );
  assert.ok(
    runtimeSource.includes('if (state === "running" || state === "validating") {'),
    "running and validating workers should share the seated active workstation pose"
  );
  assert.ok(
    runtimeSource.includes('if (state === "blocked") {'),
    "blocked workers should keep their separate non-seated pose"
  );
});

test("runtime source preserves workstation entering-reveal flags for the Pixi flicker animation", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );
  const navigationSource = readFileSync(
    join(__dirname, "../src/client/runtime/navigation-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_SCENE_SOURCE_WITH_WORKSTATION_REVEAL_FLAGS = patchRuntimeSectionIfPresent('),
    "runtime source should patch workstation reveal flags into the assembled scene source without crashing when the raw fragment already drifted"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_SCENE_SOURCE_WITH_SPRITE_REVEAL_FLAGS = (() => {'),
    "runtime source should assemble sprite reveal flags through a tolerant patch wrapper"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_SCENE_SOURCE_WITH_BOSS_OFFICE_SEATING = patchRuntimeSection('),
    "runtime source should patch the boss-office seating layout before it rewrites workstation reveal triggers"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_SCENE_SOURCE = (() => {'),
    "runtime source should assemble the final scene source through a post-office reveal-trigger pass"
  );
  assert.ok(
    runtimeSource.includes('return source.includes("function buildPixiSpriteDef")'),
    "runtime source should skip the helper fallback once the raw scene source already defines buildPixiSpriteDef"
  );
  assert.ok(
    runtimeSource.includes(': source + `'),
    "runtime source should inject a fallback buildPixiSpriteDef helper when the raw scene source omits it"
  );
  assert.ok(
    runtimeSource.includes('enteringReveal: options.enteringReveal === true,'),
    "assembled scene source should preserve enteringReveal on sprite definitions"
  );
  assert.ok(
    runtimeSource.includes('enteringReveal: shouldRevealWorkstation(snapshot.projectRoot, agent, entry.slot.id),'),
    "desk workstation reveal should trigger when an agent newly occupies a slot, not only when the agent key is brand new"
  );
  assert.ok(
    runtimeSource.includes('enteringReveal: shouldRevealWorkstation(snapshot.projectRoot, entry.agent, entry.slot.id),'),
    "office workstation reveal should share the slot-based reveal trigger"
  );
  assert.ok(
    runtimeSource.includes('height: Math.max(5, Math.round(workstationHeight * 0.16)),\n                enteringReveal: options.enteringReveal === true'),
    "assembled scene source should preserve enteringReveal on workstation glow effects"
  );
  assert.ok(
    runtimeSource.includes('function shouldRevealWorkstation(projectRoot, agent, slotId) {'),
    "assembled scene source should inject a workstation reveal helper when the raw scene literal omits one"
  );
  assert.ok(
    runtimeSource.includes('const previousSceneState = renderedAgentSceneState.get(key) || null;'),
    "workstation reveal helper should compare against the previous rendered slot state"
  );
  assert.ok(
    runtimeSource.includes('return previousSlotId !== slotId;'),
    "workstation reveal helper should blink when an agent gains or changes desk slots"
  );
  assert.ok(
    navigationSource.includes('if (!screenshotMode && definition.enteringReveal === true) {\\n            sprite.visible = false;\\n          }'),
    "Pixi navigation should hide entering-reveal sprites until the blink animation makes them visible"
  );
  assert.ok(
    navigationSource.includes('renderer.animatedSprites.push({\\n              kind: \\"blink\\",\\n              nodes: enteringRevealNodes,'),
    "Pixi navigation should enqueue a blink animation for entering workstation nodes"
  );
});

test("workspace focus reuses compact scene geometry and grid-snapped desk starts", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );
  const sceneGridSource = readFileSync(
    join(__dirname, "../src/client/scene-grid-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_UI_SOURCE_FINAL = patchRuntimeSection('),
    "runtime source should patch the single-workspace render path"
  );
  assert.ok(
    runtimeSource.includes('compact: true,'),
    "single-workspace rendering should reuse compact scene geometry"
  );
  assert.ok(
    sceneGridSource.includes('const deskStartColumn = Math.max('),
    "desk columns should start from a snapped tile column"
  );
  assert.ok(
    sceneGridSource.includes('const deskStartX = deskStartColumn * config.tileSize;'),
    "desk pod origins should convert the snapped column back into tile pixels"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_SCENE_SOURCE_WITH_WORKSTATION_FOOTPRINT = patchRuntimeSection('),
    "runtime source should patch the workstation footprint onto the lower desk row"
  );
  assert.ok(
    runtimeSource.includes('tileHeight: 1'),
    "workstation footprint should occupy only the bottom row"
  );
});

test("workspace focus lets the expanded floor fill the full panel rect", () => {
  const stylesSource = readFileSync(
    join(__dirname, "../src/client/styles.css"),
    "utf8"
  );

  assert.match(
    stylesSource,
    /body\.workspace-focus \.workspace-tower,\n\s+body\.workspace-focus \.workspace-tower-single \{\n\s+width: 100%;\n\s+max-width: none;\n\s+min-height: 100%;\n\s+margin: 0;/
  );
  assert.match(
    stylesSource,
    /body\.workspace-focus \.tower-floor-body \{\n\s+min-height: 0;\n\s+height: 100%;\n\s+padding: 0;\n\s+overflow: hidden;/
  );
  assert.match(
    stylesSource,
    /body\.workspace-focus \.office-map-host \{\n\s+min-height: 0;\n\s+height: 100%;\n\s+overflow: hidden;/
  );
});

test("runtime source strips markdown formatting markers from display text", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_DISPLAY_MARKDOWN = patchRuntimeSection('),
    "runtime source should patch display-text cleanup into the layout section"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_DISPLAY_PATH_SCAN = patchRuntimeSection('),
    "runtime source should patch path scanning onto the stripped display text"
  );
  assert.ok(
    runtimeSource.includes('function stripDisplayMarkdown(value) {'),
    "runtime source should define a display markdown stripper"
  );
  assert.ok(
    runtimeSource.includes('.replace(/\\\\[([^\\\\]]+)\\\\]\\\\(([^)]+)\\\\)/g, "$1")'),
    "display text cleanup should collapse markdown links to their visible label"
  );
  assert.ok(
    runtimeSource.includes('.split(String.fromCharCode(96)).join("")'),
    "display text cleanup should strip inline code markers without leaking backticks"
  );
  assert.ok(
    runtimeSource.includes('const plainText = stripDisplayMarkdown(normalized);'),
    "normalizeDisplayText should strip markdown before path cleanup"
  );
  assert.ok(
    runtimeSource.includes('const next = plainText.indexOf("/mnt/", index);'),
    "path discovery should run against stripped display text"
  );
  assert.ok(
    runtimeSource.includes('output += plainText.slice(index, next) + (cleaned || wslToWindowsPath(candidate));'),
    "path cleanup should run against stripped display text"
  );
});

test("rec-room roster keeps space for recently visible resting leads that went active", () => {
  const layoutSource = readFileSync(
    join(__dirname, "../src/client/runtime/layout-source.ts"),
    "utf8"
  );
  const specSource = readFileSync(
    join(__dirname, "../../../docs/spec.md"),
    "utf8"
  );

  assert.match(
    layoutSource,
    /const effectiveLimit = Math\.max\(0, limit - reservedRecentLeadSlots\(snapshot\)\);/
  );
  assert.match(
    layoutSource,
    /slice\(0, effectiveLimit\);/
  );
  assert.match(
    specSource,
    /The rec area should keep at most the 4 most recent lead sessions visible;/,
  );
  assert.match(
    specSource,
    /If one of those visible resting leads becomes active again, older hidden leads should not pop back into the rec area just to fill that seat for a moment\./,
  );
});

test("runtime source limits visible rec-room resters to recent top-level leads", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_SCENE_SOURCE_WITH_RECENT_RESTING_LEADS = patchRuntimeSection('),
    "runtime source should patch the raw scene source for visible resting lead limits"
  );
  assert.ok(
    runtimeSource.includes('const allRestingAgents = restingAgentsFor(snapshot, compact);'),
    "scene runtime should keep all resting agents off desks before choosing visible rec leads"
  );
  assert.ok(
    runtimeSource.includes('.filter((agent) =>\n            !agent.parentThreadId'),
    "rec-room visibility should exclude subagents from the limited resting lead display"
  );
  assert.ok(
    runtimeSource.includes('.slice(0, 4);'),
    "rec-room visibility should cap visible resting leads at four seats"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_SCENE_SOURCE_WITH_BOUNDED_REC_ASSIGNMENTS = patchRuntimeSection('),
    "runtime source should patch the resting assignment call site for the 4-seat rec limit"
  );
  assert.ok(
    runtimeSource.includes('const restingAssignments = stableSceneSlotAssignments(snapshot.projectRoot, "resting", restingAgents, 4);'),
    "resting rec assignments should use the bounded 4-seat allocator"
  );
});

test("runtime source can borrow recent rec-room leads for an empty selected workspace", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_EMPTY_PROJECT_REC_FALLBACK = patchRuntimeSection('),
    "runtime source should patch empty-project rec fallback into the layout runtime"
  );
  assert.ok(
    runtimeSource.includes('function recentFallbackAgentsForEmptyProject(snapshot, allProjects, limit = SCENE_RECENT_LEAD_LIMIT) {'),
    "layout runtime should define an explicit empty-project recent-agent fallback helper"
  );
  assert.ok(
    runtimeSource.includes('detail: projectPrefix + " · " + summary,'),
    "fallback agents should preserve their source project label in synthesized summaries"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_EMPTY_PROJECT_SCENE_FALLBACK = patchRuntimeSection('),
    "runtime source should patch scene-level empty-project fallback separately"
  );
  assert.ok(
    runtimeSource.includes('const fallbackAgents = recentFallbackAgentsForEmptyProject(snapshot, allProjects, recentLeadLimit);'),
    "scene view should use the empty-project fallback when local recent leads are absent"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_UI_SOURCE_WITH_EMPTY_PROJECT_FALLBACK = patchRuntimeSection('),
    "UI runtime should opt the selected workspace into the empty-project fallback"
  );
  assert.ok(
    runtimeSource.includes('? viewSnapshot(selectedRawSnapshot, SCENE_RECENT_LEAD_LIMIT, rawProjects)'),
    "selected workspace scene rendering should pass the fleet project list into the scene fallback"
  );
  assert.ok(
    runtimeSource.includes('? viewSessionSnapshot(selectedRawSnapshot, SESSION_RECENT_LEAD_LIMIT, rawProjects)'),
    "selected workspace session rendering should pass the fleet project list into the session fallback"
  );
});

test("runtime source falls back to default rec layout when saved sofa columns overlap", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_RENDER_SOURCE_WITH_SAFE_REC_SEATS = patchRuntimeSection('),
    "runtime source should patch rec seat placement safety into the render source"
  );
  assert.ok(
    runtimeSource.includes('const defaultLayout = recRoomSofaLayout(compact, roomPixelWidth, baseY);'),
    "rec seat placement should retain a default layout fallback"
  );
  assert.ok(
    runtimeSource.includes('{ ...defaultLayout.sofas[0], x: sofaColumns.left * tile, y: baseY }'),
    "saved sofa-column overrides should retain the default sofa sprite metadata for seat anchoring"
  );
  assert.ok(
    runtimeSource.includes('Math.abs(requestedLayout.sofas[1].x - requestedLayout.sofas[0].x) >= tile * 3'),
    "rec seat placement should reject overlapping saved sofa positions"
  );
  assert.ok(
    runtimeSource.includes(': defaultLayout;'),
    "rec seat placement should fall back to the default sofa layout when overrides collapse"
  );
  assert.ok(
    runtimeSource.includes('const sofaWidth = Number(sofa?.sprite?.w) || layout.sofaWidth;'),
    "rec seat anchors should use the real sofa sprite width when available"
  );
  assert.ok(
    runtimeSource.includes('const seatOffsetRatio = seatWithinSofa === 0 ? 0.18 : 0.62;'),
    "rec seat anchors should use centered per-sofa seat offsets"
  );
  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_SETTINGS_SOURCE_WITH_BOUNDED_REC_SLOTS = patchRuntimeSection('),
    "runtime source should patch bounded resting slot memory into the settings section"
  );
  assert.ok(
    runtimeSource.includes('function stableSceneSlotAssignments(projectRoot, category, agents, maxSlots = null) {'),
    "stable scene slot memory should accept an optional max-slot bound"
  );
  assert.ok(
    runtimeSource.includes('|| (slotLimit !== null && slotIndex >= slotLimit)'),
    "resting slot memory should discard remembered indexes outside the visible seat bound"
  );
  assert.ok(
    runtimeSource.includes('if (slotLimit !== null && nextSlotIndex >= slotLimit) {'),
    "resting slot allocation should stop before assigning a seat beyond the visible seat bound"
  );
});

test("runtime source avoids doorway arrival animations for first-load historical sessions", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_UI_SOURCE_WITH_STABLE_INITIAL_PRESENCE = patchRuntimeSection('),
    "runtime source should patch stable initial presence into the UI runtime"
  );
  assert.ok(
    runtimeSource.includes('enteringAgentKeys = previousKeys.size === 0 || screenshotMode'),
    "initial hydrate and screenshot mode should not mark all visible agents as doorway arrivals"
  );
  assert.ok(
    runtimeSource.includes('? new Set()'),
    "stable initial presence should clear entering agent keys on first-load historical renders"
  );
});

test("runtime source keeps current agents in the map scene even when they are between desk and rec placement states", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );
  const seatingSource = readFileSync(
    join(__dirname, "../src/client/runtime/seating-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes('const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_VISIBLE_CURRENT_SCENE_AGENTS = patchRuntimeSection('),
    "runtime source should patch current-agent scene visibility into the layout runtime"
  );
  assert.ok(
    runtimeSource.includes('function isLiveSceneAgent(agent) {'),
    "layout runtime should define a live-scene agent predicate"
  );
  assert.ok(
    runtimeSource.includes('return shouldSeatAtWorkstation(agent) || agent.isCurrent === true;'),
    "current agents should stay visible in the map scene even when not currently desk-seated"
  );
  assert.ok(
    runtimeSource.includes('const liveAgents = snapshot.agents.filter(isLiveSceneAgent);'),
    "view snapshots should start from live-scene agents instead of workstation-only agents"
  );
  assert.ok(
    runtimeSource.includes('const seenAgentIds = new Set();'),
    "view snapshots should dedupe current and recent-lead agents by id"
  );
  assert.match(
    seatingSource,
    /function isLiveSceneAgent\(agent\) {\n\s+if \(!agent \|\| agent\.source === "cloud" \|\| agent\.source === "presence"\) {\n\s+return false;\n\s+}\n\s+return shouldSeatAtWorkstation\(agent\) \|\| agent\.isCurrent === true;\n\s+}/
  );
});

test("toast renderer keeps the message, file-change, and command toast classes and chrome", () => {
  const toastSource = readFileSync(
    join(__dirname, "../src/client/toast-source.ts"),
    "utf8"
  );

  assert.ok(
    toastSource.includes('const className = \\`agent-toast \\${entry.kindClass}'),
    "toast className should start from the agent-toast base class"
  );
  assert.ok(
    toastSource.includes('entry.isFileChange ? " file-change" : ""'),
    "toast renderer should keep the file-change class toggle"
  );
  assert.ok(
    toastSource.includes('entry.isCommand ? " command-window" : ""'),
    "toast renderer should keep the command-window class toggle"
  );
  assert.ok(
    toastSource.includes('!entry.isCommand && Number(entry.priority) >= NOTIFICATION_PRIORITY_MESSAGE ? " message-toast" : ""'),
    "toast renderer should keep the message-toast class toggle"
  );
  assert.ok(
    toastSource.includes('isTextMessageNotification(entry) ? " text-message-toast" : ""'),
    "toast renderer should keep the text-message-toast class toggle"
  );
  assert.ok(
    toastSource.includes('<div class="agent-toast-window-label">cmd.exe</div>'),
    "command toasts should keep the cmd.exe window chrome"
  );
  assert.ok(
    toastSource.includes('<div class="agent-toast-command-line">'),
    "command toasts should keep per-line command rendering"
  );
  assert.ok(
    toastSource.includes('<span class="agent-toast-delta add">+\\${line.linesAdded}</span>'),
    "file-change toasts should keep added-line deltas"
  );
  assert.ok(
    toastSource.includes('<span class="agent-toast-delta remove">-\\${line.linesRemoved}</span>'),
    "file-change toasts should keep removed-line deltas"
  );
});

test("toast runtime preserves read command summaries and text-message priority", () => {
  const renderSource = readFileSync(
    join(__dirname, "../src/client/runtime/render-source.ts"),
    "utf8"
  );

  assert.match(
    renderSource,
    /if \(executable === \\"sed\\" \|\| executable === \\"cat\\" \|\| executable === \\"head\\" \|\| executable === \\"tail\\" \|\| executable === \\"less\\" \|\| executable === \\"more\\" \|\| executable === \\"bat\\"\) \{\\n\s+title = \\"Read \\" \+ firstPathLabel;/,
  );
  assert.match(
    renderSource,
    /else if \(executable === \\"rg\\" \|\| executable === \\"grep\\"\) \{\\n\s+title =\\n\s+pathTokens\.length > 1 \? \\"Exploring \\" \+ pathTokens\.length \+ \\" files\\"\\n\s+: firstPath \? \\"Search \\" \+ firstPathLabel\\n\s+: \\"Search files\\";/,
  );
  assert.match(
    renderSource,
    /else if \(executable === \\"ls\\" \|\| executable === \\"find\\" \|\| executable === \\"tree\\"\) \{\\n\s+title =\\n\s+pathTokens\.length > 1 \? \\"Exploring \\" \+ pathTokens\.length \+ \\" files\\"\\n\s+: firstPath \? \\"Explore \\" \+ cleanReportedPath\(snapshot\.projectRoot, firstPath\)\\n\s+: \\"Explore files\\";/,
  );
  assert.ok(
    renderSource.includes('if (latestMessageChanged) {\\n          return {'),
    "latest message changes should still build a notification descriptor"
  );
  assert.ok(
    renderSource.includes('isTextMessage: true'),
    "latest message notifications should still be marked as text messages"
  );
  assert.ok(
    renderSource.includes('priority: NOTIFICATION_PRIORITY_MESSAGE'),
    "latest message notifications should still use message priority"
  );
});

test("typed snapshot events still allow message toasts even when the agent is no longer current", () => {
  const toastSource = readFileSync(
    join(__dirname, "../src/client/toast-source.ts"),
    "utf8"
  );

  assert.match(
    toastSource,
    /if \(\n?\s*!agent\.isCurrent\n?\s*&& agent\.state !== "waiting"\n?\s*&& agent\.state !== "blocked"\n?\s*&& event\.kind !== "message"\n?\s*&& !\(event\.kind === "tool" && event\.itemType === "webSearch"\)\n?\s*\) \{/,
  );
});

test("boss relationship arrows are hover-only curved overlays with arrowheads", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );
  const specSource = readFileSync(
    join(__dirname, "../../../docs/spec.md"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes("const CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_RELATIONSHIP_LINES = patchRuntimeSection("),
    "runtime source should patch relationship arrow rendering in the navigation section"
  );
  assert.ok(
    runtimeSource.includes(".bezierCurveTo(control1X, control1Y, control2X, control2Y, line.x2, line.y2)"),
    "relationship arrows should use curved bezier paths"
  );
  assert.ok(
    runtimeSource.includes("const arrowHead = new PIXI.Graphics()"),
    "relationship arrows should draw explicit arrowheads"
  );
  assert.ok(
    runtimeSource.includes("state.hoveredRelationshipBossKey"),
    "relationship arrows should only appear for the currently hovered boss"
  );
  assert.match(
    specSource,
    /Boss-to-subagent relationship arrows should only appear when the user is hovering or focusing that boss in the scene;/,
  );
});

test("spec defines door-based arrivals and departures for visible agents", () => {
  const specSource = readFileSync(
    join(__dirname, "../../../docs/spec.md"),
    "utf8"
  );

  assert.match(
    specSource,
    /A newly visible active agent should enter from the room door and walk to its assigned workstation\./,
  );
  assert.match(
    specSource,
    /If a resting lead becomes active again, it should leave its rec-area seat and walk to its newly assigned workstation instead of despawning and respawning\./,
  );
  assert.match(
    specSource,
    /When an agent truly leaves the visible scene, it should walk back out through the room door\./,
  );
});

test("runtime source only animates exit ghosts for explicit departures and dedupes them", () => {
  const runtimeSource = readFileSync(
    join(__dirname, "../src/client/runtime-source.ts"),
    "utf8"
  );

  assert.ok(
    runtimeSource.includes("const CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_EXPLICIT_DEPARTURES = patchRuntimeSection("),
    "runtime source should patch navigation ghosting to require explicit departures"
  );
  assert.ok(
    runtimeSource.includes("const departingAgentKeys = new Set(departingAgents.map((agent) => agent.key));"),
    "exit ghost generation should key off explicit departing agents"
  );
  assert.ok(
    runtimeSource.includes("!motionState || currentAgentKeys.has(key) || motionState.exiting || !departingAgentKeys.has(key)"),
    "transient scene churn should not manufacture exit ghosts"
  );
  assert.ok(
    runtimeSource.includes("const CLIENT_RUNTIME_UI_SOURCE_WITH_DEDUPED_DEPARTURES = patchRuntimeSection("),
    "runtime source should patch UI departure bookkeeping"
  );
  assert.ok(
    runtimeSource.includes("const existingGhost = departingAgents.find((ghost) => ghost.key === key) || null;"),
    "departure bookkeeping should reuse an existing ghost for the same agent"
  );
  assert.ok(
    runtimeSource.includes("existingGhost.expiresAt = now + DEPARTING_AGENT_TTL_MS;"),
    "reused departure ghosts should refresh their expiry window"
  );
});
