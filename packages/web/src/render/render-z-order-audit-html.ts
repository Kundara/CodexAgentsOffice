import { PIXEL_OFFICE_MANIFEST } from "../pixel-office";
import { INTERNAL_SCENE_SETTINGS } from "../scene-config";

type AuditMode = {
  id: "monitor" | "desk" | "front";
  label: string;
  note: string;
};

const AUDIT_MODES: AuditMode[] = [
  { id: "monitor", label: "Monitor Bottom", note: "Old workstation-only anchor" },
  { id: "desk", label: "Desk Front", note: "Desk panel front plane" },
  { id: "front", label: "Front Edge", note: "Current runtime: max(desk, monitor) + occlusion inset" }
];

const AUDIT_DELTAS = [-10, -6, -2, 2, 6, 10];

const AUDIT_SPRITES = {
  avatar: PIXEL_OFFICE_MANIFEST.avatars.find((entry) => entry.id === "nova") ?? PIXEL_OFFICE_MANIFEST.avatars[0],
  desk: PIXEL_OFFICE_MANIFEST.props.cubiclePanelLeft,
  workstation: PIXEL_OFFICE_MANIFEST.props.workstation
};

const BOOTH_WIDTH = INTERNAL_SCENE_SETTINGS.deskPodWidthTiles * INTERNAL_SCENE_SETTINGS.compactTileSizePx;
const BOOTH_HEIGHT = INTERNAL_SCENE_SETTINGS.deskPodHeightTiles * INTERNAL_SCENE_SETTINGS.compactTileSizePx;
const AUDIT_PADDING_X = 12;
const AUDIT_PADDING_TOP = 10;
const AUDIT_PADDING_BOTTOM = 28;
const AUDIT_SCALE = 3;

function fitSpriteToWidth(sprite: { w: number }, width: number, minScale: number, maxScale: number): number {
  return Math.max(minScale, Math.min(maxScale, width / sprite.w));
}

function pixelSnap(value: number, step = 1): number {
  const unit = Number.isFinite(step) && step > 0 ? step : 1;
  return Math.round(Number(value) / unit) * unit;
}

function sceneFootDepth(y: number, height: number, bias = 0, tileSize = INTERNAL_SCENE_SETTINGS.compactTileSizePx): number {
  const footY = Number(y) + Number(height);
  const unit = Number.isFinite(tileSize) && tileSize > 0 ? Number(tileSize) : INTERNAL_SCENE_SETTINGS.compactTileSizePx;
  const tileRow = Math.floor(footY / unit);
  const intraTileY = footY - tileRow * unit;
  return (1000 + tileRow) * 1000000 + Math.round(intraTileY * 1000) + (Number.isFinite(bias) ? Number(bias) : 0);
}

function spriteBox(
  x: number,
  y: number,
  width: number,
  height: number,
  z: number
): { x: number; y: number; width: number; height: number } {
  const deskShellScale = z >= 7 && z <= 9 ? 0.86 : 1;
  const deskShellLift = z === 8 ? 4 : 0;
  const snappedWidth = pixelSnap(width * deskShellScale, 1);
  const snappedHeight = pixelSnap(height * deskShellScale, 1);
  const offsetX = pixelSnap((width - snappedWidth) / 2);
  const offsetY = pixelSnap(height - snappedHeight) - deskShellLift;
  return {
    x: pixelSnap(x) + offsetX,
    y: pixelSnap(y) + offsetY,
    width: snappedWidth,
    height: snappedHeight
  };
}

