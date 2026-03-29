export const CLIENT_RUNTIME_NAVIGATION_SOURCE = `      function officeAvatarPositionForTile(room, tileSize, tilePoint, width, height) {
        return {
          x: room.x + tilePoint.column * tileSize + Math.round((tileSize - width) / 2),
          y: room.floorTop + (tilePoint.row + 1) * tileSize - height
        };
      }

      function officeAvatarPositionForFacility(room, tileSize, serviceTile, width, height) {
        const position = officeAvatarPositionForTile(room, tileSize, serviceTile, width, height);
        const approachOffset = serviceTile && serviceTile.approachOffsetPx ? serviceTile.approachOffsetPx : null;
        if (!approachOffset) {
          return position;
        }
        return {
          x: position.x + (Number.isFinite(approachOffset.x) ? Number(approachOffset.x) : 0),
          y: position.y + (Number.isFinite(approachOffset.y) ? Number(approachOffset.y) : 0)
        };
      }

      function roomDoorTile(room, tileSize) {
        return {
          column: Math.max(0, Math.min(Math.floor(room.width / tileSize) - 1, Math.floor(room.width / tileSize / 2))),
          row: 0
        };
      }

      function markNavigationRect(grid, startColumn, startRow, widthTiles, heightTiles) {
        for (let row = startRow; row < startRow + heightTiles; row += 1) {
          if (!grid[row]) {
            continue;
          }
          for (let column = startColumn; column < startColumn + widthTiles; column += 1) {
            if (grid[row][column] === undefined) {
              continue;
            }
            grid[row][column] = 1;
          }
        }
      }

      function buildOfficeNavigation(model) {
        const roomById = new Map(model.rooms.map((room) => [room.id, room]));
        const navigation = new Map();
        model.rooms.forEach((room) => {
          const columns = Math.max(1, Math.round(room.width / model.tile));
          const rows = Math.max(1, Math.round((room.height - room.wallHeight) / model.tile));
          navigation.set(room.id, {
            room,
            columns,
            rows,
            grid: Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0))
          });
        });

        model.tileObjects.forEach((object) => {
          if (!object || object.anchor === "wall") {
            return;
          }
          const nav = navigation.get(object.roomId);
          if (!nav) {
            return;
          }
          markNavigationRect(nav.grid, object.column, Math.max(0, object.baseRow), Math.max(1, object.widthTiles), Math.max(1, object.heightTiles));
        });

        model.workstations.forEach((workstation) => {
          const nav = navigation.get(workstation.roomId);
          const room = roomById.get(workstation.roomId);
          if (!nav || !room) {
            return;
          }
          const column = Math.max(0, Math.floor((workstation.x - room.x) / model.tile));
          const row = Math.max(0, Math.floor((workstation.y - room.floorTop) / model.tile));
          markNavigationRect(nav.grid, column, row, Math.max(1, workstation.tileWidth || 1), Math.max(1, workstation.tileHeight || 1));
        });

        return navigation;
      }

      function cloneNavigation(nav) {
        if (!nav) {
          return null;
        }
        return {
          ...nav,
          grid: nav.grid.map((row) => row.slice())
        };
      }

      function reserveAgentTiles(model, roomById) {
        const reservations = new Map();
        const collect = (agent) => {
          if (!agent || !(agent.key || agent.id)) {
            return;
          }
          const room = roomById.get(agent.roomId);
          const tilePoint = officeAvatarFootTile(room, model.tile, agent.x, agent.y, agent.width, agent.height);
          if (!tilePoint) {
            return;
          }
          reservations.set(agent.key || agent.id, {
            roomId: agent.roomId,
            column: tilePoint.column,
            row: tilePoint.row
          });
        };
        model.desks.forEach((desk) => desk.agents.forEach(collect));
        model.offices.forEach((office) => {
          if (office.agent) {
            collect(office.agent);
          }
        });
        model.recAgents.forEach(collect);
        return reservations;
      }

      function navigationForAgent(roomNavigation, reservations, roomId, agentKey) {
        const baseNav = roomNavigation.get(roomId);
        const nav = cloneNavigation(baseNav);
        if (!nav) {
          return null;
        }
        reservations.forEach((entry, key) => {
          if (!entry || key === agentKey || entry.roomId !== roomId) {
            return;
          }
          if (nav.grid[entry.row]?.[entry.column] !== undefined) {
            nav.grid[entry.row][entry.column] = 1;
          }
        });
        return nav;
      }

      function nearestWalkableTile(nav, desiredTile) {
        if (!nav || !desiredTile) {
          return null;
        }
        const inBounds = (column, row) => row >= 0 && row < nav.rows && column >= 0 && column < nav.columns;
        const walkable = (column, row) => inBounds(column, row) && nav.grid[row][column] === 0;
        if (walkable(desiredTile.column, desiredTile.row)) {
          return desiredTile;
        }
        for (let radius = 1; radius <= Math.max(nav.columns, nav.rows); radius += 1) {
          for (let row = desiredTile.row - radius; row <= desiredTile.row + radius; row += 1) {
            for (let column = desiredTile.column - radius; column <= desiredTile.column + radius; column += 1) {
              if (Math.abs(column - desiredTile.column) + Math.abs(row - desiredTile.row) > radius) {
                continue;
              }
              if (walkable(column, row)) {
                return { column, row };
              }
            }
          }
        }
        return null;
      }

      function solveEasyStarPath(nav, startTile, endTile) {
        const EasyStarConstructor = window.EasyStar && typeof window.EasyStar.js === "function"
          ? window.EasyStar.js
          : null;
        if (!EasyStarConstructor || !nav || !startTile || !endTile) {
          return null;
        }
        const pathfinder = new EasyStarConstructor();
        const grid = nav.grid.map((row) => row.slice());
        grid[startTile.row][startTile.column] = 0;
        grid[endTile.row][endTile.column] = 0;
        pathfinder.setGrid(grid);
        pathfinder.setAcceptableTiles([0]);
        pathfinder.setIterationsPerCalculation(Math.max(1000, nav.columns * nav.rows * 4));
        let resolved = false;
        let result = null;
        pathfinder.findPath(startTile.column, startTile.row, endTile.column, endTile.row, (path) => {
          result = Array.isArray(path) ? path : null;
          resolved = true;
        });
        let guard = 0;
        while (!resolved && guard < 128) {
          pathfinder.calculate();
          guard += 1;
        }
        return result;
      }

      function buildAgentPixelRoute(nav, startTile, endTile, room, tileSize, width, height, exactTarget) {
        if (!nav || !startTile || !endTile || !room) {
          return exactTarget ? [exactTarget] : [];
        }
        const tilePath = solveEasyStarPath(nav, startTile, endTile) || [startTile, endTile];
        const route = tilePath.map((step) =>
          officeAvatarPositionForTile(room, tileSize, { column: step.x ?? step.column, row: step.y ?? step.row }, width, height)
        );
        if (exactTarget) {
          const last = route[route.length - 1];
          if (!last || last.x !== exactTarget.x || last.y !== exactTarget.y) {
            route.push({ x: exactTarget.x, y: exactTarget.y });
          }
        }
        return route;
      }

      function syncAgentHitNodePosition(renderer, motionState) {
        if (!renderer || !motionState || !motionState.anchorNode) {
          return;
        }
        motionState.anchorNode.style.left = Math.round(motionState.currentX * renderer.scale) + "px";
        motionState.anchorNode.style.top = Math.round(motionState.currentY * renderer.scale) + "px";
        motionState.anchorNode.style.width = Math.max(8, Math.round(motionState.width * renderer.scale)) + "px";
        motionState.anchorNode.style.height = Math.max(8, Math.round(motionState.height * renderer.scale)) + "px";
      }

      function syncOfficeAnchors(renderer, model, scale) {
        const layer = renderer.anchorLayer;
        layer.innerHTML = "";
        renderer.agentHitNodes = new Map();
        model.anchors.forEach((anchor) => {
          const node = document.createElement("div");
          if (anchor.type === "agent") {
            node.className = "office-map-agent-hit";
            node.dataset.agentKey = anchor.key;
            node.dataset.focusAgent = "true";
            if (anchor.focusKey) {
              node.dataset.focusKey = anchor.focusKey;
            }
            if (Array.isArray(anchor.focusKeys)) {
              node.dataset.focusKeys = JSON.stringify(anchor.focusKeys);
            }
            node.style.left = Math.round((anchor.left ?? anchor.x) * scale) + "px";
            node.style.top = Math.round((anchor.top ?? anchor.y) * scale) + "px";
            node.style.width = Math.max(8, Math.round((anchor.width ?? 0) * scale)) + "px";
            node.style.height = Math.max(8, Math.round((anchor.height ?? 0) * scale)) + "px";
            node.innerHTML = anchor.hoverHtml || "";
            renderer.agentHitNodes.set(anchor.key, node);
          } else {
            node.className = "office-map-anchor";
            node.dataset.workstationKey = anchor.key;
            node.style.left = Math.round(anchor.x * scale) + "px";
            node.style.top = Math.round(anchor.y * scale) + "px";
          }
          layer.appendChild(node);
        });
        model.furniture.forEach((item) => {
          const node = document.createElement("div");
          node.className = "office-map-furniture-hit";
          node.dataset.furnitureId = item.id;
          node.dataset.roomId = item.roomId;
          node.style.left = Math.round(item.column * model.tile * scale) + "px";
          node.style.top = Math.round(model.rooms.find((room) => room.id === item.roomId).floorTop * scale) + "px";
          node.style.width = Math.round(item.widthTiles * model.tile * scale) + "px";
          node.style.height = Math.round(model.tile * scale) + "px";
          layer.appendChild(node);
        });
      }

      function sceneFootDepth(y, height, bias = 0, tileSize = 16, depthBaseY = 0, depthRow = null) {
        const footY = Number(y) + Number(height);
        const unit = Number.isFinite(tileSize) && tileSize > 0 ? Number(tileSize) : 16;
        const depthBase = Number.isFinite(depthBaseY) ? Number(depthBaseY) : 0;
        const relativeFootY = footY - depthBase;
        const tileRow = Number.isFinite(depthRow) ? Number(depthRow) : Math.floor(relativeFootY / unit);
        const intraTileY = relativeFootY - tileRow * unit;
        return (100000 + Math.round(depthBase)) * 1000000 + (1000 + tileRow) * 1000 + Math.round(intraTileY * 10) + (Number.isFinite(bias) ? Number(bias) : 0);
      }

      function applyFootDepth(node, y, height, bias = 0, tileSize = 16, depthBaseY = 0, depthRow = null) {
        if (!node) {
          return;
        }
        node.zIndex = sceneFootDepth(y, height, bias, tileSize, depthBaseY, depthRow);
      }

      function syncOfficeRendererScene(renderer, model) {
        if (!renderer || !renderer.root || !window.PIXI) {
          return;
        }
        renderer.model = model;
        const availableWidth = Math.max(Math.round(renderer.host.getBoundingClientRect().width || renderer.host.clientWidth || model.width), 1);
        const scale = Math.min(Math.max(availableWidth / model.width, 0.5), 3.5);
        const scaledWidth = Math.max(1, Math.min(availableWidth, Math.round(model.width * scale)));
        const scaledHeight = Math.max(180, Math.round(model.height * scale));
        const leftOffset = Math.max(0, Math.round((availableWidth - scaledWidth) / 2));
        renderer.scale = scale;
        renderer.leftOffset = leftOffset;
        renderer.host.style.height = scaledHeight + "px";
        renderer.canvasContainer.style.left = leftOffset + "px";
        renderer.canvasContainer.style.width = scaledWidth + "px";
        renderer.canvasContainer.style.height = scaledHeight + "px";
        renderer.anchorLayer.style.left = leftOffset + "px";
        renderer.anchorLayer.style.width = scaledWidth + "px";
        renderer.anchorLayer.style.height = scaledHeight + "px";
        renderer.app.renderer.resize(scaledWidth, scaledHeight);
        const previousMotionStates = new Map(renderer.motionStates || []);
        const previousDoorStates = new Map(renderer.roomDoorStates || []);
        renderer.motionStates = new Map();
        renderer.roomDoorStates = new Map();
        renderer.root.removeChildren();
        renderer.root.scale.set(scale, scale);
        renderer.animatedSprites = [];
        renderer.focusables = [];

        const PIXI = window.PIXI;
        const roomById = new Map(model.rooms.map((room) => [room.id, room]));
        const roomNavigation = buildOfficeNavigation(model);
        syncOfficeAnchors(renderer, model, scale);
        const reservedAgentTiles = reserveAgentTiles(model, roomById);
        renderer.roomById = roomById;
        renderer.roomNavigation = roomNavigation;
        renderer.reservedAgentTiles = reservedAgentTiles;
        renderer.debugWorkstationNodes = [];
        renderer.debugDepthWarnings = new Set();
        const workstationByKey = new Map(
          (Array.isArray(model.workstations) ? model.workstations : [])
            .filter((workstation) => workstation && workstation.key)
            .map((workstation) => [workstation.key, workstation])
        );
        const background = new PIXI.Graphics()
          .roundRect(0, 0, model.width, model.height, 14)
          .fill({ color: 0x0b1b2b })
          .stroke({ color: 0x2e5c7b, width: 2 });
        background.zIndex = 0;
        renderer.root.addChild(background);

        function parseSceneColor(value, fallback) {
          if (typeof value === "string" && value.startsWith("#")) {
            const parsed = Number.parseInt(value.slice(1), 16);
            if (Number.isFinite(parsed)) {
              return parsed;
            }
          }
          if (Number.isFinite(value)) {
            return Number(value);
          }
          return fallback;
        }

        function sceneDoorConfig() {
          const door = sceneDefinitions && sceneDefinitions.door ? sceneDefinitions.door : {};
          return {
            backdropColor: parseSceneColor(door.backdropColor, 0x071018),
            backdropAlpha: Number.isFinite(door.backdropAlpha) ? Number(door.backdropAlpha) : 0.96,
            holdOpenMs: Number.isFinite(door.holdOpenMs) ? Number(door.holdOpenMs) : 520,
            slideOffsetPx: Number.isFinite(door.slideOffsetPx) ? Number(door.slideOffsetPx) : 8
          };
        }

        function sceneIdleBehaviorConfig() {
          const idle = sceneDefinitions && sceneDefinitions.idleBehavior ? sceneDefinitions.idleBehavior : {};
          return {
            flipIntervalMs: idle.flipIntervalMs || { min: 1000, max: 12000 },
            facilityVisitIntervalMs: idle.facilityVisitIntervalMs || { min: 7000, max: 16000 },
            restingSpeedScale: Number.isFinite(idle.restingSpeedScale) ? Number(idle.restingSpeedScale) : 1,
            itemDurationMs: Number.isFinite(idle.itemDurationMs) ? Number(idle.itemDurationMs) : 15000,
            throwAwayDurationMs: Number.isFinite(idle.throwAwayDurationMs) ? Number(idle.throwAwayDurationMs) : 700,
            throwAwayJumpPx: Number.isFinite(idle.throwAwayJumpPx) ? Number(idle.throwAwayJumpPx) : 13
          };
        }

        function randomBetween(range, fallbackMin, fallbackMax) {
          const min = Number.isFinite(range?.min) ? Number(range.min) : fallbackMin;
          const max = Number.isFinite(range?.max) ? Number(range.max) : fallbackMax;
          if (max <= min) {
            return min;
          }
          return min + Math.round(Math.random() * (max - min));
        }

        function nextIdleFlipAt(now = performance.now()) {
          return now + randomBetween(sceneIdleBehaviorConfig().flipIntervalMs, 1000, 12000);
        }

        function nextIdleTripAt(now = performance.now()) {
          return now + randomBetween(sceneIdleBehaviorConfig().facilityVisitIntervalMs, 7000, 16000);
        }

        function isAutonomousRestingAgent(agent) {
          return agent && agent.kind === "resting" && (agent.state === "idle" || agent.state === "done");
        }

        function ensureHeldItemSprite(motionState) {
          const autonomy = motionState && motionState.autonomy ? motionState.autonomy : null;
          const itemDefinition = autonomy && autonomy.carriedItemId ? sceneHeldItemDefinition(autonomy.carriedItemId) : null;
          if (!itemDefinition) {
            if (motionState && motionState.heldItemSprite && motionState.heldItemSprite.parent) {
              motionState.heldItemSprite.parent.removeChild(motionState.heldItemSprite);
              motionState.heldItemSprite.destroy?.();
            }
            if (motionState) {
              motionState.heldItemSprite = null;
            }
            return null;
          }
          if (motionState.heldItemSprite && motionState.heldItemSprite.__itemId === itemDefinition.id) {
            return motionState.heldItemSprite;
          }
          if (motionState.heldItemSprite && motionState.heldItemSprite.parent) {
            motionState.heldItemSprite.parent.removeChild(motionState.heldItemSprite);
            motionState.heldItemSprite.destroy?.();
          }
          const sprite = PIXI.Sprite.from(loadedOfficeAssetImages.get(itemDefinition.sprite.url) || itemDefinition.sprite.url);
          sprite.width = itemDefinition.renderWidth;
          sprite.height = itemDefinition.renderHeight;
          sprite.zIndex = (motionState.sprite?.zIndex || 12) + 1;
          sprite.__itemId = itemDefinition.id;
          renderer.root.addChild(sprite);
          motionState.heldItemSprite = sprite;
          return sprite;
        }

        function syncHeldItemSprite(motionState) {
          const autonomy = motionState && motionState.autonomy ? motionState.autonomy : null;
          const itemDefinition = autonomy && autonomy.carriedItemId ? sceneHeldItemDefinition(autonomy.carriedItemId) : null;
          if (!itemDefinition) {
            ensureHeldItemSprite(motionState);
            return;
          }
          const sprite = ensureHeldItemSprite(motionState);
          if (!sprite) {
            return;
          }
          const itemWidth = itemDefinition.renderWidth;
          const handX = motionState.flipX
            ? motionState.currentX + motionState.width - itemDefinition.handOffsetPx.x - itemWidth
            : motionState.currentX + itemDefinition.handOffsetPx.x;
          sprite.x = pixelSnap(handX);
          sprite.y = pixelSnap(motionState.currentY + itemDefinition.handOffsetPx.y);
          sprite.alpha = motionState.sprite && Number.isFinite(motionState.sprite.alpha) ? motionState.sprite.alpha : 1;
        }

        function spawnThrownHeldItem(motionState) {
          const autonomy = motionState && motionState.autonomy ? motionState.autonomy : null;
          const itemDefinition = autonomy && autonomy.carriedItemId ? sceneHeldItemDefinition(autonomy.carriedItemId) : null;
          if (!motionState || !itemDefinition) {
            return;
          }
          syncHeldItemSprite(motionState);
          const itemSprite = motionState.heldItemSprite || ensureHeldItemSprite(motionState);
          if (!itemSprite) {
            return;
          }
          const idleConfig = sceneIdleBehaviorConfig();
          const thrownSprite = PIXI.Sprite.from(loadedOfficeAssetImages.get(itemDefinition.sprite.url) || itemDefinition.sprite.url);
          thrownSprite.width = itemDefinition.renderWidth;
          thrownSprite.height = itemDefinition.renderHeight;
          thrownSprite.x = itemSprite.x;
          thrownSprite.y = itemSprite.y;
          thrownSprite.zIndex = itemSprite.zIndex;
          renderer.root.addChild(thrownSprite);
          renderer.animatedSprites.push({
            kind: "thrown-item",
            sprite: thrownSprite,
            startedAt: performance.now(),
            durationMs: idleConfig.throwAwayDurationMs,
            jumpPx: idleConfig.throwAwayJumpPx,
            startX: itemSprite.x,
            startY: itemSprite.y,
            dx: motionState.flipX ? -10 : 10,
            dy: 6
          });
          if (itemSprite.parent) {
            itemSprite.parent.removeChild(itemSprite);
            itemSprite.destroy?.();
          }
          motionState.heldItemSprite = null;
          autonomy.carriedItemId = null;
          autonomy.holdUntil = 0;
        }

        function routeMotionStateTo(motionState, room, nav, targetTile, exactTarget, speed = null) {
          if (!motionState || !room || !nav || !targetTile) {
            return;
          }
          const startTile = nearestWalkableTile(
            nav,
            motionState.currentTile || officeAvatarFootTile(room, model.tile, motionState.currentX, motionState.currentY, motionState.width, motionState.height)
          );
          const endTile = nearestWalkableTile(nav, targetTile) || targetTile;
          const route = startTile && endTile
            ? buildAgentPixelRoute(nav, startTile, endTile, room, model.tile, motionState.width, motionState.height, exactTarget)
            : [exactTarget || { x: motionState.currentX, y: motionState.currentY }];
          motionState.route = route;
          motionState.routeIndex = route.length > 1 ? 1 : route.length;
          motionState.currentTile = startTile || endTile || motionState.currentTile;
          motionState.targetX = exactTarget?.x ?? motionState.targetX;
          motionState.targetY = exactTarget?.y ?? motionState.targetY;
          if (Number.isFinite(speed)) {
            motionState.speed = Number(speed);
          }
        }

        function pickFacilityProvider(roomId) {
          const facilities = model.facilities.filter((facility) => facility && facility.roomId === roomId && Array.isArray(facility.items) && facility.items.length > 0);
          if (facilities.length === 0) {
            return null;
          }
          return facilities[Math.floor(Math.random() * facilities.length)] || null;
        }

        function updateAutonomousRestingMotion(motionState, now) {
          const autonomy = motionState && motionState.autonomy ? motionState.autonomy : null;
          if (!autonomy) {
            return;
          }
          const room = renderer.roomById.get(motionState.roomId);
          const nav = navigationForAgent(renderer.roomNavigation, renderer.reservedAgentTiles, motionState.roomId, motionState.key);
          if (!room || !nav) {
            return;
          }
          if (autonomy.carriedItemId && Number.isFinite(autonomy.holdUntil) && now >= autonomy.holdUntil) {
            autonomy.carriedItemId = null;
            autonomy.holdUntil = 0;
          }
          const routeFinished = motionState.routeIndex >= ((motionState.route && motionState.route.length) || 0);
          if (!routeFinished) {
            return;
          }
          if (autonomy.phase === "to-facility" && autonomy.facility) {
            const items = Array.isArray(autonomy.facility.items) ? autonomy.facility.items : [];
            const itemId = items[Math.floor(Math.random() * items.length)] || null;
            const itemDefinition = itemId ? sceneHeldItemDefinition(itemId) : null;
            const idleConfig = sceneIdleBehaviorConfig();
            const restingSpeedScale = Math.max(0.1, idleConfig.restingSpeedScale);
            autonomy.carriedItemId = itemDefinition ? itemDefinition.id : null;
            autonomy.holdUntil = itemDefinition
              ? now + (Number.isFinite(itemDefinition.durationMs) ? itemDefinition.durationMs : idleConfig.itemDurationMs)
              : 0;
            autonomy.phase = "returning";
            const homeTile = officeAvatarFootTile(room, model.tile, autonomy.homeX, autonomy.homeY, motionState.width, motionState.height);
            routeMotionStateTo(
              motionState,
              room,
              nav,
              homeTile,
              { x: autonomy.homeX, y: autonomy.homeY },
              176 * restingSpeedScale
            );
            motionState.targetFlipX = autonomy.homeFlip;
            return;
          }
          if (autonomy.phase === "returning") {
            autonomy.phase = "seated";
            autonomy.facility = null;
            autonomy.nextFlipAt = nextIdleFlipAt(now);
            autonomy.nextTripAt = nextIdleTripAt(now);
            motionState.targetFlipX = autonomy.homeFlip;
            return;
          }
          if (now >= autonomy.nextFlipAt) {
            autonomy.homeFlip = !autonomy.homeFlip;
            motionState.targetFlipX = autonomy.homeFlip;
            autonomy.nextFlipAt = nextIdleFlipAt(now);
          }
          if (now >= autonomy.nextTripAt) {
            const idleConfig = sceneIdleBehaviorConfig();
            const restingSpeedScale = Math.max(0.1, idleConfig.restingSpeedScale);
            const facility = pickFacilityProvider(motionState.roomId);
            if (!facility) {
              autonomy.nextTripAt = nextIdleTripAt(now);
              return;
            }
            autonomy.phase = "to-facility";
            autonomy.facility = facility;
            const serviceTile = facility.serviceTile;
            routeMotionStateTo(
              motionState,
              room,
              nav,
              serviceTile,
              officeAvatarPositionForFacility(room, model.tile, serviceTile, motionState.width, motionState.height),
              164 * restingSpeedScale
            );
            autonomy.nextTripAt = nextIdleTripAt(now);
          }
        }

        renderer.updateAutonomousRestingMotion = updateAutonomousRestingMotion;
        renderer.syncHeldItemSprite = syncHeldItemSprite;
        renderer.syncMotionStateDepth = syncMotionStateDepth;

        function addSpriteNode(definition) {
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
          sprite.alpha = Number.isFinite(definition.alpha) ? definition.alpha : 1;
          if (definition.flipX) {
            sprite.scale.x = -Math.abs(sprite.scale.x || 1);
            sprite.x += snappedWidth;
          }
          if (Number.isFinite(definition.depthFootY)) {
            applyFootDepth(
              sprite,
              Number(definition.depthFootY) - snappedHeight,
              snappedHeight,
              Number.isFinite(definition.depthBias) ? Number(definition.depthBias) : 0,
              model.tile,
              Number.isFinite(definition.depthBaseY) ? Number(definition.depthBaseY) : 0,
              Number.isFinite(definition.depthRow) ? Number(definition.depthRow) : null
            );
          } else {
            sprite.zIndex = definition.z || 5;
          }
          if (!screenshotMode && definition.enteringReveal === true) {
            sprite.visible = false;
          }
          renderer.root.addChild(sprite);
          return sprite;
        }

        function registerFocusNodes(keys, nodes) {
          if (!Array.isArray(keys) || keys.length === 0 || !Array.isArray(nodes) || nodes.length === 0) {
            return;
          }
          renderer.focusables.push({
            keys,
            nodes: nodes.filter(Boolean).map((node) => ({
              node,
              baseAlpha: Number.isFinite(node.alpha) ? node.alpha : 1
            }))
          });
        }

        const STATE_MARKER_SIZE = 11;
        const STATE_MARKER_Y_OFFSET = 13;
        const STATE_MARKER_BUBBLE_Y_OFFSET = 20;

        function statusMarkerPosition(agent, markerWidth = STATE_MARKER_SIZE) {
          return {
            x: pixelSnap(agent.x + Math.round((agent.width - markerWidth) / 2)),
            y: pixelSnap(agent.y - (agent.bubble ? STATE_MARKER_BUBBLE_Y_OFFSET : STATE_MARKER_Y_OFFSET))
          };
        }

        function avatarRenderMetrics(agent) {
          const avatarScale = agent && agent.slotId ? 0.86 : 1;
          const width = pixelSnap(agent.width * avatarScale, 1);
          const height = pixelSnap(agent.height * avatarScale, 1);
          return {
            width,
            height,
            offsetX: pixelSnap((agent.width - width) / 2),
            offsetY: pixelSnap(agent.height - height)
          };
        }

        function addAvatarNode(agent, zIndex = 12) {
          const avatar = PIXI.Sprite.from(loadedOfficeAssetImages.get(agent.sprite) || agent.sprite);
          const createdNodes = [];
          const renderMetrics = avatarRenderMetrics(agent);
          const snappedWidth = renderMetrics.width;
          const snappedHeight = renderMetrics.height;
          const offsetX = renderMetrics.offsetX;
          const offsetY = renderMetrics.offsetY;
          avatar.x = pixelSnap(agent.x) + offsetX;
          avatar.y = pixelSnap(agent.y) + offsetY;
          avatar.width = snappedWidth;
          avatar.height = snappedHeight;
          if (agent.flipX) {
            avatar.scale.x = -Math.abs(avatar.scale.x || 1);
            avatar.x += snappedWidth;
          }
          const fixedZ = Number.isFinite(agent.z) ? Number(agent.z) : null;
          if (Number.isFinite(agent.depthFootY)) {
            applyFootDepth(
              avatar,
              Number(agent.depthFootY) - snappedHeight,
              snappedHeight,
              Number.isFinite(agent.depthBias) ? Number(agent.depthBias) : zIndex,
              model.tile,
              Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0,
              Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null
            );
          } else if (fixedZ !== null) {
            avatar.zIndex = fixedZ;
          } else {
            applyFootDepth(
              avatar,
              avatar.y,
              snappedHeight,
              zIndex,
              model.tile,
              Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0,
              Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null
            );
          }
          renderer.root.addChild(avatar);
          createdNodes.push(avatar);
          let statusMarker = null;
          const statusMarkerUrl = agent.statusMarkerIconUrl || stateMarkerIconUrlForAgent(agent);
          if (statusMarkerUrl) {
            statusMarker = PIXI.Sprite.from(loadedOfficeAssetImages.get(statusMarkerUrl) || statusMarkerUrl);
            const markerWidth = STATE_MARKER_SIZE;
            const markerHeight = STATE_MARKER_SIZE;
            const markerPosition = statusMarkerPosition(agent, markerWidth);
            statusMarker.x = markerPosition.x;
            statusMarker.y = markerPosition.y;
            statusMarker.width = markerWidth;
            statusMarker.height = markerHeight;
            statusMarker.zIndex = Number.isFinite(agent.depthFootY)
              ? sceneFootDepth(Number(agent.depthFootY) - snappedHeight, snappedHeight, (Number(agent.depthBias) || zIndex) + 1, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null)
              : (fixedZ !== null ? fixedZ + 1 : sceneFootDepth(avatar.y, snappedHeight, zIndex + 1, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null));
            renderer.root.addChild(statusMarker);
            createdNodes.push(statusMarker);
          }
          let bubbleBox = null;
          let bubbleText = null;
          if (agent.bubble) {
            const bubbleX = pixelSnap(agent.x + Math.round(agent.width * 0.2));
            const bubbleY = pixelSnap(agent.y - 14);
            const bubbleWidth = Math.max(18, pixelSnap(agent.width * 0.8, 18));
            bubbleBox = new PIXI.Graphics()
              .roundRect(0, 0, bubbleWidth, 12, 3)
              .fill({ color: agent.state === "waiting" ? 0xe9f5eb : 0xf4efdf, alpha: 0.92 })
              .stroke({ color: 0x1f2e29, width: 2, alpha: 0.8 });
            bubbleBox.x = bubbleX;
            bubbleBox.y = bubbleY;
            bubbleBox.zIndex = Number.isFinite(agent.depthFootY)
              ? sceneFootDepth(Number(agent.depthFootY) - snappedHeight, snappedHeight, (Number(agent.depthBias) || zIndex) + 2, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null)
              : (fixedZ !== null ? fixedZ + 2 : sceneFootDepth(avatar.y, snappedHeight, zIndex + 2, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null));
            renderer.root.addChild(bubbleBox);
            createdNodes.push(bubbleBox);
            bubbleText = createPixiText(renderer, agent.bubble, {
              fill: 0x1f2e29,
              fontFamily: "IBM Plex Mono",
              fontSize: Math.max(8, Math.round(8 * state.globalSceneSettings.textScale)),
              fontWeight: "700"
            });
            bubbleText.x = bubbleX + Math.round((bubbleWidth - bubbleText.width) / 2);
            bubbleText.y = bubbleY + Math.round((12 - bubbleText.height) / 2) - 1;
            bubbleText.zIndex = Number.isFinite(agent.depthFootY)
              ? sceneFootDepth(Number(agent.depthFootY) - snappedHeight, snappedHeight, (Number(agent.depthBias) || zIndex) + 3, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null)
              : (fixedZ !== null ? fixedZ + 3 : sceneFootDepth(avatar.y, snappedHeight, zIndex + 3, model.tile, Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0, Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null));
            renderer.root.addChild(bubbleText);
            createdNodes.push(bubbleText);
          }
          return {
            nodes: createdNodes,
            avatar,
            statusMarker,
            bubbleBox,
            bubbleText,
            renderWidth: snappedWidth,
            renderHeight: snappedHeight,
            renderOffsetX: offsetX,
            renderOffsetY: offsetY,
            depthBias: Number.isFinite(agent.depthBias) ? Number(agent.depthBias) : (fixedZ !== null ? fixedZ : zIndex),
            depthFootY: Number.isFinite(agent.depthFootY) ? Number(agent.depthFootY) : null,
            depthBaseY: Number.isFinite(agent.depthBaseY) ? Number(agent.depthBaseY) : 0,
            depthRow: Number.isFinite(agent.depthRow) ? Number(agent.depthRow) : null
          };
        }

        function syncMotionStateDepth(motionState) {
          if (!motionState || !motionState.sprite) {
            return;
          }
          const routeLength = Array.isArray(motionState.route) ? motionState.route.length : 0;
          const settledAtTarget = motionState.exiting !== true
            && routeLength > 0
            && motionState.routeIndex >= routeLength;
          const effectiveDepthFootY = settledAtTarget && Number.isFinite(motionState.settledDepthFootY)
            ? Number(motionState.settledDepthFootY)
            : (Number.isFinite(motionState.depthFootY) ? Number(motionState.depthFootY) : null);
          const effectiveDepthBias = settledAtTarget && Number.isFinite(motionState.settledDepthBias)
            ? Number(motionState.settledDepthBias)
            : (Number.isFinite(motionState.depthBias) ? Number(motionState.depthBias) : 0);
          const effectiveDepthRow = settledAtTarget && Number.isFinite(motionState.settledDepthRow)
            ? Number(motionState.settledDepthRow)
            : (Number.isFinite(motionState.depthRow) ? Number(motionState.depthRow) : null);
          const renderHeight = Number.isFinite(motionState.renderHeight) ? Number(motionState.renderHeight) : Number(motionState.height);
          const renderTopY = Number.isFinite(motionState.currentY)
            ? Number(motionState.currentY) + (Number.isFinite(motionState.renderOffsetY) ? Number(motionState.renderOffsetY) : 0)
            : Number(motionState.sprite.y);
          if (Number.isFinite(effectiveDepthFootY)) {
            applyFootDepth(
              motionState.sprite,
              Number(effectiveDepthFootY) - renderHeight,
              renderHeight,
              effectiveDepthBias,
              model.tile,
              Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
              effectiveDepthRow
            );
            if (motionState.statusMarker) {
              motionState.statusMarker.zIndex = sceneFootDepth(
                Number(effectiveDepthFootY) - renderHeight,
                renderHeight,
                effectiveDepthBias + 1,
                model.tile,
                Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
                effectiveDepthRow
              );
            }
            if (motionState.bubbleBox) {
              motionState.bubbleBox.zIndex = sceneFootDepth(
                Number(effectiveDepthFootY) - renderHeight,
                renderHeight,
                effectiveDepthBias + 2,
                model.tile,
                Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
                effectiveDepthRow
              );
            }
            if (motionState.bubbleText) {
              motionState.bubbleText.zIndex = sceneFootDepth(
                Number(effectiveDepthFootY) - renderHeight,
                renderHeight,
                effectiveDepthBias + 3,
                model.tile,
                Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
                effectiveDepthRow
              );
            }
            if (motionState.heldItemSprite) {
              motionState.heldItemSprite.zIndex = sceneFootDepth(
                Number(effectiveDepthFootY) - renderHeight,
                renderHeight,
                effectiveDepthBias + 4,
                model.tile,
                Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0,
                effectiveDepthRow
              );
            }
            return;
          }
          if (Number.isFinite(motionState.fixedZ)) {
            const fixedZ = Number(motionState.fixedZ);
            motionState.sprite.zIndex = fixedZ;
            if (motionState.statusMarker) {
              motionState.statusMarker.zIndex = fixedZ + 1;
            }
            if (motionState.bubbleBox) {
              motionState.bubbleBox.zIndex = fixedZ + 2;
            }
            if (motionState.bubbleText) {
              motionState.bubbleText.zIndex = fixedZ + 3;
            }
            if (motionState.heldItemSprite) {
              motionState.heldItemSprite.zIndex = fixedZ + 4;
            }
            return;
          }
          const depthBias = effectiveDepthBias;
          const currentRoom = motionState.roomId ? renderer.roomById?.get(motionState.roomId) || null : null;
          const movingDepthRow = currentRoom
            ? officeAvatarFootTile(
                currentRoom,
                model.tile,
                Number(motionState.currentX),
                Number(motionState.currentY),
                Number(motionState.width),
                Number(motionState.height)
              )?.row
            : null;
          applyFootDepth(motionState.sprite, renderTopY, renderHeight, depthBias, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          if (motionState.statusMarker) {
            applyFootDepth(motionState.statusMarker, renderTopY, renderHeight, depthBias + 1, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          }
          if (motionState.bubbleBox) {
            applyFootDepth(motionState.bubbleBox, renderTopY, renderHeight, depthBias + 2, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          }
          if (motionState.bubbleText) {
            applyFootDepth(motionState.bubbleText, renderTopY, renderHeight, depthBias + 3, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          }
          if (motionState.heldItemSprite) {
            applyFootDepth(motionState.heldItemSprite, renderTopY, renderHeight, depthBias + 4, model.tile, Number.isFinite(motionState.depthBaseY) ? Number(motionState.depthBaseY) : 0, movingDepthRow);
          }
          if (
            state.globalSceneSettings.debugTiles
            && motionState.roomId
            && motionState.sprite
            && Array.isArray(renderer.debugWorkstationNodes)
          ) {
            const agentFootY = renderTopY + renderHeight;
            const agentLeft = Number(motionState.sprite.x) || 0;
            const agentRight = agentLeft + (Number(motionState.sprite.width) || 0);
            renderer.debugWorkstationNodes.forEach((entry) => {
              if (
                !entry
                || entry.roomId !== motionState.roomId
                || !entry.node
                || !Number.isFinite(entry.pivotY)
              ) {
                return;
              }
              const workstationLeft = Number.isFinite(entry.boundsX) ? Number(entry.boundsX) : (Number(entry.node.x) || 0);
              const workstationRight = workstationLeft + (Number.isFinite(entry.boundsWidth) ? Number(entry.boundsWidth) : (Number(entry.node.width) || 0));
              const overlapsX = agentRight > workstationLeft && agentLeft < workstationRight;
              if (!overlapsX) {
                return;
              }
              const agentZ = Number(motionState.sprite.zIndex) || 0;
              const workstationZ = Number(entry.node.zIndex) || 0;
              if (agentFootY >= Number(entry.pivotY) || agentZ <= workstationZ) {
                return;
              }
              const warningKey = [
                motionState.key,
                entry.key || "workstation",
                Math.round(agentFootY),
                Math.round(entry.pivotY),
                Math.round(agentZ),
                Math.round(workstationZ)
              ].join(":");
              if (renderer.debugDepthWarnings.has(warningKey)) {
                return;
              }
              renderer.debugDepthWarnings.add(warningKey);
              console.debug("scene depth violation", {
                agent: motionState.key,
                roomId: motionState.roomId,
                agentX: Math.round(Number(motionState.currentX) || 0),
                agentY: Math.round(Number(motionState.currentY) || 0),
                agentFootY: Math.round(agentFootY),
                agentZ: Math.round(agentZ),
                workstation: entry.key || null,
                workstationPivotY: Math.round(Number(entry.pivotY)),
                workstationZ: Math.round(workstationZ),
                workstationBounds: {
                  x: Math.round(workstationLeft),
                  width: Math.round(workstationRight - workstationLeft)
                }
              });
            });
          }
        }

        function registerAgentMotion(agent, avatarVisual, roomNavigation, reservations, previousMotionState = null, options = {}) {
          if (!agent || !avatarVisual || !avatarVisual.avatar) {
            return avatarVisual.nodes;
          }
          const room = roomById.get(agent.roomId);
          const agentKey = agent.key || agent.id;
          const nav = navigationForAgent(roomNavigation, reservations, agent.roomId, agentKey);
          const targetTile = officeAvatarFootTile(room, model.tile, agent.x, agent.y, agent.width, agent.height);
          const enteringFromDoor = !previousMotionState && enteringAgentKeys.has(agent.key || agent.id);
          const autonomousResting = isAutonomousRestingAgent(agent);
          const previousState = previousMotionState && previousMotionState.roomId === agent.roomId
            ? previousMotionState
            : null;
          if (previousState && previousState.autonomy && previousState.autonomy.carriedItemId && !autonomousResting) {
            spawnThrownHeldItem(previousState);
          }
          const preserveAutonomyRoute = Boolean(
            autonomousResting
            && previousState
            && previousState.autonomy
            && previousState.autonomy.phase !== "seated"
            && previousState.exiting !== true
          );
          const sameTarget = Boolean(
            preserveAutonomyRoute || (
              previousState
              && previousState.roomId === agent.roomId
              && previousState.targetX === agent.x
              && previousState.targetY === agent.y
              && previousState.exiting !== true
            )
          );
          if (sameTarget) {
            previousState.sprite = avatarVisual.avatar;
            previousState.statusMarker = avatarVisual.statusMarker;
            previousState.bubbleBox = avatarVisual.bubbleBox;
            previousState.bubbleText = avatarVisual.bubbleText;
             previousState.heldItemSprite = null;
            previousState.anchorNode = renderer.agentHitNodes.get(agentKey) || null;
            previousState.width = agent.width;
            previousState.height = agent.height;
            previousState.renderWidth = avatarVisual.renderWidth;
            previousState.renderHeight = avatarVisual.renderHeight;
            previousState.renderOffsetX = avatarVisual.renderOffsetX;
            previousState.renderOffsetY = avatarVisual.renderOffsetY;
            previousState.state = agent.state || "idle";
            previousState.spriteUrl = agent.sprite;
            previousState.depthBaseY = avatarVisual.depthBaseY;
            previousState.depthRow = avatarVisual.depthRow;
            previousState.settledDepthFootY = Number.isFinite(avatarVisual.depthFootY) ? Number(avatarVisual.depthFootY) : null;
            previousState.settledDepthBias = Number.isFinite(avatarVisual.depthBias) ? Number(avatarVisual.depthBias) : null;
            previousState.settledDepthRow = Number.isFinite(avatarVisual.depthRow) ? Number(avatarVisual.depthRow) : null;
            const isMoving = (Boolean(previousState && previousState.routeIndex < (previousState.route?.length || 0))
              || previousState.exiting === true);
            const movingDepthFootY = isMoving ? null : avatarVisual.depthFootY;
            const movingDepthBias = isMoving ? null : avatarVisual.depthBias;
            if (state.globalSceneSettings.debugTiles && isMoving && Number.isFinite(avatarVisual.depthFootY)) {
              console.debug("scene depth: clearing fixed foot depth for moving agent", {
                agent: agentKey,
                state: agent.state,
                target: { x: agent.x, y: agent.y },
                current: { x: previousState.currentX, y: previousState.currentY },
                foot: avatarVisual.depthFootY
              });
            }
            previousState.depthBias = movingDepthBias;
            previousState.depthFootY = movingDepthFootY;
            previousState.fixedZ = Number.isFinite(agent.z) ? Number(agent.z) : null;
            previousState.targetFlipX = agent.flipX === true;
            previousState.slotId = agent.slotId || previousState.slotId || null;
            previousState.mirrored = typeof agent.mirrored === "boolean"
              ? agent.mirrored
              : (typeof previousState.mirrored === "boolean" ? previousState.mirrored : null);
            if (autonomousResting) {
              previousState.autonomy = previousState.autonomy || {
                phase: "seated",
                homeX: agent.x,
                homeY: agent.y,
                homeFlip: agent.flipX === true,
                nextFlipAt: nextIdleFlipAt(),
                nextTripAt: nextIdleTripAt(),
                facility: null,
                carriedItemId: null,
                holdUntil: 0
              };
              previousState.autonomy.homeX = agent.x;
              previousState.autonomy.homeY = agent.y;
              previousState.autonomy.homeFlip = agent.flipX === true;
            } else {
              previousState.autonomy = null;
            }
            renderer.motionStates.set(agentKey, previousState);
            if (autonomousResting) {
              renderer.animatedSprites.push(previousState);
            } else if (["editing", "running", "validating", "scanning", "thinking", "planning", "delegating"].includes(agent.state) && previousState.routeIndex >= (previousState.route?.length || 0)) {
              renderer.animatedSprites.push({
                kind: "bob",
                sprite: avatarVisual.avatar,
                baseY: pixelSnap(previousState.currentY),
                depthBias: avatarVisual.depthBias,
                phase: stableHash(agent.id || agent.label || "") % 1000
              });
            } else {
              renderer.animatedSprites.push(previousState);
            }
            syncMotionStateDepth(previousState);
            syncAgentHitNodePosition(renderer, previousState);
            return avatarVisual.nodes;
          }
          const startTile = previousState
            ? nearestWalkableTile(nav, officeAvatarFootTile(room, model.tile, previousState.currentX, previousState.currentY, previousState.width, previousState.height))
            : enteringFromDoor
              ? nearestWalkableTile(nav, roomDoorTile(room, model.tile))
              : targetTile;
          const route = startTile && targetTile
            ? buildAgentPixelRoute(
              nav,
              startTile,
              targetTile,
              room,
              model.tile,
              agent.width,
              agent.height,
              { x: agent.x, y: agent.y }
            )
            : [{ x: agent.x, y: agent.y }];
          const isMoving = route.length > 1 || options.exiting === true;
          const movingDepthFootY = isMoving ? null : avatarVisual.depthFootY;
          const movingDepthBias = isMoving ? null : avatarVisual.depthBias;
          if (state.globalSceneSettings.debugTiles && isMoving && Number.isFinite(avatarVisual.depthFootY)) {
            console.debug('scene depth: clearing fixed foot depth for moving agent', {
              agent: agentKey,
              state: agent.state,
              target: { x: agent.x, y: agent.y },
              current: { x: previousState ? previousState.currentX : agent.x, y: previousState ? previousState.currentY : agent.y },
              foot: avatarVisual.depthFootY
            });
          }
          const motionState = {
            kind: "motion",
            key: agentKey,
            roomId: agent.roomId,
            sprite: avatarVisual.avatar,
            statusMarker: avatarVisual.statusMarker,
            spriteUrl: agent.sprite,
            bubbleBox: avatarVisual.bubbleBox,
            bubbleText: avatarVisual.bubbleText,
            width: agent.width,
            height: agent.height,
            renderWidth: avatarVisual.renderWidth,
            renderHeight: avatarVisual.renderHeight,
            renderOffsetX: avatarVisual.renderOffsetX,
            renderOffsetY: avatarVisual.renderOffsetY,
            currentX: previousState
              ? previousState.currentX
              : (route[0]?.x ?? agent.x),
            currentY: previousState
              ? previousState.currentY
              : (route[0]?.y ?? agent.y),
            currentTile: startTile || targetTile,
            targetX: agent.x,
            targetY: agent.y,
            route,
            routeIndex: previousState ? 0 : 1,
            speed: options.speed || 198,
            flipX: previousState ? previousState.flipX : agent.flipX === true,
            targetFlipX: agent.flipX === true,
            anchorNode: renderer.agentHitNodes.get(agentKey) || null,
            exiting: options.exiting === true,
            state: agent.state || "idle",
            slotId: agent.slotId || previousState?.slotId || null,
            mirrored: typeof agent.mirrored === "boolean"
              ? agent.mirrored
              : (typeof previousState?.mirrored === "boolean" ? previousState.mirrored : null),
            heldItemSprite: null,
            depthBaseY: avatarVisual.depthBaseY,
            depthRow: avatarVisual.depthRow,
            depthBias: movingDepthBias,
            depthFootY: movingDepthFootY,
            settledDepthBias: Number.isFinite(avatarVisual.depthBias) ? Number(avatarVisual.depthBias) : null,
            settledDepthFootY: Number.isFinite(avatarVisual.depthFootY) ? Number(avatarVisual.depthFootY) : null,
            settledDepthRow: Number.isFinite(avatarVisual.depthRow) ? Number(avatarVisual.depthRow) : null,
            fixedZ: Number.isFinite(agent.z) ? Number(agent.z) : null,
            autonomy: autonomousResting
              ? (previousState && previousState.autonomy
                ? {
                    ...previousState.autonomy,
                    homeX: agent.x,
                    homeY: agent.y,
                    homeFlip: agent.flipX === true
                  }
                : {
                    phase: "seated",
                    homeX: agent.x,
                    homeY: agent.y,
                    homeFlip: agent.flipX === true,
                    nextFlipAt: nextIdleFlipAt(),
                    nextTripAt: nextIdleTripAt(),
                    facility: null,
                    carriedItemId: null,
                    holdUntil: 0
                  })
              : null
          };
          if (enteringFromDoor) {
            const doorState = renderer.roomDoorStates.get(agent.roomId);
            if (doorState) {
              doorState.doorPulseUntil = performance.now() + sceneDoorConfig().holdOpenMs;
            }
          }
          if (["editing", "running", "validating", "scanning", "thinking", "planning", "delegating"].includes(agent.state) && route.length <= 1) {
            motionState.currentX = agent.x;
            motionState.currentY = agent.y;
            motionState.route = [{ x: agent.x, y: agent.y }];
            motionState.routeIndex = 1;
            renderer.motionStates.set(motionState.key, motionState);
            renderer.animatedSprites.push({
              kind: "bob",
              sprite: avatarVisual.avatar,
              baseY: pixelSnap(agent.y),
              depthBias: avatarVisual.depthBias,
              phase: stableHash(agent.id || agent.label || "") % 1000
            });
            syncMotionStateDepth(motionState);
            syncAgentHitNodePosition(renderer, motionState);
            return avatarVisual.nodes;
          }
          if (route.length <= 1 && !motionState.exiting) {
            motionState.currentX = agent.x;
            motionState.currentY = agent.y;
            motionState.route = [{ x: agent.x, y: agent.y }];
            motionState.routeIndex = 1;
            renderer.motionStates.set(motionState.key, motionState);
            if (autonomousResting) {
              renderer.animatedSprites.push(motionState);
            }
            syncMotionStateDepth(motionState);
            syncAgentHitNodePosition(renderer, motionState);
            return avatarVisual.nodes;
          }
          renderer.motionStates.set(motionState.key, motionState);
          renderer.animatedSprites.push(motionState);
          syncMotionStateDepth(motionState);
          syncAgentHitNodePosition(renderer, motionState);
          return avatarVisual.nodes;
        }

        function addDebugBounds(x, y, width, height, color, label) {
          const outline = new PIXI.Graphics()
            .rect(pixelSnap(x), pixelSnap(y), pixelSnap(width, 1), pixelSnap(height, 1))
            .stroke({ color, width: 1, alpha: 0.95 });
          outline.zIndex = 98;
          renderer.root.addChild(outline);
          if (!label) {
            return;
          }
          const labelWidth = Math.max(24, label.length * 5 + 6);
          const labelBg = new PIXI.Graphics()
            .roundRect(pixelSnap(x), pixelSnap(y) - 10, labelWidth, 10, 2)
            .fill({ color: 0x061019, alpha: 0.86 })
            .stroke({ color, width: 1, alpha: 0.95 });
          labelBg.zIndex = 99;
          renderer.root.addChild(labelBg);
          const labelText = createPixiText(renderer, label, {
            fill: color,
            fontFamily: "IBM Plex Mono",
            fontSize: 7,
            fontWeight: "700"
          });
          labelText.x = pixelSnap(x) + 3;
          labelText.y = pixelSnap(y) - 9;
          labelText.zIndex = 100;
          renderer.root.addChild(labelText);
        }

        function addDebugPivot(x, y, color) {
          const pivotX = pixelSnap(x);
          const pivotY = pixelSnap(y);
          const pivotHalo = new PIXI.Graphics()
            .circle(pivotX, pivotY, 4)
            .fill({ color: 0xffffff, alpha: 0.92 });
          pivotHalo.zIndex = 101;
          renderer.root.addChild(pivotHalo);
          const pivotDot = new PIXI.Graphics()
            .circle(pivotX, pivotY, 2)
            .fill({ color, alpha: 1 })
            .stroke({ color: 0x061019, width: 1, alpha: 0.95 });
          pivotDot.zIndex = 102;
          renderer.root.addChild(pivotDot);
        }

        model.rooms.forEach((room) => {
          const roomBox = new PIXI.Graphics()
            .roundRect(room.x, room.y, room.width, room.height, 10)
            .fill({ color: room.isPrimary ? 0x1f7fcf : 0x256fa8, alpha: 0.95 })
            .stroke({ color: 0x365a76, width: 3 });
          roomBox.zIndex = 1;
          renderer.root.addChild(roomBox);

          const wallBand = new PIXI.Graphics()
            .rect(room.x, room.y, room.width, room.wallHeight)
            .fill({ color: 0xdceefe, alpha: 0.92 });
          wallBand.zIndex = 2;
          renderer.root.addChild(wallBand);

          const mural = new PIXI.Graphics()
            .rect(room.x + 8, room.y + 8, room.width - 16, Math.max(16, room.wallHeight - 16))
            .fill({ color: 0x9dd6ff, alpha: 0.32 });
          mural.zIndex = 2;
          renderer.root.addChild(mural);

          const roomDoor = model.roomDoors.find((entry) => entry.roomId === room.id) || null;
          if (roomDoor) {
            const doorConfig = sceneDoorConfig();
            const backdrop = new PIXI.Graphics()
              .rect(roomDoor.backdropX, roomDoor.backdropY, roomDoor.backdropWidth, roomDoor.backdropHeight)
              .fill({ color: doorConfig.backdropColor, alpha: doorConfig.backdropAlpha });
            backdrop.zIndex = 2.2;
            renderer.root.addChild(backdrop);

            const leftDoor = PIXI.Sprite.from(loadedOfficeAssetImages.get(roomDoor.leftSprite) || roomDoor.leftSprite);
            leftDoor.width = roomDoor.width;
            leftDoor.height = roomDoor.height;
            leftDoor.scale.x = -Math.abs(leftDoor.scale.x || 1);
            leftDoor.x = roomDoor.leftX + roomDoor.width;
            leftDoor.y = roomDoor.y;
            leftDoor.zIndex = 2.6;
            renderer.root.addChild(leftDoor);

            const rightDoor = PIXI.Sprite.from(loadedOfficeAssetImages.get(roomDoor.rightSprite) || roomDoor.rightSprite);
            rightDoor.width = roomDoor.width;
            rightDoor.height = roomDoor.height;
            rightDoor.x = roomDoor.rightX;
            rightDoor.y = roomDoor.y;
            rightDoor.zIndex = 2.6;
            renderer.root.addChild(rightDoor);

            const previousDoorState = previousDoorStates.get(room.id) || null;
            renderer.roomDoorStates.set(room.id, {
              roomId: room.id,
              backdrop,
              leftSprite: leftDoor,
              rightSprite: rightDoor,
              baseLeftX: roomDoor.leftX + roomDoor.width,
              baseRightX: roomDoor.rightX,
              openAmount: Number(previousDoorState?.openAmount) || 0,
              doorPulseUntil: Number(previousDoorState?.doorPulseUntil) || 0
            });
          }

          const floorTop = room.floorTop;
          for (let y = floorTop; y < room.y + room.height; y += 48) {
            const band = new PIXI.Graphics()
              .rect(room.x, y, room.width, 22)
              .fill({ color: 0x48a7ee, alpha: 0.96 });
            band.zIndex = 1.5;
            renderer.root.addChild(band);
            const seam = new PIXI.Graphics()
              .rect(room.x, Math.min(y + 22, room.y + room.height - 2), room.width, 2)
              .fill({ color: 0x7eeaff, alpha: 0.86 });
            seam.zIndex = 1.6;
            renderer.root.addChild(seam);
            const shadowBand = new PIXI.Graphics()
              .rect(room.x, Math.min(y + 24, room.y + room.height - 22), room.width, 22)
              .fill({ color: 0x2f8fdf, alpha: 0.94 });
            shadowBand.zIndex = 1.55;
            renderer.root.addChild(shadowBand);
          }

          if (state.globalSceneSettings.debugTiles) {
            for (let x = room.x; x <= room.x + room.width; x += model.tile) {
              const vertical = new PIXI.Graphics()
                .moveTo(x, floorTop)
                .lineTo(x, room.y + room.height)
                .stroke({ color: 0xffffff, width: 1, alpha: 0.18 });
              vertical.zIndex = 96;
              renderer.root.addChild(vertical);
            }
            for (let y = floorTop; y <= room.y + room.height; y += model.tile) {
              const horizontal = new PIXI.Graphics()
                .moveTo(room.x, y)
                .lineTo(room.x + room.width, y)
                .stroke({ color: 0xffffff, width: 1, alpha: 0.18 });
              horizontal.zIndex = 96;
              renderer.root.addChild(horizontal);
            }
          }

        });

        renderer.relationshipLineEntries = [];
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
          path.zIndex = 20000;
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
          arrowHead.zIndex = 20000;
          arrowHead.visible = false;
          renderer.root.addChild(arrowHead);

          renderer.relationshipLineEntries.push({
            bossKey: line.focusKey,
            nodes: [
              { node: path, baseAlpha: 1 },
              { node: arrowHead, baseAlpha: 1 }
            ]
          });
        });

        model.tileObjects.forEach((object) => {
          const prop = compileTileObject(model, roomById, object);
          if (!prop) {
            return;
          }
          addSpriteNode(prop);
          if (state.globalSceneSettings.debugTiles) {
            addDebugBounds(
              prop.x,
              prop.y,
              prop.width,
              prop.height,
              0xffd64d,
              Number.isFinite(prop.tileWidth) && Number.isFinite(prop.tileHeight)
                ? \`\${prop.tileWidth}x\${prop.tileHeight}\`
                : tileBoundsLabel(prop.width, prop.height, model.tile)
            );
          }
        });

        model.workstations.forEach((workstation) => {
          if (!state.globalSceneSettings.debugTiles) {
            return;
          }
          addDebugBounds(
            workstation.x,
            workstation.y,
            workstation.width,
            workstation.height,
            0x4dd8ff,
            \`\${workstation.tileWidth}x\${workstation.tileHeight}\`
          );
          if (Number.isFinite(workstation.pivotX) && Number.isFinite(workstation.pivotY)) {
            addDebugPivot(
              workstation.pivotX,
              workstation.pivotY,
              0xffb347
            );
          }
        });

        const currentAgentKeys = new Set();

        model.desks.forEach((desk) => {
          const deskNodes = [];
          const enteringRevealNodes = [];
          const workstationKey = desk.agents[0]?.key || desk.agents[0]?.id || null;
          const workstationMeta = workstationKey ? workstationByKey.get(workstationKey) || null : null;
          desk.shell.forEach((item) => {
            if (item.kind === "sprite") {
              const node = addSpriteNode(item);
              deskNodes.push(node);
              if (item.z === 9 && workstationMeta) {
                renderer.debugWorkstationNodes.push({
                  key: workstationMeta.key,
                  roomId: workstationMeta.roomId,
                  node,
                  pivotY: workstationMeta.pivotY,
                  boundsX: workstationMeta.x,
                  boundsWidth: workstationMeta.width
                });
              }
              if (!screenshotMode && item.enteringReveal === true) {
                enteringRevealNodes.push(node);
              }
              return;
            }
            if (item.kind === "glow") {
              const glow = new PIXI.Graphics()
                .roundRect(item.x, item.y, item.width, item.height, 3)
                .fill({ color: 0x4bd69f, alpha: 0.24 });
              glow.zIndex = item.z || 10;
              if (!screenshotMode && item.enteringReveal === true) {
                glow.visible = false;
                enteringRevealNodes.push(glow);
              }
              renderer.root.addChild(glow);
              deskNodes.push(glow);
            }
          });
          if (enteringRevealNodes.length > 0) {
            renderer.animatedSprites.push({
              kind: "blink",
              nodes: enteringRevealNodes,
              startedAt: performance.now(),
              durationMs: 140
            });
          }

          const deskFocusKeys = [];
          desk.agents.forEach((agent) => {
            deskFocusKeys.push(...(agent.focusKeys || []));
            currentAgentKeys.add(agent.key || agent.id);
            deskNodes.push(
              ...registerAgentMotion(
                agent,
                addAvatarNode(agent, 12),
                roomNavigation,
                reservedAgentTiles,
                previousMotionStates.get(agent.key || agent.id) || null
              )
            );
          });
          registerFocusNodes([...new Set(deskFocusKeys)], deskNodes);
        });

        model.offices.forEach((office) => {
          const officeNodes = [];
          const enteringRevealNodes = [];
          const workstationKey = office.agent?.key || office.agent?.id || null;
          const workstationMeta = workstationKey ? workstationByKey.get(workstationKey) || null : null;
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
          officeNodes.push(doorway);

          office.shell.forEach((item) => {
            if (item.kind === "sprite") {
              const node = addSpriteNode(item);
              officeNodes.push(node);
              if (item.z === 9 && workstationMeta) {
                renderer.debugWorkstationNodes.push({
                  key: workstationMeta.key,
                  roomId: workstationMeta.roomId,
                  node,
                  pivotY: workstationMeta.pivotY,
                  boundsX: workstationMeta.x,
                  boundsWidth: workstationMeta.width
                });
              }
              if (!screenshotMode && item.enteringReveal === true) {
                enteringRevealNodes.push(node);
              }
              return;
            }
            if (item.kind === "glow") {
              const glow = new PIXI.Graphics()
                .roundRect(item.x, item.y, item.width, item.height, 3)
                .fill({ color: 0x4bd69f, alpha: 0.24 });
              glow.zIndex = item.z || 10;
              if (!screenshotMode && item.enteringReveal === true) {
                glow.visible = false;
                enteringRevealNodes.push(glow);
              }
              renderer.root.addChild(glow);
              officeNodes.push(glow);
            }
          });
          if (enteringRevealNodes.length > 0) {
            renderer.animatedSprites.push({
              kind: "blink",
              nodes: enteringRevealNodes,
              startedAt: performance.now(),
              durationMs: 140
            });
          }

          if (office.badgeLabel) {
            const badgeBg = new PIXI.Graphics()
              .roundRect(office.x + 4, office.y + 4, Math.max(32, office.badgeLabel.length * 4 + 6), 10, 2)
              .fill({ color: 0x0c1210, alpha: 0.62 })
              .stroke({ color: 0xffffff, width: 1, alpha: 0.14 });
            badgeBg.zIndex = 11;
            renderer.root.addChild(badgeBg);
            const badgeText = createPixiText(renderer, office.badgeLabel, {
              fill: 0xf6eed9,
              fontFamily: "IBM Plex Mono",
              fontSize: Math.max(7, Math.round(7 * state.globalSceneSettings.textScale))
            });
            badgeText.x = office.x + 7;
            badgeText.y = office.y + 5;
            badgeText.zIndex = 12;
            renderer.root.addChild(badgeText);
            officeNodes.push(badgeBg, badgeText);
          }

          if (office.agent) {
            currentAgentKeys.add(office.agent.key || office.agent.id);
            officeNodes.push(
              ...registerAgentMotion(
                office.agent,
                addAvatarNode(office.agent, 12),
                roomNavigation,
                reservedAgentTiles,
                previousMotionStates.get(office.agent.key || office.agent.id) || null
              )
            );
            registerFocusNodes(office.agent.focusKeys, officeNodes);
          }
        });

        model.recAgents.forEach((agent) => {
          currentAgentKeys.add(agent.key || agent.id);
          const recNodes = registerAgentMotion(
            agent,
            addAvatarNode(agent, 12),
            roomNavigation,
            reservedAgentTiles,
            previousMotionStates.get(agent.key || agent.id) || null
          );
          if (state.globalSceneSettings.debugTiles) {
            addDebugBounds(agent.x, agent.y, agent.width, agent.height, 0x9eff6a, tileBoundsLabel(agent.width, agent.height, model.tile));
            addDebugPivot(
              Number.isFinite(agent.pivotX) ? agent.pivotX : agent.x + agent.width / 2,
              Number.isFinite(agent.pivotY) ? agent.pivotY : agent.y + agent.height - 1,
              0xff5d9e
            );
          }
          registerFocusNodes(agent.focusKeys, recNodes);
        });

        const departingAgentKeys = new Set(departingAgents.map((agent) => agent.key));
        previousMotionStates.forEach((motionState, key) => {
          if (!motionState || currentAgentKeys.has(key) || motionState.exiting || !departingAgentKeys.has(key)) {
            return;
          }
          const room = roomById.get(motionState.roomId);
          const nav = navigationForAgent(roomNavigation, reservedAgentTiles, motionState.roomId, key);
          if (!room || !nav) {
            return;
          }
          const exitTile = nearestWalkableTile(nav, roomDoorTile(room, model.tile));
          const startTile = nearestWalkableTile(nav, motionState.currentTile || officeAvatarFootTile(room, model.tile, motionState.currentX, motionState.currentY, motionState.width, motionState.height));
          const targetPoint = exitTile
            ? officeAvatarPositionForTile(room, model.tile, exitTile, motionState.width, motionState.height)
            : { x: motionState.currentX, y: motionState.currentY };
          const ghostAgent = {
            id: motionState.key,
            key,
            roomId: motionState.roomId,
            sprite: motionState.spriteUrl,
            width: motionState.width,
            height: motionState.height,
            x: motionState.currentX,
            y: motionState.currentY,
            flipX: motionState.flipX,
            state: motionState.state || "idle",
            bubble: null
          };
          const ghostVisual = addAvatarNode(ghostAgent, 12);
          const ghostRoute = startTile && exitTile
            ? buildAgentPixelRoute(nav, startTile, exitTile, room, model.tile, motionState.width, motionState.height, targetPoint)
            : [targetPoint];
          const ghostMotion = {
            kind: "motion",
            key,
            roomId: motionState.roomId,
            sprite: ghostVisual.avatar,
            statusMarker: null,
            bubbleBox: null,
            bubbleText: null,
            width: motionState.width,
            height: motionState.height,
            currentX: motionState.currentX,
            currentY: motionState.currentY,
            currentTile: startTile,
            route: ghostRoute,
            routeIndex: 0,
            speed: 216,
            flipX: motionState.flipX,
            anchorNode: null,
            exiting: true,
            spriteUrl: motionState.spriteUrl,
            state: motionState.state || "idle"
          };
          renderer.motionStates.set(key, ghostMotion);
          renderer.animatedSprites.push(ghostMotion);
          const doorState = renderer.roomDoorStates.get(motionState.roomId);
          if (doorState) {
            doorState.doorPulseUntil = performance.now() + sceneDoorConfig().holdOpenMs;
          }
        });

        const projectSceneKeyPrefix = model.projectRoot + "::";
        for (const key of [...renderedAgentSceneState.keys()]) {
          if (key.startsWith(projectSceneKeyPrefix)) {
            renderedAgentSceneState.delete(key);
          }
        }
        renderer.motionStates.forEach((motionState, key) => {
          if (!motionState || motionState.exiting === true) {
            return;
          }
          renderedAgentSceneState.set(key, {
            roomId: motionState.roomId,
            slotId: motionState.slotId || null,
            mirrored: typeof motionState.mirrored === "boolean" ? motionState.mirrored : null,
            avatarX: Number.isFinite(motionState.targetX) ? motionState.targetX : motionState.currentX,
            avatarY: Number.isFinite(motionState.targetY) ? motionState.targetY : motionState.currentY,
            avatarWidth: motionState.width,
            avatarHeight: motionState.height
          });
        });

        applyOfficeRendererFocus(renderer);
      }

      async function syncOfficeMapScenes(projects) {
  cleanupOfficeRenderers();
  const hostNodes = Array.from(document.querySelectorAll("[data-office-map-host]"));
  for (const host of hostNodes) {
    if (!(host instanceof HTMLElement)) {
      continue;
    }
    const projectRoot = host.dataset.projectRoot || "";
    const snapshot = projects.find((project) => project.projectRoot === projectRoot);
    if (!snapshot) {
      continue;
    }
    const compact = host.dataset.compact === "1";
    const focusMode = host.dataset.focusMode === "1";
    const renderer = await ensureOfficeRenderer(host);
    if (!renderer) {
      continue;
    }
    const model = buildOfficeSceneModel(snapshot, {
      compact,
      focusMode,
      liveOnly: state.activeOnly
    });
    if (!model) {
      continue;
    }
    try {
      await ensureOfficeSceneAssets(model);
      syncOfficeRendererScene(renderer, model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("office scene render failed", {
        projectRoot,
        compact,
        focusMode,
        message,
        modelSummary: {
          rooms: model.rooms.length,
          tileObjects: model.tileObjects.length,
          desks: model.desks.length,
          offices: model.offices.length,
          recAgents: model.recAgents.length
        }
      });
    }
  }
}

function focusKeysIntersect(keys, focusedKeys) {
        return Array.isArray(keys) && keys.some((key) => focusedKeys.has(String(key)));
      }

      function applyOfficeRendererFocus(renderer) {
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
      }

      function applyOfficeRendererFocusAll() {
        officeSceneRenderers.forEach((renderer) => applyOfficeRendererFocus(renderer));
      }

      function rendererForHost(host) {
        if (!(host instanceof HTMLElement)) {
          return null;
        }
        return officeSceneRenderers.get(host.dataset.officeMapHost || "") || null;
      }

      function canPlaceFurniture(model, movingItem, nextColumn) {
        const room = model.rooms.find((entry) => entry.id === movingItem.roomId);
        if (!room) {
          return false;
        }
        const roomWidthTiles = Math.round(room.width / model.tile);
        if (nextColumn < 0 || nextColumn + movingItem.widthTiles > roomWidthTiles) {
          return false;
        }
        return !model.furniture.some((item) =>
          item.id !== movingItem.id
          && item.roomId === movingItem.roomId
          && rectanglesOverlap({ ...movingItem, column: nextColumn }, item)
        );
      }

      function handleFurnitureDragMove(event) {
        if (!furnitureDragState) {
          return;
        }
        const renderer = furnitureDragState.renderer;
        if (!renderer || !renderer.model) {
          return;
        }
        const pointerX = event.clientX - furnitureDragState.hostRect.left - (renderer.leftOffset || 0);
        const nextColumn = Math.round(pointerX / (renderer.scale * renderer.model.tile) - furnitureDragState.pointerOffsetTiles);
        if (!Number.isFinite(nextColumn) || nextColumn === furnitureDragState.currentColumn) {
          return;
        }
        if (!canPlaceFurniture(renderer.model, furnitureDragState.item, nextColumn)) {
          return;
        }
        furnitureDragState.currentColumn = nextColumn;
        setFurnitureColumnOverride(furnitureDragState.projectRoot, furnitureDragState.item.roomId, furnitureDragState.item.id, nextColumn);
        render();
      }

      function stopFurnitureDrag() {
        if (!furnitureDragState) {
          return;
        }
        window.removeEventListener("pointermove", handleFurnitureDragMove);
        window.removeEventListener("pointerup", stopFurnitureDrag);
        window.removeEventListener("pointercancel", stopFurnitureDrag);
        furnitureDragState = null;
      }

      function renderFleetTerminal(fleet) {
        const lines = ["$ codex-agents-office fleet", ""];
        for (const snapshot of fleet.projects) {
          const counts = countsForSnapshot(snapshot);
          lines.push(\`PROJECT \${projectLabel(snapshot.projectRoot)}\`);
          lines.push(\`  total=\${counts.total} active=\${counts.active} waiting=\${counts.waiting} blocked=\${counts.blocked} cloud=\${counts.cloud}\`);
          if (snapshot.notes.length > 0) {
            for (const note of snapshot.notes) {
              lines.push(\`  ! \${note}\`);
            }
          }
          lines.push("");
        }

        return \`<div class="terminal-shell">\${lines.map((line) => {
          const className = line.startsWith("$ ") ? "terminal-hot"
            : line.startsWith("  ! ") ? "terminal-warn"
            : /^[A-Z]/.test(line) ? "terminal-dim"
            : "";
          return \`<div class="\${className}">\${escapeHtml(line)}</div>\`;
        }).join("")}</div>\`;
      }

      function agentsNeedingUser(projects) {
        return projects.flatMap((snapshot) =>
          snapshot.agents
            .filter((agent) => agent.needsUser)
            .map((agent) => ({ snapshot, agent }))
        ).sort((left, right) => right.agent.updatedAt.localeCompare(left.agent.updatedAt));
      }

      function renderNeedsAttention(projects) {
        const entries = agentsNeedingUser(projects);
        if (entries.length === 0) {
          return "";
        }

        return \`<section class="session-card" style="border-color:rgba(245,183,79,0.32);background:rgba(245,183,79,0.05);"><strong>Needs You</strong><div class="muted" style="margin-top:6px;">\${entries.map(({ snapshot, agent }) => {
          const need = agent.needsUser;
          const scope = normalizeDisplayText(snapshot.projectRoot, need?.command || need?.reason || need?.grantRoot || agent.detail);
          return \`\${escapeHtml(projectLabel(snapshot.projectRoot))} · \${escapeHtml(agent.label)} · \${escapeHtml(need?.kind || "input")} · \${escapeHtml(scope)}\`;
        }).join("<br />")}</div></section>\`;
      }`;
