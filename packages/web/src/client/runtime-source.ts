import { MULTIPLAYER_SCRIPT } from "./multiplayer-source";
import { SCENE_GRID_SCRIPT } from "./scene-grid-source";
import { TOAST_SCRIPT } from "./toast-source";
import { CLIENT_RUNTIME_BOOTSTRAP_SOURCE } from "./runtime/bootstrap-source";
import { CLIENT_RUNTIME_SETTINGS_SOURCE } from "./runtime/settings-source";
import { CLIENT_RUNTIME_LAYOUT_SOURCE } from "./runtime/layout-source";
import { CLIENT_RUNTIME_SEATING_SOURCE } from "./runtime/seating-source";
import { CLIENT_RUNTIME_RENDER_SOURCE } from "./runtime/render-source";
import { CLIENT_RUNTIME_MESSAGE_FILTER_SOURCE } from "./runtime/message-filter-source";
import { CLIENT_RUNTIME_SCENE_SOURCE as RAW_CLIENT_RUNTIME_SCENE_SOURCE } from "./runtime/scene-source";
import { CLIENT_RUNTIME_NAVIGATION_SOURCE as RAW_CLIENT_RUNTIME_NAVIGATION_SOURCE } from "./runtime/navigation-source";
import { CLIENT_RUNTIME_UI_SOURCE as RAW_CLIENT_RUNTIME_UI_SOURCE } from "./runtime/ui-source";

function patchRuntimeSection(source: string, label: string, from: string, to: string): string {
  if (!source.includes(from)) {
    throw new Error(`Runtime patch "${label}" is out of date.`);
  }
  return source.replace(from, to);
}

function patchRuntimeSectionIfPresent(source: string, from: string, to: string): string {
  return source.includes(from) ? source.replace(from, to) : source;
}

function patchRuntimeLiteralAll(source: string, label: string, from: string, to: string): string {
  if (!source.includes(from)) {
    throw new Error(`Runtime patch "${label}" is out of date.`);
  }
  return source.split(from).join(to);
}

const CLIENT_RUNTIME_SCENE_SOURCE_WITH_STABLE_DESK_SEATS = patchRuntimeSection(
  RAW_CLIENT_RUNTIME_SCENE_SOURCE,
  "stable desk seats",
  `              const padX = compact ? 8 : 10;
              const centerGap = 0;
              const cellWidth = Math.max(compact ? 44 : 58, Math.floor((entry.slot.width - padX * 2 - centerGap) / 2));
              const hasBothSides = Boolean(entry.agents[0] && entry.agents[1]);
              const singleCellX = Math.round((entry.slot.width - cellWidth) / 2);
              const cellX = hasBothSides
                ? (index === 0 ? padX : padX + cellWidth + centerGap)
                : singleCellX;
              const visual = buildCubicleCellVisualModel(
                snapshot,
                agent,
                pod.role,
                cellX,
                0,
                cellWidth,
                entry.slot.height,
                compact,
                {
                  sharedCenter: hasBothSides,
                  mirrored: index === 1,
                  lead: false,
                  slotId: entry.slot.id,
                  enteringReveal: enteringAgentKeys.has(agentKey(snapshot.projectRoot, agent)),
                  absoluteX: pod.x + cellX,
                  absoluteY: pod.y
                }
              );`,
  `              const tile = sceneTileSize(compact);
              const cellWidth = Math.min(entry.slot.width, tile * 3);
              const hasBothSides = Boolean(entry.agents[0] && entry.agents[1]);
              const leftCellX = 0;
              const rightCellX = Math.max(0, entry.slot.width - cellWidth);
              const seatMirrored = hasBothSides
                ? index === 1
                : previousSceneMirrored(snapshot, agent) === true;
              const cellX = seatMirrored ? rightCellX : leftCellX;
              const visual = buildCubicleCellVisualModel(
                snapshot,
                agent,
                pod.role,
                cellX,
                0,
                cellWidth,
                entry.slot.height,
                compact,
                {
                  sharedCenter: hasBothSides,
                  mirrored: seatMirrored,
                  lead: false,
                  slotId: entry.slot.id,
                  enteringReveal: enteringAgentKeys.has(agentKey(snapshot.projectRoot, agent)),
                  absoluteX: pod.x + cellX,
                  absoluteY: pod.y
                }
              );`
);

const CLIENT_RUNTIME_SCENE_SOURCE_WITH_STABLE_DESK_MIRROR_STATE = patchRuntimeSection(
  CLIENT_RUNTIME_SCENE_SOURCE_WITH_STABLE_DESK_SEATS,
  "stable desk mirror state",
  `                  appearance: agent.appearance,
                  slotId: entry.slot.id,
                  mirrored: index === 1,
                  ...visual.avatar,
                  bubble: visual.bubble
                });`,
  `                  appearance: agent.appearance,
                  slotId: entry.slot.id,
                  mirrored: seatMirrored,
                  ...visual.avatar,
                  bubble: visual.bubble
                });`
);

const CLIENT_RUNTIME_SCENE_SOURCE_WITH_STABLE_DESK_GEOMETRY = patchRuntimeSectionIfPresent(
  CLIENT_RUNTIME_SCENE_SOURCE_WITH_STABLE_DESK_MIRROR_STATE,
  `        const centerInset = options.sharedCenter ? 0 : innerInset;
        const deskEdgeClamp = options.sharedCenter ? 0 : 2;`,
  `        const centerInset = innerInset;
        const deskEdgeClamp = 2;`
);

const CLIENT_RUNTIME_SCENE_SOURCE_WITH_WORKSTATION_REVEAL_FLAGS = patchRuntimeSectionIfPresent(
  CLIENT_RUNTIME_SCENE_SOURCE_WITH_STABLE_DESK_GEOMETRY,
  `          glow: (agent && isBusyAgent(agent) && state !== "waiting" && state !== "blocked")
            ? {
                x: absoluteCellX + Math.round(workstationX + workstationWidth * 0.19),
                y: absoluteCellY + Math.round(workstationY + workstationHeight * 0.14),
                width: Math.max(8, Math.round(workstationWidth * 0.36)),
                height: Math.max(5, Math.round(workstationHeight * 0.16))
              }
            : null,`,
  `          glow: (agent && isBusyAgent(agent) && state !== "waiting" && state !== "blocked")
            ? {
                x: absoluteCellX + Math.round(workstationX + workstationWidth * 0.19),
                y: absoluteCellY + Math.round(workstationY + workstationHeight * 0.14),
                width: Math.max(8, Math.round(workstationWidth * 0.36)),
                height: Math.max(5, Math.round(workstationHeight * 0.16)),
                enteringReveal: options.enteringReveal === true
              }
            : null,`
);