function buildAuditGeometry(mode: AuditMode, delta: number) {
  const avatarScale = 1.25;
  const deskScale = fitSpriteToWidth(AUDIT_SPRITES.desk, BOOTH_WIDTH * 0.18, 1.28, 1.44);
  const workstationScale = fitSpriteToWidth(AUDIT_SPRITES.workstation, BOOTH_WIDTH * 0.21, 1.32, 1.68);
  const deskWidth = AUDIT_SPRITES.desk.w * deskScale;
  const deskHeight = AUDIT_SPRITES.desk.h * deskScale;
  const workstationWidth = AUDIT_SPRITES.workstation.w * workstationScale;
  const workstationHeight = AUDIT_SPRITES.workstation.h * workstationScale;
  const avatarWidth = AUDIT_SPRITES.avatar.w * avatarScale;
  const avatarHeight = AUDIT_SPRITES.avatar.h * avatarScale;
  const centerInset = 4;
  const workstationX = Math.round(BOOTH_WIDTH - workstationWidth - centerInset);
  const deskX = Math.max(2, Math.round(workstationX + workstationWidth * 0.48 - deskWidth * 0.5));
  const deskY = Math.round(BOOTH_HEIGHT - deskHeight - 11 + INTERNAL_SCENE_SETTINGS.compactTileSizePx);
  const workstationY = Math.round(deskY - workstationHeight * 0.2);
  const deskDepthFootY = deskY + deskHeight;
  const workstationDepthFootY = workstationY + workstationHeight;
  const workstationOcclusionInset = 3;
  const workstationFrontDepthFootY = Math.max(deskDepthFootY, workstationDepthFootY) + workstationOcclusionInset;
  const workstationAnchor = mode.id === "monitor"
    ? workstationDepthFootY
    : mode.id === "desk"
      ? deskDepthFootY
      : workstationFrontDepthFootY;
  const avatarFootY = workstationFrontDepthFootY + delta;
  const avatarX = Math.round(workstationX + workstationWidth * 0.08);
  const avatarY = avatarFootY - avatarHeight;
  const deskSprite = spriteBox(deskX, deskY, AUDIT_SPRITES.desk.w * deskScale, AUDIT_SPRITES.desk.h * deskScale, 7);
  const workstationSprite = spriteBox(
    workstationX,
    workstationY,
    AUDIT_SPRITES.workstation.w * workstationScale,
    AUDIT_SPRITES.workstation.h * workstationScale,
    9
  );
  const avatarSprite = spriteBox(avatarX, avatarY, avatarWidth, avatarHeight, 12);

  return {
    delta,
    deskDepthFootY,
    workstationDepthFootY,
    workstationFrontDepthFootY,
    workstationAnchor,
    avatarFootY,
    deskSprite: {
      ...deskSprite,
      zIndex: sceneFootDepth(deskDepthFootY - deskSprite.height, deskSprite.height, 0)
    },
    workstationSprite: {
      ...workstationSprite,
      zIndex: sceneFootDepth(workstationAnchor - workstationSprite.height, workstationSprite.height, 10)
    },
    avatarSprite: {
      ...avatarSprite,
      zIndex: sceneFootDepth(avatarFootY - avatarSprite.height, avatarSprite.height, 0)
    }
  };
}

