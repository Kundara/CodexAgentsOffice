export const SCENE_GRID_SCRIPT = `
      function sceneTileSize(compact) {
        return compact ? internalSceneSettings.compactTileSizePx : internalSceneSettings.tileSizePx;
      }

      function gridUnitsToPixels(tileSize, units) {
        return Math.round(Number(tileSize) * Number(units));
      }

      function fixedSceneLayoutConfig(compact) {
        const tileSize = sceneTileSize(compact);
        const floorGridStartY = gridUnitsToPixels(tileSize, internalSceneSettings.wallDepthTiles);
        const floorGridRowOffset = gridUnitsToPixels(tileSize, 1);
        return {
          tileSize,
          deskStartRatio: internalSceneSettings.deskAreaStartRatio,
          deskColumnGapTiles: internalSceneSettings.deskColumnGapTiles,
          deskColumnGap: gridUnitsToPixels(tileSize, internalSceneSettings.deskColumnGapTiles),
          deskRowGap: 0,
          deskCubicleGapTiles: internalSceneSettings.deskGroupGapTiles,
          deskCubicleGap: gridUnitsToPixels(tileSize, internalSceneSettings.deskGroupGapTiles),
          cubiclesPerColumn: 1,
          cubicleRows: internalSceneSettings.deskRowsPerColumn,
          deskTopRow: internalSceneSettings.wallDepthTiles,
          deskTopY: gridUnitsToPixels(tileSize, internalSceneSettings.wallDepthTiles),
          podWidthTiles: internalSceneSettings.deskPodWidthTiles,
          podWidth: gridUnitsToPixels(tileSize, internalSceneSettings.deskPodWidthTiles),
          podHeightTiles: internalSceneSettings.deskPodHeightTiles,
          podHeight: gridUnitsToPixels(tileSize, internalSceneSettings.deskPodHeightTiles),
          bossLaneX: gridUnitsToPixels(tileSize, internalSceneSettings.bossLaneStartTiles),
          bossLaneWidth: gridUnitsToPixels(tileSize, internalSceneSettings.bossLaneWidthTiles),
          bossOfficeGapToDesk: gridUnitsToPixels(tileSize, internalSceneSettings.bossGapToDeskTiles),
          bossOfficeTopRow: internalSceneSettings.wallDepthTiles + internalSceneSettings.bossOfficeTopInsetTiles,
          bossOfficeTopY: gridUnitsToPixels(
            tileSize,
            internalSceneSettings.wallDepthTiles + internalSceneSettings.bossOfficeTopInsetTiles
          ),
          bossOfficeGapY: gridUnitsToPixels(tileSize, internalSceneSettings.bossBoothGapTiles),
          bossOfficeWidthTiles: internalSceneSettings.bossBoothWidthTiles,
          bossOfficeWidth: gridUnitsToPixels(tileSize, internalSceneSettings.bossBoothWidthTiles),
          bossOfficeHeightTiles: internalSceneSettings.bossBoothHeightTiles,
          bossOfficeHeight: gridUnitsToPixels(tileSize, internalSceneSettings.bossBoothHeightTiles),
          deskPodCapacity: internalSceneSettings.deskPodCapacity,
          recAreaFurnitureTopY: gridUnitsToPixels(tileSize, internalSceneSettings.recAreaFurnitureRow),
          recAreaWalkwayY: gridUnitsToPixels(tileSize, internalSceneSettings.recAreaWalkwayRow),
          recAreaMaxDepthPx: gridUnitsToPixels(tileSize, internalSceneSettings.recAreaMaxDepthTiles),
          recAreaGridTopY: floorGridStartY + gridUnitsToPixels(tileSize, internalSceneSettings.recAreaFurnitureRow) - floorGridRowOffset,
          recAreaWalkwayGridY: floorGridStartY + gridUnitsToPixels(tileSize, internalSceneSettings.recAreaWalkwayRow) - floorGridRowOffset
        };
      }

      function buildSceneTileObject(id, roomId, sprite, column, baseRow, widthTiles, heightTiles, z, options = {}) {
        return {
          id,
          roomId,
          furnitureId: options.furnitureId || null,
          furniture: options.furniture === true,
          sprite: sprite.url,
          spriteWidth: sprite.w,
          spriteHeight: sprite.h,
          column,
          baseRow,
          widthTiles,
          heightTiles,
          preserveAspect: options.preserveAspect !== false,
          anchor: options.anchor || "floor",
          flipX: options.flipX === true,
          z
        };
      }

      function buildBossOfficeSlots(config, count) {
        return Array.from({ length: count }, (_, index) => ({
          id: \`office-\${index}\`,
          kind: "office",
          order: index,
          x: config.bossLaneX,
          y: config.bossOfficeTopY + index * (config.bossOfficeHeight + config.bossOfficeGapY),
          width: config.bossOfficeWidth,
          height: config.bossOfficeHeight
        }));
      }

      function buildDeskSlots(config, roomPixelWidth, podCount, hasBossLane) {
        const slotsPerColumn = config.cubiclesPerColumn * config.cubicleRows;
        const columnCount = Math.max(1, Math.ceil(Math.max(1, podCount) / slotsPerColumn));
        const deskStartX = Math.max(
          Math.round(roomPixelWidth * config.deskStartRatio),
          hasBossLane ? config.bossLaneX + config.bossLaneWidth + config.bossOfficeGapToDesk : 0
        );
        const slots = [];
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
          const columnX = deskStartX + columnIndex * (config.podWidth + config.deskColumnGap);
          for (let cubicleIndex = 0; cubicleIndex < config.cubiclesPerColumn; cubicleIndex += 1) {
            const cubicleBaseY = config.deskTopY
              + cubicleIndex * (config.cubicleRows * config.podHeight + (config.cubicleRows - 1) * config.deskRowGap + config.deskCubicleGap);
            for (let rowIndex = 0; rowIndex < config.cubicleRows; rowIndex += 1) {
              slots.push({
                id: \`pod-\${columnIndex}-\${cubicleIndex}-\${rowIndex}\`,
                kind: "desk",
                capacity: config.deskPodCapacity,
                order: columnIndex * slotsPerColumn + cubicleIndex * config.cubicleRows + rowIndex,
                columnIndex,
                cubicleIndex,
                rowIndex,
                cubicleId: \`cubicle-\${columnIndex}-\${cubicleIndex}\`,
                x: columnX,
                y: cubicleBaseY + rowIndex * (config.podHeight + config.deskRowGap),
                width: config.podWidth,
                height: config.podHeight
              });
            }
          }
        }
        return slots;
      }

      function compileTileObject(model, roomById, object) {
        const room = roomById.get(object.roomId);
        if (!room) {
          return null;
        }
        const spriteWidth = Number(object.spriteWidth) || model.tile;
        const spriteHeight = Number(object.spriteHeight) || model.tile;
        const tileWidth = Math.max(1, Math.ceil(spriteWidth / model.tile));
        const tileHeight = Math.max(1, Math.ceil(spriteHeight / model.tile));
        const footprintX = room.x + object.column * model.tile;
        const footprintWidth = tileWidth * model.tile;
        const bottomY = object.anchor === "wall"
          ? room.floorTop + object.baseRow * model.tile
          : room.floorTop + (object.baseRow + 1) * model.tile;
        const width = spriteWidth;
        const height = spriteHeight;
        const x = footprintX + Math.floor((footprintWidth - width) / 2);
        const y = bottomY - height;
        return {
          id: object.id,
          sprite: object.sprite,
          x,
          y,
          width,
          height,
          tileWidth,
          tileHeight,
          flipX: object.flipX === true,
          z: object.z || 5
        };
      }
`;