const CLIENT_RUNTIME_SCENE_SOURCE_WITH_SPRITE_REVEAL_FLAGS = (() => {
  const source = patchRuntimeSectionIfPresent(
    CLIENT_RUNTIME_SCENE_SOURCE_WITH_WORKSTATION_REVEAL_FLAGS,
    `      function buildPixiSpriteDef(sprite, x, y, scale, z, options = {}) {
        return {
          kind: "sprite",
          sprite: sprite.url,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(sprite.w * scale),
          height: Math.round(sprite.h * scale),
          flipX: options.flipX === true,
          alpha: options.alpha ?? 1,
          z
        };
      }`,
    `      function buildPixiSpriteDef(sprite, x, y, scale, z, options = {}) {
        return {
          kind: "sprite",
          sprite: sprite.url,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(sprite.w * scale),
          height: Math.round(sprite.h * scale),
          flipX: options.flipX === true,
          enteringReveal: options.enteringReveal === true,
          alpha: options.alpha ?? 1,
          z
        };
      }`
  );

  return source.includes("function buildPixiSpriteDef")
    ? source
    : source + `

      function buildPixiSpriteDef(sprite, x, y, scale, z, options = {}) {
        return {
          kind: "sprite",
          sprite: sprite.url,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(sprite.w * scale),
          height: Math.round(sprite.h * scale),
          flipX: options.flipX === true,
          enteringReveal: options.enteringReveal === true,
          alpha: options.alpha ?? 1,
          z
        };
      }`;
})();

const CLIENT_RUNTIME_SCENE_SOURCE_WITH_BOSS_OFFICE_SEATING = patchRuntimeSection(
  CLIENT_RUNTIME_SCENE_SOURCE_WITH_SPRITE_REVEAL_FLAGS,
  "boss office seating",
  `          officeAssignments.forEach((entry) => {
            const officeX = roomX + entry.slot.x;
            const officeY = roomY + entry.slot.y;
            const role = agentRole(entry.agent);
            const innerPadX = compact ? 12 : 14;
            const cellWidth = compact ? 76 : 94;
            const cellX = Math.max(innerPadX, entry.slot.width - cellWidth - innerPadX);
            const visual = buildCubicleCellVisualModel(
              snapshot,
              entry.agent,
              role,
              cellX,
              0,
              cellWidth,
              entry.slot.height,
              compact,
              {
                mirrored: false,
                slotId: entry.slot.id,
                enteringReveal: enteringAgentKeys.has(agentKey(snapshot.projectRoot, entry.agent)),
                absoluteX: officeX + cellX,
                absoluteY: officeY
              }
            );`,
  `          officeAssignments.forEach((entry) => {
            const officeX = roomX + entry.slot.x;
            const officeY = roomY + entry.slot.y;
            const role = agentRole(entry.agent);
            const tile = sceneTileSize(compact);
            const cellWidth = Math.min(entry.slot.width, tile * 3);
            const cellX = Math.round((entry.slot.width - cellWidth) / 2);
            const visual = buildCubicleCellVisualModel(
              snapshot,
              entry.agent,
              role,
              cellX,
              0,
              cellWidth,
              entry.slot.height,
              compact,
              {
                mirrored: false,
                lead: true,
                slotId: entry.slot.id,
                enteringReveal: enteringAgentKeys.has(agentKey(snapshot.projectRoot, entry.agent)),
                absoluteX: officeX + cellX,
                absoluteY: officeY
              }
            );`
);

const CLIENT_RUNTIME_SCENE_SOURCE = (() => {
  const source = patchRuntimeLiteralAll(
    patchRuntimeLiteralAll(
      CLIENT_RUNTIME_SCENE_SOURCE_WITH_BOSS_OFFICE_SEATING,
      "desk workstation reveal trigger",
      `enteringReveal: enteringAgentKeys.has(agentKey(snapshot.projectRoot, agent)),`,
      `enteringReveal: shouldRevealWorkstation(snapshot.projectRoot, agent, entry.slot.id),`
    ),
    "office workstation reveal trigger",
    `enteringReveal: enteringAgentKeys.has(agentKey(snapshot.projectRoot, entry.agent)),`,
    `enteringReveal: shouldRevealWorkstation(snapshot.projectRoot, entry.agent, entry.slot.id),`
  );

  return source.includes("function shouldRevealWorkstation")
    ? source
    : source + `

      function shouldRevealWorkstation(projectRoot, agent, slotId) {
        if (screenshotMode || !agent || typeof slotId !== "string" || slotId.length === 0) {
          return false;
        }
        const key = agentKey(projectRoot, agent);
        if (enteringAgentKeys.has(key)) {
          return true;
        }
        const previousSceneState = renderedAgentSceneState.get(key) || null;
        const previousSlotId = previousSceneState && typeof previousSceneState.slotId === "string"
          ? previousSceneState.slotId
          : null;
        return previousSlotId !== slotId;
      }`;
})();

const CLIENT_RUNTIME_SCENE_SOURCE_WITH_SMALLER_PREFABS = patchRuntimeLiteralAll(
  CLIENT_RUNTIME_SCENE_SOURCE,
  "smaller workstation prefabs",
  `(compact ? 1.25 : 1.5)`,
  `(compact ? 1 : 1.08)`
);

const CLIENT_RUNTIME_SCENE_SOURCE_WITH_SEATED_ACTIVE_WORK = patchRuntimeSection(
  CLIENT_RUNTIME_SCENE_SOURCE_WITH_SMALLER_PREFABS,
  "seated active workstation pose",
  `          if (state === "running" || state === "validating" || state === "blocked") {
            const workingX = mirrored
              ? clampAvatarX(sideX + (compact ? 4 : 6))
              : clampAvatarX(sideX - (compact ? 4 : 6));
            return { x: workingX, y: baseY, flip: workstationFlip };
          }`,
  `          if (state === "running" || state === "validating") {
            return { x: seatedX, y: Math.max(0, baseY - (compact ? 1 : 3)), flip: workstationFlip };
          }
          if (state === "blocked") {
            const workingX = mirrored
              ? clampAvatarX(sideX + (compact ? 4 : 6))
              : clampAvatarX(sideX - (compact ? 4 : 6));
            return { x: workingX, y: baseY, flip: workstationFlip };
          }`
);

const CLIENT_RUNTIME_SCENE_SOURCE_FINAL = patchRuntimeSection(
  CLIENT_RUNTIME_SCENE_SOURCE_WITH_SEATED_ACTIVE_WORK,
  "grid aligned workstation bounds",
  `        const absoluteCellX = Math.round(options.absoluteX ?? x);
        const absoluteCellY = Math.round(options.absoluteY ?? y);
        const stationBoundsX = mirrored
          ? absoluteCellX + Math.round(deskX)
          : absoluteCellX + Math.round(deskX + deskWidth - sceneTile * 3);
        const stationBoundsY = absoluteCellY + Math.round(deskY + deskHeight - sceneTile * 2);`,
  `        const absoluteCellX = Math.round(options.absoluteX ?? x);
        const absoluteCellY = Math.round(options.absoluteY ?? y);
        const stationBoundsX = absoluteCellX + Math.max(0, Math.round((boothWidth - sceneTile * 3) / 2));
        const stationBoundsY = absoluteCellY + Math.max(0, boothHeight - sceneTile);`
);