function renderCell(mode: AuditMode, delta: number): string {
  const geometry = buildAuditGeometry(mode, delta);
  const deltaLabel = `${delta > 0 ? "+" : ""}${delta}`;
  const stageWidth = BOOTH_WIDTH + AUDIT_PADDING_X * 2;
  const stageHeight = Math.max(
    BOOTH_HEIGHT + AUDIT_PADDING_TOP + AUDIT_PADDING_BOTTOM,
    Math.ceil(Math.max(geometry.avatarFootY + 12, geometry.workstationAnchor + 12) + AUDIT_PADDING_TOP)
  );
  const viewportWidth = stageWidth * AUDIT_SCALE;
  const viewportHeight = stageHeight * AUDIT_SCALE;

  return `
    <article class="audit-cell ${mode.id === "front" ? "is-current" : ""}">
      <header class="audit-cell-head">
        <div>
          <div class="audit-mode">${mode.label}</div>
          <div class="audit-note">${mode.note}</div>
        </div>
        <div class="audit-delta ${delta > 0 ? "is-front" : "is-back"}">delta ${deltaLabel}</div>
      </header>
      <div class="audit-stage" style="width:${viewportWidth}px;height:${viewportHeight}px;">
        <div class="audit-stage-world" style="width:${stageWidth}px;height:${stageHeight}px;transform:scale(${AUDIT_SCALE});">
          <div class="audit-lane" style="left:${AUDIT_PADDING_X}px;right:${AUDIT_PADDING_X}px;top:${AUDIT_PADDING_TOP + Math.round(BOOTH_HEIGHT * 0.58)}px;"></div>
          <div class="audit-line audit-line-workstation" style="left:${AUDIT_PADDING_X}px;right:${AUDIT_PADDING_X}px;top:${AUDIT_PADDING_TOP + geometry.workstationAnchor}px;"></div>
          <div class="audit-line audit-line-avatar" style="left:${AUDIT_PADDING_X}px;right:${AUDIT_PADDING_X}px;top:${AUDIT_PADDING_TOP + geometry.avatarFootY}px;"></div>
          <div class="audit-line-label audit-line-label-workstation" style="left:${AUDIT_PADDING_X + 2}px;top:${Math.max(0, AUDIT_PADDING_TOP + geometry.workstationAnchor - 14)}px;">
            workstation ${Math.round(geometry.workstationAnchor)}
          </div>
          <div class="audit-line-label audit-line-label-avatar" style="left:${AUDIT_PADDING_X + 2}px;top:${Math.min(stageHeight - 12, AUDIT_PADDING_TOP + geometry.avatarFootY + 2)}px;">
            avatar ${Math.round(geometry.avatarFootY)}
          </div>
          <img
            class="audit-sprite"
            src="${AUDIT_SPRITES.desk.url}"
            alt=""
            style="left:${AUDIT_PADDING_X + geometry.deskSprite.x}px;top:${AUDIT_PADDING_TOP + geometry.deskSprite.y}px;width:${geometry.deskSprite.width}px;height:${geometry.deskSprite.height}px;z-index:${geometry.deskSprite.zIndex};"
          />
          <img
            class="audit-sprite"
            src="${AUDIT_SPRITES.workstation.url}"
            alt=""
            style="left:${AUDIT_PADDING_X + geometry.workstationSprite.x}px;top:${AUDIT_PADDING_TOP + geometry.workstationSprite.y}px;width:${geometry.workstationSprite.width}px;height:${geometry.workstationSprite.height}px;z-index:${geometry.workstationSprite.zIndex};"
          />
          <img
            class="audit-sprite"
            src="${AUDIT_SPRITES.avatar.url}"
            alt=""
            style="left:${AUDIT_PADDING_X + geometry.avatarSprite.x}px;top:${AUDIT_PADDING_TOP + geometry.avatarSprite.y}px;width:${geometry.avatarSprite.width}px;height:${geometry.avatarSprite.height}px;z-index:${geometry.avatarSprite.zIndex};"
          />
        </div>
      </div>
      <footer class="audit-cell-meta">
        <span>desk ${Math.round(geometry.deskDepthFootY)}</span>
        <span>monitor ${Math.round(geometry.workstationDepthFootY)}</span>
        <span>front ${Math.round(geometry.workstationFrontDepthFootY)}</span>
      </footer>
    </article>
  `;
}

function renderGrid(): string {
  return AUDIT_DELTAS.map((delta) => `
    <div class="audit-row">
      ${AUDIT_MODES.map((mode) => renderCell(mode, delta)).join("")}
    </div>
  `).join("");
}

