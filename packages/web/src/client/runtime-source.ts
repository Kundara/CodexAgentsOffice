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
  `              const padX = compact ? 8 : 10;
              const centerGap = 0;
              const cellWidth = Math.max(compact ? 44 : 58, Math.floor((entry.slot.width - padX * 2 - centerGap) / 2));
              const hasBothSides = Boolean(entry.agents[0] && entry.agents[1]);
              const leftCellX = padX;
              const rightCellX = padX + cellWidth + centerGap;
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

const CLIENT_RUNTIME_SCENE_SOURCE = patchRuntimeSection(
  CLIENT_RUNTIME_SCENE_SOURCE_WITH_STABLE_DESK_MIRROR_STATE,
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
            const innerPadX = compact ? 10 : 12;
            const cellWidth = Math.max(
              compact ? 36 : 40,
              Math.min(entry.slot.width - innerPadX * 2, compact ? 44 : 48)
            );
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

const CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_RELATIONSHIP_LINES = patchRuntimeSection(
  CLIENT_RUNTIME_NAVIGATION_SOURCE,
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

const CLIENT_RUNTIME_NAVIGATION_SOURCE_FINAL = patchRuntimeSection(
  CLIENT_RUNTIME_NAVIGATION_SOURCE_WITH_RELATIONSHIP_LINES,
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

const CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_DISPLAY_MARKDOWN = patchRuntimeSection(
  CLIENT_RUNTIME_LAYOUT_SOURCE,
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

const RUNTIME_SECTIONS = [
  CLIENT_RUNTIME_BOOTSTRAP_SOURCE,
  CLIENT_RUNTIME_SETTINGS_SOURCE,
  SCENE_GRID_SCRIPT,
  TOAST_SCRIPT,
  MULTIPLAYER_SCRIPT,
  CLIENT_RUNTIME_LAYOUT_SOURCE_WITH_DISPLAY_PATH_SCAN,
  CLIENT_RUNTIME_SEATING_SOURCE,
  CLIENT_RUNTIME_RENDER_SOURCE_WITH_DISPLAY_MARKDOWN,
  CLIENT_RUNTIME_MESSAGE_FILTER_SOURCE,
  CLIENT_RUNTIME_SCENE_SOURCE,
  CLIENT_RUNTIME_NAVIGATION_SOURCE_FINAL,
  CLIENT_RUNTIME_UI_SOURCE
];

export const CLIENT_RUNTIME_SOURCE = RUNTIME_SECTIONS.join("");