const CLIENT_RUNTIME_SCENE_SOURCE_WITH_WORKSTATION_FOOTPRINT = patchRuntimeSection(
  CLIENT_RUNTIME_SCENE_SOURCE_FINAL,
  "workstation footprint row",
  `          workstationBounds: {
            x: stationBoundsX,
            y: stationBoundsY,
            width: sceneTile * 3,
            height: sceneTile * 2,
            tileWidth: 3,
            tileHeight: 2
          },`,
  `          workstationBounds: {
            x: stationBoundsX,
            y: stationBoundsY,
            width: sceneTile * 3,
            height: sceneTile,
            tileWidth: 3,
            tileHeight: 1
          },`
);

const CLIENT_RUNTIME_SCENE_SOURCE_WITH_RECENT_RESTING_LEADS = patchRuntimeSection(
  CLIENT_RUNTIME_SCENE_SOURCE_WITH_WORKSTATION_FOOTPRINT,
  "recent resting lead limit",
  `        const waitingAgents = snapshot.agents
          .filter((agent) => agent.state === "waiting" && agent.source !== "cloud")
          .sort(compareAgentsByRecencyStable);
        const restingAgents = restingAgentsFor(snapshot, compact);
        const offDeskAgentIds = new Set([...waitingAgents, ...restingAgents].map((agent) => agent.id));`,
  `        const waitingAgents = snapshot.agents
          .filter((agent) => agent.state === "waiting" && agent.source !== "cloud")
          .sort(compareAgentsByRecencyStable);
        const allRestingAgents = restingAgentsFor(snapshot, compact);
        const restingAgents = allRestingAgents
          .filter((agent) =>
            !agent.parentThreadId
            && agent.source !== "presence"
            && Boolean(agent.threadId || agent.taskId || agent.url || agent.source === "claude")
          )
          .slice(0, 4);
        const offDeskAgentIds = new Set([...waitingAgents, ...allRestingAgents].map((agent) => agent.id));`
);

const CLIENT_RUNTIME_SCENE_SOURCE_WITH_BOUNDED_REC_ASSIGNMENTS = patchRuntimeSection(
  CLIENT_RUNTIME_SCENE_SOURCE_WITH_RECENT_RESTING_LEADS,
  "bounded rec resting assignments",
  `            const waitingAssignments = stableSceneSlotAssignments(snapshot.projectRoot, "waiting", waitingAgents);
            const restingAssignments = stableSceneSlotAssignments(snapshot.projectRoot, "resting", restingAgents);`,
  `            const waitingAssignments = stableSceneSlotAssignments(snapshot.projectRoot, "waiting", waitingAgents);
            const restingAssignments = stableSceneSlotAssignments(snapshot.projectRoot, "resting", restingAgents, 4);`
);

const CLIENT_RUNTIME_NAVIGATION_SOURCE = patchRuntimeSection(
  RAW_CLIENT_RUNTIME_NAVIGATION_SOURCE,
  "boss office shell",
  `        model.offices.forEach((office) => {
          const officeNodes = [];
          const enteringRevealNodes = [];
          if (state.globalSceneSettings.debugTiles) {
            addDebugBounds(office.x, office.y, office.width, office.height, 0xff8d4d, tileBoundsLabel(office.width, office.height, model.tile));
          }
          const strip = new PIXI.Graphics()
            .rect(office.x, office.y, office.width, office.height)
            .fill({ color: 0x33594e, alpha: 0.52 });
          strip.zIndex = 5;
          renderer.root.addChild(strip);
          officeNodes.push(strip);

          const booth = new PIXI.Graphics()
            .roundRect(office.x, office.y, office.width, office.height, 8)
            .fill({ color: 0x243730, alpha: 0.18 })
            .stroke({ color: 0xffcf4d, width: 1.5, alpha: 0.4 });
          booth.zIndex = 7;
          renderer.root.addChild(booth);
          officeNodes.push(booth);`,
  `        model.offices.forEach((office) => {
          const officeNodes = [];
          const enteringRevealNodes = [];
          if (state.globalSceneSettings.debugTiles) {
            addDebugBounds(office.x, office.y, office.width, office.height, 0xff8d4d, tileBoundsLabel(office.width, office.height, model.tile));
          }
          const wallHeight = Math.max(model.tile + 8, Math.round(office.height * 0.42));
          const shell = new PIXI.Graphics()
            .rect(office.x, office.y, office.width, office.height)
            .fill({ color: 0x1b2b33, alpha: 0.96 })
            .stroke({ color: 0xffcf4d, width: 2, alpha: 0.42 });
          shell.zIndex = 5;
          renderer.root.addChild(shell);
          officeNodes.push(shell);

          const wall = new PIXI.Graphics()
            .rect(office.x + 2, office.y + 2, Math.max(0, office.width - 4), Math.max(0, wallHeight - 2))
            .fill({ color: 0xdceefe, alpha: 0.92 });
          wall.zIndex = 6;
          renderer.root.addChild(wall);
          officeNodes.push(wall);

          const divider = new PIXI.Graphics()
            .rect(office.x + 2, office.y + wallHeight, Math.max(0, office.width - 4), 2)
            .fill({ color: 0x8ed6ff, alpha: 0.76 });
          divider.zIndex = 7;
          renderer.root.addChild(divider);
          officeNodes.push(divider);

          const floor = new PIXI.Graphics()
            .rect(office.x + 2, office.y + wallHeight + 2, Math.max(0, office.width - 4), Math.max(0, office.height - wallHeight - 4))
            .fill({ color: 0x357bb0, alpha: 0.9 });
          floor.zIndex = 6;
          renderer.root.addChild(floor);
          officeNodes.push(floor);

          const doorwayWidth = Math.max(model.tile + 2, Math.round(office.width * 0.28));
          const doorwayX = office.x + Math.round((office.width - doorwayWidth) / 2);
          const doorway = new PIXI.Graphics()
            .rect(doorwayX, office.y + office.height - 2, doorwayWidth, 2)
            .fill({ color: 0x0b1b2b, alpha: 1 });
          doorway.zIndex = 7;
          renderer.root.addChild(doorway);
          officeNodes.push(doorway);`
);

const CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_SMALLER_DESK_RENDERING = patchRuntimeSection(
  CLIENT_RUNTIME_NAVIGATION_SOURCE,
  "smaller desk rendering",
  `        function addSpriteNode(definition) {
          const sprite = PIXI.Sprite.from(loadedOfficeAssetImages.get(definition.sprite) || definition.sprite);
          const snappedWidth = pixelSnap(definition.width, 1);
          const snappedHeight = pixelSnap(definition.height, 1);
          sprite.x = pixelSnap(definition.x);
          sprite.y = pixelSnap(definition.y);
          sprite.width = snappedWidth;
          sprite.height = snappedHeight;
          sprite.alpha = Number.isFinite(definition.alpha) ? definition.alpha : 1;`,
  `        function addSpriteNode(definition) {
          const sprite = PIXI.Sprite.from(loadedOfficeAssetImages.get(definition.sprite) || definition.sprite);
          const deskShellScale = definition && definition.z >= 7 && definition.z <= 9 ? 0.86 : 1;
          const deskShellLift = definition && definition.z === 8 ? 4 : 0;
          const snappedWidth = pixelSnap(definition.width * deskShellScale, 1);
          const snappedHeight = pixelSnap(definition.height * deskShellScale, 1);
          const offsetX = pixelSnap((definition.width - snappedWidth) / 2);
          const offsetY = pixelSnap(definition.height - snappedHeight) - deskShellLift;
          sprite.x = pixelSnap(definition.x) + offsetX;
          sprite.y = pixelSnap(definition.y) + offsetY;
          sprite.width = snappedWidth;
          sprite.height = snappedHeight;
          sprite.alpha = Number.isFinite(definition.alpha) ? definition.alpha : 1;`
);

const CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_SMALLER_AVATAR_RENDERING = patchRuntimeSection(
  CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_SMALLER_DESK_RENDERING,
  "smaller avatar rendering",
  `        function addAvatarNode(agent, zIndex = 12) {
          const avatar = PIXI.Sprite.from(loadedOfficeAssetImages.get(agent.sprite) || agent.sprite);
          const createdNodes = [];
          const snappedWidth = pixelSnap(agent.width, 1);
          const snappedHeight = pixelSnap(agent.height, 1);
          avatar.x = pixelSnap(agent.x);
          avatar.y = pixelSnap(agent.y);
          avatar.width = snappedWidth;
          avatar.height = snappedHeight;`,
  `        function addAvatarNode(agent, zIndex = 12) {
          const avatar = PIXI.Sprite.from(loadedOfficeAssetImages.get(agent.sprite) || agent.sprite);
          const createdNodes = [];
          const avatarScale = agent && agent.slotId ? 0.86 : 1;
          const snappedWidth = pixelSnap(agent.width * avatarScale, 1);
          const snappedHeight = pixelSnap(agent.height * avatarScale, 1);
          const offsetX = pixelSnap((agent.width - snappedWidth) / 2);
          const offsetY = pixelSnap(agent.height - snappedHeight);
          avatar.x = pixelSnap(agent.x) + offsetX;
          avatar.y = pixelSnap(agent.y) + offsetY;
          avatar.width = snappedWidth;
          avatar.height = snappedHeight;`
);

const CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_RELATIONSHIP_LINES = patchRuntimeSection(
  CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_SMALLER_AVATAR_RENDERING,
  "boss relationship arrows",
  `        model.relationshipLines.forEach((line) => {
          const path = new PIXI.Graphics()
            .moveTo(line.x1, line.y1)
            .lineTo(line.x2, line.y2)
            .stroke({ color: 0xffcf4d, width: 2, alpha: 0.48 });
          path.zIndex = 4;
          renderer.root.addChild(path);
          registerFocusNodes(line.focusKeys, [path]);
        });`,
  `        renderer.relationshipLineEntries = [];
        model.relationshipLines.forEach((line) => {
          const dx = line.x2 - line.x1;
          const dy = line.y2 - line.y1;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const direction = dx >= 0 ? 1 : -1;
          const controlReach = Math.max(26, Math.min(88, Math.round(distance * 0.34)));
          const controlLift = Math.max(18, Math.min(54, Math.round(distance * 0.16)));
          const apexY = Math.min(line.y1, line.y2) - controlLift;
          const control1X = line.x1 + controlReach * direction;
          const control1Y = apexY;
          const control2X = line.x2 - controlReach * direction;
          const control2Y = apexY;

          const path = new PIXI.Graphics()
            .moveTo(line.x1, line.y1)
            .bezierCurveTo(control1X, control1Y, control2X, control2Y, line.x2, line.y2)
            .stroke({ color: 0xffde73, width: 3, alpha: 0.72, cap: "round", join: "round" });
          path.zIndex = 13;
          path.visible = false;
          renderer.root.addChild(path);

          const tangentX = line.x2 - control2X;
          const tangentY = line.y2 - control2Y;
          const tangentAngle = Math.atan2(tangentY, tangentX);
          const arrowLength = 11;
          const arrowWidth = 5;
          const arrowBaseX = line.x2 - Math.cos(tangentAngle) * arrowLength;
          const arrowBaseY = line.y2 - Math.sin(tangentAngle) * arrowLength;
          const arrowHead = new PIXI.Graphics()
            .moveTo(line.x2, line.y2)
            .lineTo(
              arrowBaseX + Math.cos(tangentAngle + Math.PI / 2) * arrowWidth,
              arrowBaseY + Math.sin(tangentAngle + Math.PI / 2) * arrowWidth
            )
            .lineTo(
              arrowBaseX + Math.cos(tangentAngle - Math.PI / 2) * arrowWidth,
              arrowBaseY + Math.sin(tangentAngle - Math.PI / 2) * arrowWidth
            )
            .closePath()
            .fill({ color: 0xffde73, alpha: 0.88 });
          arrowHead.zIndex = 13;
          arrowHead.visible = false;
          renderer.root.addChild(arrowHead);

          renderer.relationshipLineEntries.push({
            bossKey: line.focusKey,
            nodes: [
              { node: path, baseAlpha: 1 },
              { node: arrowHead, baseAlpha: 1 }
            ]
          });
        });`
);

const CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_EXPLICIT_DEPARTURES = patchRuntimeSection(
  CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_RELATIONSHIP_LINES,
  "explicit departure ghosts",
  `        previousMotionStates.forEach((motionState, key) => {
          if (!motionState || currentAgentKeys.has(key) || motionState.exiting) {
            return;
          }`,
  `        const departingAgentKeys = new Set(departingAgents.map((agent) => agent.key));
        previousMotionStates.forEach((motionState, key) => {
          if (!motionState || currentAgentKeys.has(key) || motionState.exiting || !departingAgentKeys.has(key)) {
            return;
          }`
);

const CLIENT_RUNTIME_NAVIGATION_SOURCE_FINAL = patchRuntimeSection(
  CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_EXPLICIT_DEPARTURES,
  "boss relationship arrow focus",
  `      function applyOfficeRendererFocus(renderer) {
        if (!renderer || !Array.isArray(renderer.focusables)) {
          return;
        }
        const focusedKeys = new Set(state.focusedSessionKeys);
        const hasFocus = focusedKeys.size > 0;
        renderer.focusables.forEach((entry) => {
          const match = !hasFocus || focusKeysIntersect(entry.keys, focusedKeys);
          entry.nodes.forEach((nodeEntry) => {
            if (!nodeEntry || !nodeEntry.node) {
              return;
            }
            nodeEntry.node.alpha = match ? nodeEntry.baseAlpha : Math.max(0.18, nodeEntry.baseAlpha * 0.45);
          });
        });
      }`,
  `      function applyOfficeRendererFocus(renderer) {
        if (!renderer || !Array.isArray(renderer.focusables)) {
          return;
        }
        const focusedKeys = new Set(state.focusedSessionKeys);
        const hasFocus = focusedKeys.size > 0;
        renderer.focusables.forEach((entry) => {
          const match = !hasFocus || focusKeysIntersect(entry.keys, focusedKeys);
          entry.nodes.forEach((nodeEntry) => {
            if (!nodeEntry || !nodeEntry.node) {
              return;
            }
            nodeEntry.node.alpha = match ? nodeEntry.baseAlpha : Math.max(0.18, nodeEntry.baseAlpha * 0.45);
          });
        });
        const hoveredRelationshipBossKey = typeof state.hoveredRelationshipBossKey === "string"
          ? state.hoveredRelationshipBossKey
          : "";
        (Array.isArray(renderer.relationshipLineEntries) ? renderer.relationshipLineEntries : []).forEach((entry) => {
          const visible = hoveredRelationshipBossKey.length > 0 && entry && entry.bossKey === hoveredRelationshipBossKey;
          (Array.isArray(entry?.nodes) ? entry.nodes : []).forEach((nodeEntry) => {
            if (!nodeEntry || !nodeEntry.node) {
              return;
            }
            nodeEntry.node.visible = visible;
            nodeEntry.node.alpha = visible ? nodeEntry.baseAlpha : 0;
          });
        });
      }`
);