function renderSweepCell(mode: AuditMode): string {
  const geometry = buildAuditGeometry(mode, 0);
  const stageWidth = BOOTH_WIDTH + AUDIT_PADDING_X * 2;
  const stageHeight = Math.max(
    BOOTH_HEIGHT + AUDIT_PADDING_TOP + AUDIT_PADDING_BOTTOM,
    Math.ceil(Math.max(geometry.workstationFrontDepthFootY + 16, geometry.workstationAnchor + 16) + AUDIT_PADDING_TOP)
  );
  const viewportWidth = stageWidth * AUDIT_SCALE;
  const viewportHeight = stageHeight * AUDIT_SCALE;

  return `
    <article
      class="audit-cell audit-sweep-cell ${mode.id === "front" ? "is-current" : ""}"
      data-sweep
      data-mode="${mode.id}"
      data-padding-x="${AUDIT_PADDING_X}"
      data-padding-top="${AUDIT_PADDING_TOP}"
      data-stage-height="${stageHeight}"
      data-front-anchor="${geometry.workstationFrontDepthFootY}"
      data-workstation-anchor="${geometry.workstationAnchor}"
      data-avatar-x="${geometry.avatarSprite.x}"
      data-avatar-height="${geometry.avatarSprite.height}"
      data-avatar-width="${geometry.avatarSprite.width}"
      data-avatar-bias="0"
      data-workstation-height="${geometry.workstationSprite.height}"
      data-workstation-z="${geometry.workstationSprite.zIndex}"
    >
      <header class="audit-cell-head">
        <div>
          <div class="audit-mode">${mode.label}</div>
          <div class="audit-note">${mode.note}</div>
        </div>
        <div class="audit-delta audit-sweep-status">delta +0</div>
      </header>
      <div class="audit-stage" style="width:${viewportWidth}px;height:${viewportHeight}px;">
        <div class="audit-stage-world" style="width:${stageWidth}px;height:${stageHeight}px;transform:scale(${AUDIT_SCALE});">
          <div class="audit-lane" style="left:${AUDIT_PADDING_X}px;right:${AUDIT_PADDING_X}px;top:${AUDIT_PADDING_TOP + Math.round(BOOTH_HEIGHT * 0.58)}px;"></div>
          <div class="audit-line audit-line-workstation" style="left:${AUDIT_PADDING_X}px;right:${AUDIT_PADDING_X}px;top:${AUDIT_PADDING_TOP + geometry.workstationAnchor}px;"></div>
          <div class="audit-line audit-line-front" style="left:${AUDIT_PADDING_X}px;right:${AUDIT_PADDING_X}px;top:${AUDIT_PADDING_TOP + geometry.workstationFrontDepthFootY}px;"></div>
          <div
            class="audit-line audit-line-avatar audit-line-avatar-live"
            style="left:${AUDIT_PADDING_X}px;right:${AUDIT_PADDING_X}px;top:${AUDIT_PADDING_TOP + geometry.workstationFrontDepthFootY}px;"
          ></div>
          <div class="audit-line-label audit-line-label-workstation" style="left:${AUDIT_PADDING_X + 2}px;top:${Math.max(0, AUDIT_PADDING_TOP + geometry.workstationAnchor - 14)}px;">
            workstation ${Math.round(geometry.workstationAnchor)}
          </div>
          <div class="audit-line-label audit-line-label-front" style="left:${stageWidth - 72}px;top:${Math.max(0, AUDIT_PADDING_TOP + geometry.workstationFrontDepthFootY - 14)}px;">
            front ${Math.round(geometry.workstationFrontDepthFootY)}
          </div>
          <div
            class="audit-line-label audit-line-label-avatar audit-line-label-avatar-live"
            style="left:${AUDIT_PADDING_X + 2}px;top:${Math.min(stageHeight - 12, AUDIT_PADDING_TOP + geometry.workstationFrontDepthFootY + 2)}px;"
          >
            avatar ${Math.round(geometry.workstationFrontDepthFootY)}
          </div>
          <img
            class="audit-sprite"
            src="${AUDIT_SPRITES.desk.url}"
            alt=""
            style="left:${AUDIT_PADDING_X + geometry.deskSprite.x}px;top:${AUDIT_PADDING_TOP + geometry.deskSprite.y}px;width:${geometry.deskSprite.width}px;height:${geometry.deskSprite.height}px;z-index:${geometry.deskSprite.zIndex};"
          />
          <img
            class="audit-sprite"
            src="${AUDIT_SPRITES.workstation.url}"
            alt=""
            style="left:${AUDIT_PADDING_X + geometry.workstationSprite.x}px;top:${AUDIT_PADDING_TOP + geometry.workstationSprite.y}px;width:${geometry.workstationSprite.width}px;height:${geometry.workstationSprite.height}px;z-index:${geometry.workstationSprite.zIndex};"
          />
          <img
            class="audit-sprite audit-sprite-avatar"
            src="${AUDIT_SPRITES.avatar.url}"
            alt=""
            style="left:${AUDIT_PADDING_X + geometry.avatarSprite.x}px;top:${AUDIT_PADDING_TOP + geometry.avatarSprite.y}px;width:${geometry.avatarSprite.width}px;height:${geometry.avatarSprite.height}px;z-index:${geometry.avatarSprite.zIndex};"
          />
        </div>
      </div>
      <footer class="audit-cell-meta">
        <span class="audit-sweep-order">avatar matches front edge</span>
        <span>desk ${Math.round(geometry.deskDepthFootY)}</span>
        <span>monitor ${Math.round(geometry.workstationDepthFootY)}</span>
      </footer>
    </article>
  `;
}

function renderSweepSection(): string {
  return `
    <section class="panel audit-shell sweep-shell">
      <div class="sweep-copy">
        <h2>Motion Sweep</h2>
        <p>This is the walking case. The red feet line oscillates above and below the workstation front edge while z-order is recomputed every frame with the same <code>sceneFootDepth()</code> math the client runtime uses.</p>
      </div>
      <div class="audit-row">
        ${AUDIT_MODES.map((mode) => renderSweepCell(mode)).join("")}
      </div>
    </section>
  `;
}