const CLIENT_RUNTIME_UI_SOURCE = patchRuntimeSection(
  RAW_CLIENT_RUNTIME_UI_SOURCE,
  "boss relationship hover focus",
  `      function applySessionFocus() {
        const focusedKeys = new Set(state.focusedSessionKeys);
        const hasFocus = focusedKeys.size > 0;
        document.querySelectorAll("[data-scene-grid]").forEach((grid) => {
          if (!(grid instanceof HTMLElement)) {
            return;
          }
          if (hasFocus) {
            grid.dataset.focusActive = "true";
          } else {
            delete grid.dataset.focusActive;
          }
        });
        document.querySelectorAll("[data-focus-agent]").forEach((element) => {
          if (!(element instanceof HTMLElement)) {
            return;
          }
          element.classList.toggle("is-focused", hasFocus && focusedKeys.has(element.dataset.focusKey || ""));
        });
        document.querySelectorAll("[data-focus-line]").forEach((element) => {
          if (!(element instanceof SVGElement)) {
            return;
          }
          element.classList.toggle("is-focused", hasFocus && focusedKeys.has(element.dataset.focusBossKey || ""));
        });
        applyOfficeRendererFocusAll();
      }

      function setSessionFocusFromElement(element) {
        if (!(element instanceof HTMLElement)) {
          state.focusedSessionKeys = [];
          applySessionFocus();
          return;
        }
        try {
          const parsed = JSON.parse(element.dataset.focusKeys || "[]");
          state.focusedSessionKeys = Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
        } catch {
          state.focusedSessionKeys = [];
        }
        applySessionFocus();
      }`,
  `      function applySessionFocus() {
        const focusedKeys = new Set(state.focusedSessionKeys);
        const hasFocus = focusedKeys.size > 0;
        const hoveredRelationshipBossKey = typeof state.hoveredRelationshipBossKey === "string"
          ? state.hoveredRelationshipBossKey
          : "";
        document.querySelectorAll("[data-scene-grid]").forEach((grid) => {
          if (!(grid instanceof HTMLElement)) {
            return;
          }
          if (hasFocus) {
            grid.dataset.focusActive = "true";
          } else {
            delete grid.dataset.focusActive;
          }
        });
        document.querySelectorAll("[data-focus-agent]").forEach((element) => {
          if (!(element instanceof HTMLElement)) {
            return;
          }
          element.classList.toggle("is-focused", hasFocus && focusedKeys.has(element.dataset.focusKey || ""));
        });
        document.querySelectorAll("[data-focus-line]").forEach((element) => {
          if (!(element instanceof SVGElement)) {
            return;
          }
          element.classList.toggle(
            "is-focused",
            hoveredRelationshipBossKey.length > 0 && hoveredRelationshipBossKey === (element.dataset.focusBossKey || "")
          );
        });
        applyOfficeRendererFocusAll();
      }

      function setSessionFocusFromElement(element) {
        if (!(element instanceof HTMLElement)) {
          state.focusedSessionKeys = [];
          state.hoveredRelationshipBossKey = null;
          applySessionFocus();
          return;
        }
        try {
          const parsed = JSON.parse(element.dataset.focusKeys || "[]");
          state.focusedSessionKeys = Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
        } catch {
          state.focusedSessionKeys = [];
        }
        state.hoveredRelationshipBossKey = (
          element.dataset.focusAgent === "true"
          && typeof element.dataset.focusKey === "string"
          && element.dataset.focusKey.length > 0
          && state.focusedSessionKeys.length > 1
        )
          ? element.dataset.focusKey
          : null;
        applySessionFocus();
      }`
);

const CLIENT_RUNTIME_UI_SOURCE_WITH_DEDUPED_DEPARTURES = patchRuntimeSection(
  CLIENT_RUNTIME_UI_SOURCE,
  "deduped departing agents",
  `        for (const [key, entry] of liveAgentMemory.entries()) {
          if (!nextMemory.has(key)) {
            const sceneState = renderedAgentSceneState.get(key) || null;
            if (!sceneState) {
              continue;
            }
            departingAgents.push({
              ...entry,
              sceneState,
              expiresAt: now + DEPARTING_AGENT_TTL_MS
            });
          }
        }`,
  `        for (const [key, entry] of liveAgentMemory.entries()) {
          if (!nextMemory.has(key)) {
            const sceneState = renderedAgentSceneState.get(key) || null;
            if (!sceneState) {
              continue;
            }
            const existingGhost = departingAgents.find((ghost) => ghost.key === key) || null;
            if (existingGhost) {
              existingGhost.projectRoot = entry.projectRoot;
              existingGhost.roomId = entry.roomId;
              existingGhost.agent = entry.agent;
              existingGhost.sceneState = sceneState;
              existingGhost.expiresAt = now + DEPARTING_AGENT_TTL_MS;
              continue;
            }
            departingAgents.push({
              ...entry,
              sceneState,
              expiresAt: now + DEPARTING_AGENT_TTL_MS
            });
          }
        }`
);

const CLIENT_RUNTIME_UI_SOURCE_WITH_STABLE_INITIAL_PRESENCE = patchRuntimeSection(
  CLIENT_RUNTIME_UI_SOURCE_WITH_DEDUPED_DEPARTURES,
  "stable initial presence",
  `        enteringAgentKeys = new Set(
          [...nextMemory.keys()].filter((key) => !previousKeys.has(key))
        );`,
  `        enteringAgentKeys = previousKeys.size === 0 || screenshotMode
          ? new Set()
          : new Set(
              [...nextMemory.keys()].filter((key) => !previousKeys.has(key))
            );`
);

const CLIENT_RUNTIME_UI_SOURCE_WITH_EMPTY_PROJECT_FALLBACK = patchRuntimeSection(
  CLIENT_RUNTIME_UI_SOURCE_WITH_STABLE_INITIAL_PRESENCE,
  "empty project recent fallback",
  `        const snapshot = selectedRawSnapshot ? viewSnapshot(selectedRawSnapshot, SCENE_RECENT_LEAD_LIMIT) : null;
        const sessionSnapshot = selectedRawSnapshot ? viewSessionSnapshot(selectedRawSnapshot, SESSION_RECENT_LEAD_LIMIT) : null;`,
  `        const snapshot = selectedRawSnapshot
          ? viewSnapshot(selectedRawSnapshot, SCENE_RECENT_LEAD_LIMIT, rawProjects)
          : null;
        const sessionSnapshot = selectedRawSnapshot
          ? viewSessionSnapshot(selectedRawSnapshot, SESSION_RECENT_LEAD_LIMIT, rawProjects)
          : null;`
);

const CLIENT_RUNTIME_UI_SOURCE_FINAL = patchRuntimeSection(
  CLIENT_RUNTIME_UI_SOURCE_WITH_EMPTY_PROJECT_FALLBACK,
  "single workspace compact scene",
  `renderWorkspaceFloor(snapshot, {
                  compact: false,
                  focusMode: state.workspaceFullscreen,`,
  `renderWorkspaceFloor(snapshot, {
                  compact: true,
                  focusMode: state.workspaceFullscreen,`
);

const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_WAITING_ACTIVE_DESKS = patchRuntimeSection(
  CLIENT_RUNTIME_LAYOUT_SOURCE,
  "active waiting desks",
  `          if (agent.statusText === "active") {
            return agent.isCurrent === true;
          }`,
  `          if (agent.statusText === "active") {
            return agent.isCurrent === true
              && agent.state !== "waiting"
              && agent.state !== "idle"
              && agent.state !== "done";
          }`
);

const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_CURRENT_LOCAL_DESK_GRACE = patchRuntimeSection(
  CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_WAITING_ACTIVE_DESKS,
  "current local desk grace",
  `      const TOP_LEVEL_DONE_WORKSTATION_GRACE_MS = 5000;
      const SUBAGENT_DONE_WORKSTATION_GRACE_MS = 1200;`,
  `      const TOP_LEVEL_DONE_WORKSTATION_GRACE_MS = 5000;
      const SUBAGENT_DONE_WORKSTATION_GRACE_MS = 1200;
      const CURRENT_LOCAL_LIVE_WORKSTATION_GRACE_MS = 8000;

      function hasCurrentLocalDeskGrace(agent) {
        const updatedAt = parseAgentUpdatedAt(agent && agent.updatedAt);
        return agent && agent.isCurrent === true
          && isDeskLiveLocalState(agent.state)
          && Number.isFinite(updatedAt)
          && Date.now() - updatedAt <= CURRENT_LOCAL_LIVE_WORKSTATION_GRACE_MS;
      }

      function hasCurrentLocalSeatCooldown(agent) {
        const updatedAt = parseAgentUpdatedAt(agent && agent.updatedAt);
        return agent && agent.source === "local"
          && agent.isCurrent === true
          && Number.isFinite(updatedAt)
          && Date.now() - updatedAt <= CURRENT_LOCAL_LIVE_WORKSTATION_GRACE_MS;
      }`
);

const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_ACTIVE_SEAT_COOLDOWN = patchRuntimeSection(
  CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_CURRENT_LOCAL_DESK_GRACE,
  "active seat cooldown",
  `          if (agent.statusText === "active") {
            return agent.isCurrent === true
              && agent.state !== "waiting"
              && agent.state !== "idle"
              && agent.state !== "done";
          }`,
  `          if (agent.statusText === "active") {
            if (agent.state === "waiting") {
              return false;
            }
            if ((agent.state === "idle" || agent.state === "done") && hasCurrentLocalSeatCooldown(agent)) {
              return true;
            }
            return agent.isCurrent === true
              && agent.state !== "idle"
              && agent.state !== "done";
          }`
);

const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_NOTLOADED_DESK_GRACE = patchRuntimeSection(
  CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_ACTIVE_SEAT_COOLDOWN,
  "notLoaded desk grace",
  `          if (agent.statusText === "notLoaded") {
            return agent.isOngoing === true;
          }`,
  `          if (agent.statusText === "notLoaded") {
            if (agent.state === "done") {
              const updatedAt = parseAgentUpdatedAt(agent.updatedAt);
              return agent.isCurrent === true
                && Number.isFinite(updatedAt)
                && Date.now() - updatedAt <= workstationDoneGraceMs(agent);
            }
            return agent.isOngoing === true || hasCurrentLocalDeskGrace(agent);
          }`
);

const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_VISIBLE_CURRENT_SCENE_AGENTS = patchRuntimeSection(
  CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_NOTLOADED_DESK_GRACE,
  "visible current scene agents",
  `      function viewSnapshot(snapshot, recentLeadLimit = SCENE_RECENT_LEAD_LIMIT) {
        const activeAgents = snapshot.agents.filter(shouldSeatAtWorkstation);
        const recentLeads = recentLeadAgents(snapshot, recentLeadLimit);
        return {
          ...snapshot,
          agents: [...activeAgents, ...recentLeads]
        };
      }`,
  `      function isLiveSceneAgent(agent) {
        if (!agent || agent.source === "cloud" || agent.source === "presence") {
          return false;
        }
        return shouldSeatAtWorkstation(agent) || agent.isCurrent === true;
      }

      function viewSnapshot(snapshot, recentLeadLimit = SCENE_RECENT_LEAD_LIMIT) {
        const liveAgents = snapshot.agents.filter(isLiveSceneAgent);
        const recentLeads = recentLeadAgents(snapshot, recentLeadLimit);
        const seenAgentIds = new Set();
        return {
          ...snapshot,
          agents: [...liveAgents, ...recentLeads].filter((agent) => {
            const agentId = String(agent && agent.id || "");
            if (!agentId || seenAgentIds.has(agentId)) {
              return false;
            }
            seenAgentIds.add(agentId);
            return true;
          })
        };
      }`
);