export function renderZOrderAuditHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agents Office Tower Z-Order Audit</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #d7ebff;
        --panel: rgba(249, 251, 255, 0.92);
        --ink: #173042;
        --muted: #5a7383;
        --line: rgba(23, 48, 66, 0.12);
        --accent: #ff9b54;
        --danger: #d83a2f;
        --ok: #16794f;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background:
          radial-gradient(circle at top, rgba(255, 255, 255, 0.8), transparent 34%),
          linear-gradient(180deg, #cae3fb 0%, var(--bg) 100%);
        color: var(--ink);
        font: 14px/1.45 "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 24px 18px 30px;
      }

      h1,
      p {
        margin: 0;
      }

      h1 {
        font-size: 28px;
        letter-spacing: -0.03em;
      }

      .panel {
        background: var(--panel);
        border: 1px solid rgba(23, 48, 66, 0.12);
        border-radius: 18px;
        box-shadow: 0 18px 36px rgba(23, 48, 66, 0.12);
      }

      .hero {
        padding: 20px;
        display: grid;
        gap: 10px;
        margin-bottom: 16px;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid rgba(23, 48, 66, 0.12);
        background: rgba(255, 255, 255, 0.88);
        color: var(--muted);
      }

      .pill strong {
        color: var(--ink);
      }

      .audit-shell {
        padding: 16px;
      }

      .sweep-shell {
        display: grid;
        gap: 16px;
        margin-bottom: 16px;
      }

      .sweep-copy {
        display: grid;
        gap: 6px;
      }

      .sweep-copy h2 {
        margin: 0;
        font-size: 18px;
      }

      .audit-grid {
        display: grid;
        gap: 12px;
      }

      .audit-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }

      .audit-cell {
        background: rgba(247, 251, 255, 0.92);
        border: 1px solid rgba(23, 48, 66, 0.1);
        border-radius: 16px;
        padding: 12px;
        display: grid;
        gap: 10px;
      }

      .audit-cell.is-current {
        background: rgba(255, 247, 224, 0.96);
      }

      .audit-cell-head,
      .audit-cell-meta {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }

      .audit-mode {
        font-size: 12px;
        font-weight: 700;
      }

      .audit-note {
        color: var(--muted);
        font-size: 11px;
      }

      .audit-delta {
        border-radius: 999px;
        padding: 3px 8px;
        font: 700 11px/1 "IBM Plex Mono", monospace;
        border: 1px solid rgba(23, 48, 66, 0.12);
      }

      .audit-delta.is-back {
        background: rgba(216, 58, 47, 0.08);
        color: #97261d;
      }

      .audit-delta.is-front {
        background: rgba(22, 121, 79, 0.1);
        color: #115638;
      }

      .audit-stage {
        position: relative;
        margin: 0 auto;
        border-radius: 10px;
        overflow: hidden;
        background: linear-gradient(180deg, #5eace6 0%, #529fe0 100%);
        border: 1px solid rgba(23, 48, 66, 0.12);
      }

      .audit-stage-world {
        position: absolute;
        left: 0;
        top: 0;
        transform-origin: top left;
      }

      .audit-lane {
        position: absolute;
        height: 4px;
        background: rgba(132, 217, 255, 0.8);
      }

      .audit-line {
        position: absolute;
        height: 2px;
      }

      .audit-line-workstation {
        background: var(--accent);
      }

      .audit-line-avatar {
        background: var(--danger);
      }

      .audit-line-front {
        background: rgba(255, 255, 255, 0.95);
        border-top: 1px dashed rgba(23, 48, 66, 0.45);
      }

      .audit-line-label {
        position: absolute;
        padding: 1px 4px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.82);
        font: 700 8px/1 "IBM Plex Mono", monospace;
      }

      .audit-line-label-workstation {
        color: #8a4d15;
      }

      .audit-line-label-avatar {
        color: #8f241d;
      }

      .audit-line-label-front {
        color: #315267;
      }

      .audit-sprite {
        position: absolute;
        image-rendering: pixelated;
        user-select: none;
        pointer-events: none;
      }

      .audit-cell-meta {
        color: var(--muted);
        font: 11px/1.3 "IBM Plex Mono", monospace;
      }

      .legend {
        display: grid;
        gap: 8px;
        margin-top: 14px;
        color: var(--muted);
      }

      code {
        font-family: "IBM Plex Mono", "Consolas", monospace;
        font-size: 13px;
      }

      .audit-sweep-order {
        color: var(--ink);
        font-weight: 700;
      }

      @media (max-width: 980px) {
        .audit-row {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="panel hero">
        <h1>Z-Order Audit</h1>
        <p>Negative row deltas mean the avatar feet are higher on screen than the workstation front and should render behind it. Positive deltas mean the avatar should render in front.</p>
        <div class="meta">
          <span class="pill"><strong>Monitor Bottom</strong> old workstation-only anchor</span>
          <span class="pill"><strong>Desk Front</strong> desk panel front plane</span>
          <span class="pill"><strong>Front Edge</strong> current runtime mode</span>
        </div>
      </section>
      ${renderSweepSection()}
      <section class="panel audit-shell">
        <div class="audit-grid">
          ${renderGrid()}
        </div>
        <div class="legend">
          <div><code>orange</code> workstation anchor line</div>
          <div><code>red</code> avatar feet line</div>
          <div><code>white dashed</code> current front-edge line used by the runtime</div>
          <div>This page uses the same <code>sceneFootDepth()</code> math as the app. Pixi still sorts by <code>zIndex</code>; the point here is to compare the anchor planes directly.</div>
          <div>Audit route: <code>/z-order-audit</code></div>
        </div>
      </section>
    </main>
    <script>
      (() => {
        const cells = Array.from(document.querySelectorAll("[data-sweep]"));
        if (cells.length === 0) {
          return;
        }
        const sceneFootDepth = (y, height, bias = 0) => (1000 + Number(y) + Number(height)) * 1000 + (Number.isFinite(bias) ? Number(bias) : 0);
        const deltaLimit = 12;
        const speed = 0.00125;
        const updateCell = (cell, delta) => {
          const paddingX = Number(cell.dataset.paddingX || 0);
          const paddingTop = Number(cell.dataset.paddingTop || 0);
          const stageHeight = Number(cell.dataset.stageHeight || 0);
          const frontAnchor = Number(cell.dataset.frontAnchor || 0);
          const workstationAnchor = Number(cell.dataset.workstationAnchor || 0);
          const workstationZ = Number(cell.dataset.workstationZ || 0);
          const avatarX = Number(cell.dataset.avatarX || 0);
          const avatarHeight = Number(cell.dataset.avatarHeight || 0);
          const avatarWidth = Number(cell.dataset.avatarWidth || 0);
          const avatarBias = Number(cell.dataset.avatarBias || 0);
          const avatarFootY = frontAnchor + delta;
          const avatarTopY = avatarFootY - avatarHeight;
          const avatarZ = sceneFootDepth(avatarTopY, avatarHeight, avatarBias);
          const avatarSprite = cell.querySelector(".audit-sprite-avatar");
          const avatarLine = cell.querySelector(".audit-line-avatar-live");
          const avatarLabel = cell.querySelector(".audit-line-label-avatar-live");
          const status = cell.querySelector(".audit-sweep-status");
          const order = cell.querySelector(".audit-sweep-order");
          const deltaLabel = delta > 0 ? "+" + delta : String(delta);
          const shouldBeBehind = avatarFootY < workstationAnchor;
          const rendersBehind = avatarZ < workstationZ;
          const statusClass = delta < 0 ? "is-back" : delta > 0 ? "is-front" : "";
          if (avatarSprite) {
            avatarSprite.style.left = paddingX + avatarX + "px";
            avatarSprite.style.top = paddingTop + avatarTopY + "px";
            avatarSprite.style.width = avatarWidth + "px";
            avatarSprite.style.height = avatarHeight + "px";
            avatarSprite.style.zIndex = String(avatarZ);
          }
          if (avatarLine) {
            avatarLine.style.top = paddingTop + avatarFootY + "px";
          }
          if (avatarLabel) {
            avatarLabel.textContent = "avatar " + Math.round(avatarFootY);
            avatarLabel.style.top = Math.min(stageHeight - 12, paddingTop + avatarFootY + 2) + "px";
          }
          if (status) {
            status.textContent = "delta " + deltaLabel;
            status.className = "audit-delta audit-sweep-status" + (statusClass ? " " + statusClass : "");
          }
          if (order) {
            const verdict = shouldBeBehind
              ? (rendersBehind ? "avatar stays behind workstation" : "avatar incorrectly jumps in front")
              : (rendersBehind ? "avatar is still behind at crossover" : "avatar moves in front");
            order.textContent = verdict;
            order.style.color = shouldBeBehind === rendersBehind ? "var(--ok)" : "var(--danger)";
          }
        };
        const tick = (now) => {
          const delta = Math.round(Math.sin(now * speed) * deltaLimit);
          cells.forEach((cell) => updateCell(cell, delta));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })();
    </script>
  </body>
</html>`;
}