const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_EMPTY_PROJECT_REC_FALLBACK = patchRuntimeSection(
  CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_VISIBLE_CURRENT_SCENE_AGENTS,
  "empty project rec fallback",
  `      function viewSessionSnapshot(snapshot, recentSessionLimit = SESSION_RECENT_LEAD_LIMIT) {
        const activeAgents = snapshot.agents.filter(isBusyAgent);
        const recentAgents = recentSessionAgents(snapshot, recentSessionLimit);
        return {
          ...snapshot,
          agents: [...activeAgents, ...recentAgents]
        };
      }`,
  `      function emptyProjectNeedsRecentFallback(snapshot) {
        return Boolean(snapshot) && !snapshot.agents.some((agent) => agent.source !== "cloud" && agent.source !== "presence");
      }

      function cloneRecentFallbackAgent(sourceSnapshot, agent) {
        const summary = normalizeDisplayText(sourceSnapshot.projectRoot, agent.detail)
          || latestAgentMessage(agent)
          || "[" + String(agent.state || "idle") + "]";
        const projectPrefix = projectLabel(sourceSnapshot.projectRoot);
        const latestMessage = latestAgentMessage(agent);
        return {
          ...agent,
          isCurrent: false,
          isOngoing: false,
          needsUser: null,
          detail: projectPrefix + " · " + summary,
          latestMessage: latestMessage ? projectPrefix + " · " + latestMessage : null
        };
      }

      function recentFallbackAgentsForEmptyProject(snapshot, allProjects, limit = SCENE_RECENT_LEAD_LIMIT) {
        if (!emptyProjectNeedsRecentFallback(snapshot) || !Array.isArray(allProjects) || allProjects.length === 0) {
          return [];
        }
        const seenAgentIds = new Set();
        return allProjects
          .flatMap((project) =>
            project.projectRoot === snapshot.projectRoot
              ? []
              : project.agents
                .filter((agent) => isFinishedLeadForRec(agent))
                .map((agent) => cloneRecentFallbackAgent(project, agent))
          )
          .sort(compareAgentsByRecencyStable)
          .filter((agent) => {
            const agentId = String(agent && agent.id || "");
            if (!agentId || seenAgentIds.has(agentId)) {
              return false;
            }
            seenAgentIds.add(agentId);
            return true;
          })
          .slice(0, Math.max(0, limit));
      }

      function viewSessionSnapshot(snapshot, recentSessionLimit = SESSION_RECENT_LEAD_LIMIT, allProjects = null) {
        const activeAgents = snapshot.agents.filter(isBusyAgent);
        const recentAgents = recentSessionAgents(snapshot, recentSessionLimit);
        const fallbackAgents = recentFallbackAgentsForEmptyProject(
          snapshot,
          allProjects,
          Math.min(SCENE_RECENT_LEAD_LIMIT, recentSessionLimit)
        );
        return {
          ...snapshot,
          agents: activeAgents.length > 0 || recentAgents.length > 0
            ? [...activeAgents, ...recentAgents]
            : fallbackAgents
        };
      }`
);

const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_EMPTY_PROJECT_SCENE_FALLBACK = patchRuntimeSection(
  CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_EMPTY_PROJECT_REC_FALLBACK,
  "empty project scene fallback",
  `      function viewSnapshot(snapshot, recentLeadLimit = SCENE_RECENT_LEAD_LIMIT) {
        const liveAgents = snapshot.agents.filter(isLiveSceneAgent);
        const recentLeads = recentLeadAgents(snapshot, recentLeadLimit);
        const seenAgentIds = new Set();
        return {
          ...snapshot,
          agents: [...liveAgents, ...recentLeads].filter((agent) => {
            const agentId = String(agent && agent.id || "");
            if (!agentId || seenAgentIds.has(agentId)) {
              return false;
            }
            seenAgentIds.add(agentId);
            return true;
          })
        };
      }`,
  `      function viewSnapshot(snapshot, recentLeadLimit = SCENE_RECENT_LEAD_LIMIT, allProjects = null) {
        const liveAgents = snapshot.agents.filter(isLiveSceneAgent);
        const recentLeads = recentLeadAgents(snapshot, recentLeadLimit);
        const fallbackAgents = recentFallbackAgentsForEmptyProject(snapshot, allProjects, recentLeadLimit);
        const seenAgentIds = new Set();
        const visibleAgents = liveAgents.length > 0 || recentLeads.length > 0
          ? [...liveAgents, ...recentLeads]
          : fallbackAgents;
        return {
          ...snapshot,
          agents: visibleAgents.filter((agent) => {
            const agentId = String(agent && agent.id || "");
            if (!agentId || seenAgentIds.has(agentId)) {
              return false;
            }
            seenAgentIds.add(agentId);
            return true;
          })
        };
      }`
);

const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_DISPLAY_MARKDOWN = patchRuntimeSection(
  CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_EMPTY_PROJECT_SCENE_FALLBACK,
  "display markdown cleanup",
  `      function normalizeDisplayText(projectRoot, value) {
        const normalized = String(value || "").trim();
        if (!normalized) {
          return "";
        }
        const isPathBoundary = (character) => {`,
  `      function stripDisplayMarkdown(value) {
        return String(value || "")
          .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, "$1")
          .replace(/(^|[\\s(>])(\\*\\*|__)(\\S(?:[\\s\\S]*?\\S)?)\\2(?=[\\s).,!?:;]|$)/g, "$1$3")
          .replace(/(^|[\\s(>])(\\*|_)(\\S(?:[\\s\\S]*?\\S)?)\\2(?=[\\s).,!?:;]|$)/g, "$1$3")
          .split(String.fromCharCode(96)).join("")
          .replace(/^#{1,6}\\s+/gm, "")
          .replace(/[ \\t]+/g, " ")
          .trim();
      }

      function normalizeDisplayText(projectRoot, value) {
        const normalized = String(value || "").trim();
        if (!normalized) {
          return "";
        }
        const plainText = stripDisplayMarkdown(normalized);
        if (!plainText) {
          return "";
        }
        const isPathBoundary = (character) => {`
);

const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_DISPLAY_PATH_SCAN = patchRuntimeSection(
  CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_DISPLAY_MARKDOWN,
  "display markdown path scan",
  `        let output = "";
        let index = 0;
        while (index < normalized.length) {
          const next = normalized.indexOf("/mnt/", index);
          if (next === -1) {
            output += normalized.slice(index);
            break;
          }
          const previousChar = next > 0 ? normalized[next - 1] : "";
`,
  `        let output = "";
        let index = 0;
        while (index < plainText.length) {
          const next = plainText.indexOf("/mnt/", index);
          if (next === -1) {
            output += plainText.slice(index);
            break;
          }
          const previousChar = next > 0 ? plainText[next - 1] : "";
`
);

const CLIENT_RUNTIME_RENDER_SOURCE_WITH_DISPLAY_MARKDOWN = patchRuntimeSection(
  CLIENT_RUNTIME_RENDER_SOURCE,
  "display markdown path cleanup",
  `          if (!isPathBoundary(previousChar)) {
            output += normalized.slice(index, next + 5);
            index = next + 5;
            continue;
          }
          let end = next + 5;
          while (end < normalized.length && !isPathBoundary(normalized[end])) {
            end += 1;
          }
          const candidate = normalized.slice(next, end);
          const cleaned = cleanReportedPath(projectRoot, candidate);
          output += normalized.slice(index, next) + (cleaned || wslToWindowsPath(candidate));
          index = end;
        }
        return output;
      }`,
  `          if (!isPathBoundary(previousChar)) {
            output += plainText.slice(index, next + 5);
            index = next + 5;
            continue;
          }
          let end = next + 5;
          while (end < plainText.length && !isPathBoundary(plainText[end])) {
            end += 1;
          }
          const candidate = plainText.slice(next, end);
          const cleaned = cleanReportedPath(projectRoot, candidate);
          output += plainText.slice(index, next) + (cleaned || wslToWindowsPath(candidate));
          index = end;
        }
        return output;
      }`
);

const CLIENT_RUNTIME_RENDER_SOURCE_WITH_SAFE_REC_SEATS = patchRuntimeSection(
  CLIENT_RUNTIME_RENDER_SOURCE_WITH_DISPLAY_MARKDOWN,
  "safe rec seats",
  `      function recRoomSeatSlotAt(agent, index, compact, roomPixelWidth, baseY, sofaColumns = null) {
        const layout = sofaColumns
          ? {
              sofaWidth: sceneTileSize(compact) * 2,
              sofas: [
                { id: "sofa-left", x: sofaColumns.left * sceneTileSize(compact), y: baseY },
                { id: "sofa-right", x: sofaColumns.right * sceneTileSize(compact), y: baseY }
              ]
            }
          : recRoomSofaLayout(compact, roomPixelWidth, baseY);
        const seatIndex = index % 4;
        const sofa = layout.sofas[Math.floor(seatIndex / 2)];
        const seatWithinSofa = seatIndex % 2;
        const avatar = avatarForAgent(agent);
        const avatarScale = compact ? 1.25 : 1.5;
        const avatarHeight = Math.round(avatar.h * avatarScale);
        const x = sofa.x + Math.round(layout.sofaWidth * (seatWithinSofa === 0 ? 0.12 : 0.56));
        const y = sofa.y - Math.round(avatarHeight * 0.28);
        return {
          x,
          y,
          flip: seatWithinSofa === 1,
          settle: true
        };
      }`,
  `      function recRoomSeatSlotAt(agent, index, compact, roomPixelWidth, baseY, sofaColumns = null) {
        const tile = sceneTileSize(compact);
        const defaultLayout = recRoomSofaLayout(compact, roomPixelWidth, baseY);
        const requestedLayout = sofaColumns
          ? {
              sofaWidth: tile * 2,
              sofas: [
                { ...defaultLayout.sofas[0], x: sofaColumns.left * tile, y: baseY },
                { ...defaultLayout.sofas[1], x: sofaColumns.right * tile, y: baseY }
              ]
            }
          : null;
        const layout =
          requestedLayout
          && Math.abs(requestedLayout.sofas[1].x - requestedLayout.sofas[0].x) >= tile * 3
            ? requestedLayout
            : defaultLayout;
        const seatIndex = index % 4;
        const sofa = layout.sofas[Math.floor(seatIndex / 2)];
        const seatWithinSofa = seatIndex % 2;
        const avatar = avatarForAgent(agent);
        const avatarScale = compact ? 1.25 : 1.5;
        const avatarHeight = Math.round(avatar.h * avatarScale);
        const sofaWidth = Number(sofa?.sprite?.w) || layout.sofaWidth;
        const seatOffsetRatio = seatWithinSofa === 0 ? 0.18 : 0.62;
        const x = sofa.x + Math.round(sofaWidth * seatOffsetRatio);
        const y = sofa.y - Math.round(avatarHeight * 0.28);
        return {
          x,
          y,
          flip: seatWithinSofa === 1,
          settle: true
        };
      }`
);

const CLIENT_RUNTIME_SETTINGS_SOURCE_WITH_BOUNDED_REC_SLOTS = patchRuntimeSection(
  CLIENT_RUNTIME_SETTINGS_SOURCE,
  "bounded rec slot memory",
  `      function stableSceneSlotAssignments(projectRoot, category, agents) {
        const memoryKey = String(projectRoot) + "::" + String(category);
        const previous = recSlotMemory.get(memoryKey) || new Map();
        const next = new Map();
        const assignments = [];
        const agentById = new Map(agents.map((agent) => [agent.id, agent]));
        const usedIndexes = new Set();

        for (const [agentId, slotIndex] of previous.entries()) {
          const agent = agentById.get(agentId);
          if (!agent || !Number.isFinite(slotIndex) || usedIndexes.has(slotIndex)) {
            continue;
          }
          next.set(agentId, slotIndex);
          usedIndexes.add(slotIndex);
          assignments.push({ agent, slotIndex });
        }

        let nextSlotIndex = 0;
        for (const agent of agents) {
          if (next.has(agent.id)) {
            continue;
          }
          while (usedIndexes.has(nextSlotIndex)) {
            nextSlotIndex += 1;
          }
          next.set(agent.id, nextSlotIndex);
          usedIndexes.add(nextSlotIndex);
          assignments.push({ agent, slotIndex: nextSlotIndex });
          nextSlotIndex += 1;
        }

        recSlotMemory.set(memoryKey, next);
        return assignments.sort((left, right) => left.slotIndex - right.slotIndex);
      }`,
  `      function stableSceneSlotAssignments(projectRoot, category, agents, maxSlots = null) {
        const memoryKey = String(projectRoot) + "::" + String(category);
        const previous = recSlotMemory.get(memoryKey) || new Map();
        const next = new Map();
        const assignments = [];
        const agentById = new Map(agents.map((agent) => [agent.id, agent]));
        const usedIndexes = new Set();
        const slotLimit = Number.isFinite(maxSlots) ? Math.max(0, Math.floor(maxSlots)) : null;

        for (const [agentId, slotIndex] of previous.entries()) {
          const agent = agentById.get(agentId);
          if (
            !agent
            || !Number.isFinite(slotIndex)
            || usedIndexes.has(slotIndex)
            || (slotLimit !== null && slotIndex >= slotLimit)
          ) {
            continue;
          }
          next.set(agentId, slotIndex);
          usedIndexes.add(slotIndex);
          assignments.push({ agent, slotIndex });
        }

        let nextSlotIndex = 0;
        for (const agent of agents) {
          if (next.has(agent.id)) {
            continue;
          }
          while (usedIndexes.has(nextSlotIndex)) {
            nextSlotIndex += 1;
          }
          if (slotLimit !== null && nextSlotIndex >= slotLimit) {
            break;
          }
          next.set(agent.id, nextSlotIndex);
          usedIndexes.add(nextSlotIndex);
          assignments.push({ agent, slotIndex: nextSlotIndex });
          nextSlotIndex += 1;
        }

        recSlotMemory.set(memoryKey, next);
        return assignments.sort((left, right) => left.slotIndex - right.slotIndex);
      }`
);

const RUNTIME_SECTIONS = [
  CLIENT_RUNTIME_BOOTSTRAP_SOURCE,
  CLIENT_RUNTIME_SETTINGS_SOURCE_WITH_BOUNDED_REC_SLOTS,
  SCENE_GRID_SCRIPT,
  TOAST_SCRIPT,
  MULTIPLAYER_SCRIPT,
  CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_DISPLAY_PATH_SCAN,
  CLIENT_RUNTIME_SEATING_SOURCE,
  CLIENT_RUNTIME_RENDER_SOURCE_WITH_SAFE_REC_SEATS,
  CLIENT_RUNTIME_MESSAGE_FILTER_SOURCE,
  CLIENT_RUNTIME_SCENE_SOURCE_WITH_BOUNDED_REC_ASSIGNMENTS,
  CLIENT_RUNTIME_NAVIGATION_SOURCE_FINAL,
  CLIENT_RUNTIME_UI_SOURCE_FINAL
];

export const CLIENT_RUNTIME_SOURCE = RUNTIME_SECTIONS.join("");
