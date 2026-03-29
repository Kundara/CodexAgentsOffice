export const CLIENT_RUNTIME_SCENE_SOURCE = `      function buildLeadClusters(occupants) {
        const ordered = [...occupants].sort(compareAgentsByRecencyStable);
        const byId = new Map(ordered.map((agent) => [agent.id, agent]));
        const buckets = new Map();
        const leads = [];

        for (const agent of ordered) {
          if (agent.parentThreadId && byId.has(agent.parentThreadId)) {
            const list = buckets.get(agent.parentThreadId) || [];
            list.push(agent);
            buckets.set(agent.parentThreadId, list);
            continue;
          }
          leads.push(agent);
        }

        return leads.map((lead) => ({
          lead,
          children: [...(buckets.get(lead.id) || [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        }));
      }

      function partitionAgents(agents, size) {
        const rows = [];
        for (let index = 0; index < agents.length; index += size) {
          rows.push(agents.slice(index, index + size));
        }
        return rows;
      }

      function buildClusterLayout(cluster, compact, leadBoothWidth, leadBoothHeight, childBoothWidth, childBoothHeight, availableWidth) {
        const labelHeight = compact ? 12 : 14;
        const roleGapY = compact ? 8 : 10;
        const boothGap = 6;
        const childCols = 2;
        const stripWidth = Math.min(
          availableWidth,
          Math.max(
            Math.round(leadBoothWidth * (compact ? 1.8 : 2)),
            childCols * childBoothWidth + (childCols - 1) * boothGap + (compact ? 10 : 14)
          )
        );
        const roleGroups = groupAgentsByRole(cluster.children);
        let cursorY = leadBoothHeight + (roleGroups.length > 0 ? roleGapY : 0);

        const groups = roleGroups.map((group) => {
          const columns = childCols;
          const rows = Math.max(1, Math.ceil(group.agents.length / childCols));
          const showLabel = group.agents.length > 1;
          const visibleLabelHeight = showLabel ? labelHeight + 2 : 0;
          const width = stripWidth;
          const height = visibleLabelHeight + rows * childBoothHeight + (rows - 1) * boothGap;
          const layout = {
            ...group,
            x: 0,
            y: cursorY,
            width,
            height,
            columns,
            labelHeight,
            showLabel,
            labelOffset: visibleLabelHeight
          };
          cursorY += height + roleGapY;
          return layout;
        });

        return {
          lead: cluster.lead,
          children: cluster.children,
          groups,
          width: stripWidth,
          height: groups.length > 0 ? cursorY - roleGapY : leadBoothHeight
        };
      }

      function restingAgentsFor(snapshot, compact) {
        return snapshot.agents
          .filter((agent) => {
            if (agent.source === "cloud") {
              return false;
            }
            if (shouldSeatAtWorkstation(agent)) {
              return false;
            }
            return agent.state === "idle" || agent.state === "done";
          })
          .sort(compareAgentsByRecencyStable);
      }

      function chairSpriteForAgent(agent) {
        return pixelOffice.chairs[stableHash(agent.id) % pixelOffice.chairs.length];
      }

      function wallsideWaitingSlotAt(index, compact, roomPixelWidth, walkwayY) {
        const columns = compact ? 4 : 5;
        const column = index % columns;
        const row = Math.floor(index / columns);
        const startX = compact ? 78 : 96;
        const stepX = compact ? 26 : 32;
        const stepY = compact ? 14 : 17;
        return {
          x: Math.min(roomPixelWidth - (compact ? 118 : 144), startX + column * stepX),
          y: walkwayY + (compact ? 2 : 4) + row * stepY + (column % 2 === 0 ? 0 : 2),
          flip: (index + row) % 2 === 1
        };
      }

      function isUtilityRoom(room) {
        if (!room || room.path === ".") {
          return false;
        }
        const label = \`\${room.name || ""} \${room.path || ""}\`.toLowerCase();
        return ["docs", "packages"].some((segment) => label === segment || label.includes(\` \${segment}\`) || label.includes(\`/\${segment}\`));
      }

      function buildSceneRooms(rooms) {
        const visibleRooms = [];
        const roomAlias = new Map();

        function visit(room, parentVisibleId = null) {
          const suppress = parentVisibleId !== null && isUtilityRoom(room);
          const visibleId = suppress ? parentVisibleId : room.id;
          roomAlias.set(room.id, visibleId);
          if (!suppress) {
            visibleRooms.push(room);
          }
          if (Array.isArray(room.children)) {
            room.children.forEach((child) => visit(child, visibleId));
          }
        }

        rooms.forEach((room) => visit(room, null));

        const primaryRoomId = visibleRooms.find((room) => room.path === "." || room.id === "root")?.id || visibleRooms[0]?.id || null;
        visibleRooms.sort((left, right) => (right.width * right.height) - (left.width * left.height));
        return { visibleRooms, roomAlias, primaryRoomId };
      }

      function renderTerminalSnapshot(snapshot) {
        const rooms = flattenRooms(snapshot.rooms.rooms);
        const lines = [
          \`$ codex-agents-office watch \${projectLabel(snapshot.projectRoot)}\`,
          "",
          \`PROJECT \${projectLabel(snapshot.projectRoot)}\`,
          \`UPDATED \${snapshot.generatedAt}\`,
          ""
        ];

        for (const room of rooms) {
          const occupants = snapshot.agents.filter((agent) => agent.roomId === room.id);
          lines.push(\`ROOM \${room.id}  path=\${room.path}  size=\${room.width}x\${room.height}  occupants=\${occupants.length}\`);
          if (occupants.length === 0) {
            lines.push("  (empty)");
          } else {
            for (const agent of occupants) {
              const leader = parentLabelFor(snapshot, agent);
              lines.push(\`  [\${agent.state}] \${agentRankLabel(snapshot, agent)}/\${agentRole(agent)} :: \${agent.label} :: \${normalizeDisplayText(snapshot.projectRoot, agent.detail)}\${leader ? \` :: lead=\${leader}\` : ""}\`);
            }
          }
          lines.push("");
        }

        const cloudAgents = snapshot.agents.filter((agent) => agent.source === "cloud");
        lines.push(\`CLOUD \${cloudAgents.length}\`);
        if (cloudAgents.length === 0) {
          lines.push("  (none)");
        } else {
          for (const agent of cloudAgents) {
            lines.push(\`  [cloud] \${agentRole(agent)} :: \${agent.label} :: \${normalizeDisplayText(snapshot.projectRoot, agent.detail)}\`);
          }
        }

        if (snapshot.notes.length > 0) {
          lines.push("", "NOTES");
          for (const note of snapshot.notes) {
            lines.push(\`  ! \${note}\`);
          }
        }

        const html = lines.map((line) => {
          const className = line.startsWith("$ ") ? "terminal-hot"
            : line.startsWith("  ! ") ? "terminal-warn"
            : /^[A-Z]/.test(line) ? "terminal-dim"
            : "";
          return \`<div class="\${className}">\${escapeHtml(line)}</div>\`;
        }).join("");

        return \`<div class="terminal-shell">\${html}</div>\`;
      }

      function renderWorkspaceFloor(snapshot, options = {}) {
        const counts = countsForSnapshot(snapshot);
        const compact = options.compact === true;
        const titleAttr = escapeHtml(snapshot.projectRoot);
        const projectTitle = projectLabel(snapshot.projectRoot);
        const participantLabels = sharedParticipantLabelsForSnapshot(snapshot);
        const participantHtml = participantLabels.length > 0
          ? \`<div class="tower-floor-participants" title="\${escapeHtml("Active in this workspace: " + participantLabels.join(", "))}">\${participantLabels.map((label) => \`<span class="tower-floor-participant">\${escapeHtml(label)}</span>\`).join("")}</div>\`
          : "";
        const remoteOnlyTitleClass = snapshotHasLocalProject(snapshot) ? "" : " is-remote-only";
        const worktreeName = Boolean(state.globalSceneSettings && state.globalSceneSettings.splitWorktrees)
          ? worktreeNameForSnapshot(snapshot)
          : "";
        const titleHtml = worktreeName
          ? \`<div class="tower-floor-title\${remoteOnlyTitleClass}" title="\${titleAttr}"><span class="tower-floor-title-project">\${escapeHtml(projectTitle)}</span>\${participantHtml}<span class="tower-floor-title-worktree"><img class="worktree-inline-icon tower-floor-worktree-icon" src="\${escapeHtml(worktreeIconUrl())}" alt="" aria-hidden="true" /><span>\${escapeHtml(worktreeName)}</span></span></div>\`
          : \`<div class="tower-floor-title\${remoteOnlyTitleClass}" title="\${titleAttr}"><span class="tower-floor-title-project">\${escapeHtml(projectTitle)}</span>\${participantHtml}</div>\`;
        const summary = state.view === "map"
          ? (compact ? "Live floor" : "Current workload")
          : \`\${counts.total} agents · \${counts.active} active · \${counts.waiting} waiting · \${counts.blocked} blocked · \${counts.cloud} cloud\`;
        const notes = state.view === "map" ? "" : snapshot.notes.join(" | ");
        const body = state.view === "terminal"
          ? renderTerminalSnapshot(snapshot)
          : renderOfficeMapShell(snapshot, {
            showHint: false,
            compact,
            liveOnly: state.activeOnly,
            focusMode: options.focusMode === true
          });
        const shareToggleHtml = shouldRenderProjectShareToggle(snapshot)
          ? \`<button class="tower-floor-share\${projectShareEnabledForSnapshot(snapshot) ? " active" : ""}" data-action="toggle-project-share" data-project-roots="\${escapeHtml(JSON.stringify(projectShareToggleRoots(snapshot)))}" aria-pressed="\${projectShareEnabledForSnapshot(snapshot) ? "true" : "false"}" title="\${escapeHtml(projectShareEnabledForSnapshot(snapshot) ? "Shared with the room" : "Not shared with the room")}" type="button">Shared</button>\`
          : "";
        const actionHtml = options.action
          ? \`<button class="tower-floor-open" data-action="\${escapeHtml(options.action.type)}"\${options.action.projectRoot ? \` data-project-root="\${escapeHtml(options.action.projectRoot)}"\` : ""}>\${escapeHtml(options.action.label)}</button>\`
          : "";
        return \`<section class="tower-floor\${compact ? " compact" : ""}" data-project-root="\${escapeHtml(snapshot.projectRoot)}"><div class="tower-floor-strip"><div class="tower-floor-label">\${titleHtml}</div><div class="tower-floor-trailing"><div class="tower-floor-meta">\${escapeHtml(summary)}</div><div class="tower-floor-actions">\${shareToggleHtml}\${actionHtml}</div></div></div><div class="tower-floor-body">\${notes ? \`<div class="tower-floor-note">\${escapeHtml(notes)}</div>\` : ""}\${body}</div></section>\`;
      }

      function renderWorkspaceScroll(projects) {
        if (projects.length === 0) {
          return '<div class="empty">No tracked workspaces right now.</div>';
        }

        return \`<div class="workspace-tower">\${projects.map((snapshot) => renderWorkspaceFloor(snapshot, {
          compact: true,
          action: {
            type: "select-project",
            label: "Focus",
            projectRoot: snapshot.projectRoot
          }
        })).join("")}</div>\`;
      }

      function officeSceneHostKey(projectRoot, compact, focusMode) {
        return [projectRoot, compact ? "compact" : "default", focusMode ? "focus" : "standard"].join("::");
      }

      function renderOfficeMapShell(snapshot, options = {}) {
        const compact = options.compact === true;
        const focusMode = options.focusMode === true;
        const shellKey = officeSceneHostKey(snapshot.projectRoot, compact, focusMode);
        const hint = options.showHint === false || focusMode
          ? ""
          : (options.liveOnly
            ? '<div class="muted">Showing live agents plus the 4 most recent lead sessions. Recent leads cool down in the rec area while live subagents stay on the floor.</div>'
            : '<div class="muted">Room shells come from the project XML, while booths are generated live from Codex sessions and grouped by parent session and subagent role.</div>');
        return \`<div class="scene-shell" data-scene-shell="\${focusMode ? "focus" : "default"}">\${hint}<div class="scene-fit \${compact ? "compact" : ""}" data-scene-fit data-scene-mode="\${focusMode ? "focus" : "default"}" data-scene-fitted="\${focusMode ? "false" : "true"}"><div class="scene-notifications" data-scene-notifications></div><div class="office-map-host" data-office-map-host="\${escapeHtml(shellKey)}" data-project-root="\${escapeHtml(snapshot.projectRoot)}" data-compact="\${compact ? "1" : "0"}" data-focus-mode="\${focusMode ? "1" : "0"}"><div class="office-map-canvas" data-office-map-canvas></div><div class="office-map-anchors" data-office-map-anchors></div></div></div></div>\`;
      }

      function sceneShellToken(projects, focusMode = false) {
        return projects.map((project) => officeSceneHostKey(project.projectRoot, focusMode ? false : true, focusMode)).join("||");
      }

      function buildOfficeSceneModel(snapshot, options = {}) {
        const sceneRooms = buildSceneRooms(snapshot.rooms.rooms);
        const rooms = sceneRooms.visibleRooms;
        if (rooms.length === 0) {
          return null;
        }

        const compact = options.compact === true;
        const layoutConfig = fixedSceneLayoutConfig(compact);
        const tile = layoutConfig.tileSize;
        const baseMaxX = Math.max(...rooms.map((room) => room.x + room.width), 24);
        const maxY = Math.max(...rooms.map((room) => room.y + room.height), 16);
        const waitingAgents = snapshot.agents
          .filter((agent) => agent.state === "waiting" && agent.source !== "cloud" && !shouldSeatAtWorkstation(agent))
          .sort(compareAgentsByRecencyStable);
        const allRestingAgents = restingAgentsFor(snapshot, compact);
        const restingAgents = allRestingAgents
          .filter((agent) =>
            !agent.parentThreadId
            && agent.source !== "presence"
            && Boolean(agent.threadId || agent.taskId || agent.url || agent.source === "claude")
          )
          .slice(0, 4);
        const offDeskAgentIds = new Set([...waitingAgents, ...allRestingAgents].map((agent) => agent.id));
        const model = {
          projectRoot: snapshot.projectRoot,
          compact,
          tile,
          width: baseMaxX * tile,
          height: maxY * tile,
          rooms: [],
          roomDoors: [],
          tileObjects: [],
          furniture: [],
          facilities: [],
          workstations: [],
          desks: [],
          offices: [],
          recAgents: [],
          relationshipLines: [],
          anchors: []
        };
        const agentPositions = new Map();

        rooms.forEach((room) => {
          const isPrimaryRoom = room.id === sceneRooms.primaryRoomId;
          const roomAgentId = (agent) => sceneRooms.roomAlias.get(agent.roomId) || (agent.source === "cloud" ? "cloud" : sceneRooms.primaryRoomId);
          const occupants = snapshot.agents.filter((agent) =>
            roomAgentId(agent) === room.id
            && agent.source !== "cloud"
            && !offDeskAgentIds.has(agent.id)
          );
          const roomPixelWidth = room.width * tile;
          const roomPixelHeight = room.height * tile;
          const roomX = room.x * tile;
          const roomY = room.y * tile;
          const floorTop = roomY + layoutConfig.deskTopY;
          model.rooms.push({
            id: room.id,
            x: roomX,
            y: roomY,
            width: roomPixelWidth,
            height: roomPixelHeight,
            wallHeight: layoutConfig.deskTopY,
            floorTop,
            name: room.name,
            path: room.path || "",
            isPrimaryRoom
          });
          const centerColumn = Math.floor(room.width / 2);
          const entrance = roomEntranceLayout(roomPixelWidth, tile, compact, floorTop);
          const doorWidth = Math.round(pixelOffice.props.boothDoor.w * entrance.doorScale);
          const doorHeight = Math.round(pixelOffice.props.boothDoor.h * entrance.doorScale);
          const doorBackdrop = sceneDefinitions && sceneDefinitions.door ? sceneDefinitions.door : {};
          const backdropWidth = Math.max(tile * 2, Math.round((Number(doorBackdrop.backdropWidthTiles) || 2) * tile));
          const backdropHeight = Math.max(tile * 2, Math.round((Number(doorBackdrop.backdropHeightTiles) || 2) * tile));
          model.roomDoors.push({
            id: room.id + "::door",
            roomId: room.id,
            leftSprite: pixelOffice.props.boothDoor.url,
            rightSprite: pixelOffice.props.boothDoor.url,
            leftX: roomX + entrance.centerDoorX,
            rightX: roomX + entrance.centerDoorX + doorWidth,
            y: roomY + entrance.centerDoorY,
            width: doorWidth,
            height: doorHeight,
            backdropX: roomX + Math.round(entrance.entryX - backdropWidth / 2),
            backdropY: floorTop - backdropHeight,
            backdropWidth,
            backdropHeight
          });
          model.tileObjects.push(
            buildSceneTileObject(room.id + "::clock", room.id, pixelOffice.props.clock, centerColumn - 2, -2, 1, 1, 3, { anchor: "wall" })
          );
          if (isPrimaryRoom) {
            model.tileObjects.push(
              buildSceneTileObject(room.id + "::plant-left", room.id, pixelOffice.props.plant, centerColumn - 3, 0, 1, 1, 3),
              buildSceneTileObject(room.id + "::plant-right", room.id, pixelOffice.props.plant, centerColumn, 0, 1, 1, 3)
            );
          }
          if (isPrimaryRoom) {
            const furnitureLayout = resolveFurnitureLayout(snapshot, room, tile);
            const sofaColumns = {
              left: furnitureLayout.find((item) => item.id === "sofa-left")?.column ?? (room.width - 10),
              right: furnitureLayout.find((item) => item.id === "sofa-right")?.column ?? (room.width - 7)
            };
            model.tileObjects.push(
              ...furnitureLayout.map((item) =>
                buildSceneTileObject(
                  room.id + "::" + item.id,
                  room.id,
                  item.sprite,
                  item.column,
                  item.baseRow,
                  item.widthTiles,
                  item.heightTiles,
                  item.z,
                  { furniture: true, furnitureId: item.id }
                )
              )
            );
            model.furniture.push(...furnitureLayout.map((item) => ({ ...item, roomId: room.id, projectRoot: snapshot.projectRoot })));
            model.facilities.push(
              ...furnitureLayout
                .map((item) => buildFacilityProviderModel(room, item))
                .filter(Boolean)
            );
            room.__sofaColumns = sofaColumns;
          }

          const officeAgents = sortedBossOfficeAgents(snapshot, occupants.filter((agent) => isBossOfficeCandidate(snapshot, agent)));
          const deskAgents = occupants.filter((agent) => !isBossOfficeCandidate(snapshot, agent));
          const officeAssignments = assignAgentsToOfficeSlots(snapshot, officeAgents, buildBossOfficeSlots(layoutConfig, officeAgents.length));
          const deskAssignments = assignAgentsToDeskSlots(snapshot, deskAgents, buildDeskSlots(layoutConfig, roomPixelWidth, Math.ceil(deskAgents.length / 2), officeAssignments.length > 0));

          deskAssignments.forEach((entry) => {
            const pod = {
              id: entry.slot.id,
              roomId: room.id,
              x: roomX + entry.slot.x,
              y: roomY + entry.slot.y,
              width: entry.slot.width,
              height: entry.slot.height,
              role: agentRole(entry.agents[0]),
              agents: [],
              shell: []
            };
            entry.agents.forEach((agent, index) => {
              const tile = sceneTileSize(compact);
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
                  enteringReveal: shouldRevealWorkstation(snapshot.projectRoot, agent, entry.slot.id),
                  depthBaseY: room.floorTop,
                  absoluteX: pod.x + cellX,
                  absoluteY: pod.y
                }
              );
              pod.shell.push(...visual.shell);
              if (visual.glow) {
                pod.shell.push({ kind: "glow", z: 10, ...visual.glow });
              }
              if (visual.avatar) {
                pod.agents.push({
                  id: agent.id,
                  key: agentKey(snapshot.projectRoot, agent),
                  roomId: room.id,
                  label: agent.label,
                  state: agent.state,
                  role: agentRole(agent),
                  focusKey: focusAgentKey(snapshot, agent),
                  focusKeys: collectFocusedSessionKeys(snapshot, agent),
                  appearance: agent.appearance,
                  needsUser: agent.needsUser || null,
                  statusMarkerIconUrl: stateMarkerIconUrlForAgent(agent),
                  slotId: entry.slot.id,
                  mirrored: seatMirrored,
                  ...visual.avatar,
                  bubble: visual.bubble
                });
              }
              agentPositions.set(agent.id, { roomId: room.id, x: visual.anchorX, y: visual.anchorY });
              model.workstations.push({
                id: "workstation::" + agentKey(snapshot.projectRoot, agent),
                roomId: room.id,
                key: agentKey(snapshot.projectRoot, agent),
                ...visual.workstationBounds
              });
              model.anchors.push(
                {
                  id: "agent::" + agentKey(snapshot.projectRoot, agent),
                  type: "agent",
                  key: agentKey(snapshot.projectRoot, agent),
                  x: visual.anchorX,
                  y: visual.anchorY,
                  left: visual.avatar ? visual.avatar.x : visual.anchorX,
                  top: visual.avatar ? visual.avatar.y : visual.anchorY,
                  width: visual.avatar ? visual.avatar.width : tile,
                  height: visual.avatar ? visual.avatar.height : tile,
                  focusKey: focusAgentKey(snapshot, agent),
                  focusKeys: collectFocusedSessionKeys(snapshot, agent),
                  hoverHtml: renderAgentHover(snapshot, agent)
                },
                { id: "workstation::" + agentKey(snapshot.projectRoot, agent), type: "workstation", key: agentKey(snapshot.projectRoot, agent), x: pod.x + Math.round(pod.width / 2), y: pod.y + Math.round(pod.height * 0.72) }
              );
            });
            model.desks.push(pod);
          });

          officeAssignments.forEach((entry) => {
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
                enteringReveal: shouldRevealWorkstation(snapshot.projectRoot, entry.agent, entry.slot.id),
                depthBaseY: room.floorTop,
                absoluteX: officeX + cellX,
                absoluteY: officeY
              }
            );
            model.offices.push({
              id: entry.slot.id,
              roomId: room.id,
              x: officeX,
              y: officeY,
              width: entry.slot.width,
              height: entry.slot.height,
              role: "boss",
              badgeLabel: liveChildAgentsFor(snapshot, entry.agent.id).length + " spawned",
              shell: visual.shell,
              glow: visual.glow,
              agent: visual.avatar
                ? {
                    id: entry.agent.id,
                    key: agentKey(snapshot.projectRoot, entry.agent),
                    roomId: room.id,
                    label: entry.agent.label,
                    state: entry.agent.state,
                    role,
                    focusKey: focusAgentKey(snapshot, entry.agent),
                    focusKeys: collectFocusedSessionKeys(snapshot, entry.agent),
                    appearance: entry.agent.appearance,
                    needsUser: entry.agent.needsUser || null,
                    statusMarkerIconUrl: stateMarkerIconUrlForAgent(entry.agent),
                    slotId: entry.slot.id,
                    mirrored: false,
                    ...visual.avatar,
                    bubble: visual.bubble
                  }
                : null
            });
            agentPositions.set(entry.agent.id, { roomId: room.id, x: visual.anchorX, y: visual.anchorY });
            model.workstations.push({
              id: "workstation::" + agentKey(snapshot.projectRoot, entry.agent),
              roomId: room.id,
              key: agentKey(snapshot.projectRoot, entry.agent),
              ...visual.workstationBounds
            });
            model.anchors.push(
              {
                id: "agent::" + agentKey(snapshot.projectRoot, entry.agent),
                type: "agent",
                key: agentKey(snapshot.projectRoot, entry.agent),
                x: visual.anchorX,
                y: visual.anchorY,
                left: visual.avatar ? visual.avatar.x : visual.anchorX,
                top: visual.avatar ? visual.avatar.y : visual.anchorY,
                width: visual.avatar ? visual.avatar.width : tile,
                height: visual.avatar ? visual.avatar.height : tile,
                focusKey: focusAgentKey(snapshot, entry.agent),
                focusKeys: collectFocusedSessionKeys(snapshot, entry.agent),
                hoverHtml: renderAgentHover(snapshot, entry.agent)
              },
              { id: "workstation::" + agentKey(snapshot.projectRoot, entry.agent), type: "workstation", key: agentKey(snapshot.projectRoot, entry.agent), x: visual.anchorX, y: visual.anchorY }
            );
          });

          if (isPrimaryRoom) {
            const waitingAssignments = stableSceneSlotAssignments(snapshot.projectRoot, "waiting", waitingAgents);
            const restingAssignments = stableSceneSlotAssignments(snapshot.projectRoot, "resting", restingAgents, 4);
            waitingAssignments.forEach(({ agent, slotIndex }) => {
              const slot = wallsideWaitingSlotAt(slotIndex, compact, roomPixelWidth, layoutConfig.recAreaWalkwayGridY);
              const anchorX = roomX + slot.x + Math.round(tile * 0.4);
              const anchorY = roomY + slot.y + Math.round(tile * 0.6);
              model.recAgents.push({
                id: agent.id,
                key: agentKey(snapshot.projectRoot, agent),
                roomId: room.id,
                kind: "waiting",
                label: agent.label,
                state: agent.state,
                role: agentRole(agent),
                focusKey: focusAgentKey(snapshot, agent),
                focusKeys: collectFocusedSessionKeys(snapshot, agent),
                appearance: agent.appearance,
                needsUser: agent.needsUser || null,
                statusMarkerIconUrl: stateMarkerIconUrlForAgent(agent),
                sprite: avatarForAgent(agent).url,
                x: roomX + slot.x,
                y: roomY + slot.y,
                width: Math.round(avatarForAgent(agent).w * (compact ? 1 : 1.08)),
                height: Math.round(avatarForAgent(agent).h * (compact ? 1 : 1.08)),
                depthBaseY: room.floorTop,
                bubble: "...",
                flip: slot.flip
              });
              agentPositions.set(agent.id, { roomId: room.id, x: anchorX, y: anchorY });
              model.anchors.push({
                id: "agent::" + agentKey(snapshot.projectRoot, agent),
                type: "agent",
                key: agentKey(snapshot.projectRoot, agent),
                x: anchorX,
                y: anchorY,
                left: roomX + slot.x,
                top: roomY + slot.y,
                width: Math.round(avatarForAgent(agent).w * (compact ? 1 : 1.08)),
                height: Math.round(avatarForAgent(agent).h * (compact ? 1 : 1.08)),
                focusKey: focusAgentKey(snapshot, agent),
                focusKeys: collectFocusedSessionKeys(snapshot, agent),
                hoverHtml: renderAgentHover(snapshot, agent)
              });
            });
            restingAssignments.forEach(({ agent, slotIndex }) => {
              const slot = recRoomSeatSlotAt(agent, slotIndex, compact, roomPixelWidth, layoutConfig.recAreaGridTopY, room.__sofaColumns || null);
              const anchorX = roomX + slot.x + Math.round(tile * 0.4);
              const anchorY = roomY + slot.y + Math.round(tile * 0.6);
              model.recAgents.push({
                id: agent.id,
                key: agentKey(snapshot.projectRoot, agent),
                roomId: room.id,
                kind: "resting",
                label: agent.label,
                state: agent.state,
                role: agentRole(agent),
                focusKey: focusAgentKey(snapshot, agent),
                focusKeys: collectFocusedSessionKeys(snapshot, agent),
                appearance: agent.appearance,
                needsUser: agent.needsUser || null,
                statusMarkerIconUrl: stateMarkerIconUrlForAgent(agent),
                sprite: avatarForAgent(agent).url,
                x: roomX + slot.x,
                y: roomY + slot.y,
                width: Math.round(avatarForAgent(agent).w * (compact ? 1 : 1.08)),
                height: Math.round(avatarForAgent(agent).h * (compact ? 1 : 1.08)),
                depthBaseY: room.floorTop,
                bubble: null,
                flip: slot.flip
              });
              agentPositions.set(agent.id, { roomId: room.id, x: anchorX, y: anchorY });
              model.anchors.push({
                id: "agent::" + agentKey(snapshot.projectRoot, agent),
                type: "agent",
                key: agentKey(snapshot.projectRoot, agent),
                x: anchorX,
                y: anchorY,
                left: roomX + slot.x,
                top: roomY + slot.y,
                width: Math.round(avatarForAgent(agent).w * (compact ? 1 : 1.08)),
                height: Math.round(avatarForAgent(agent).h * (compact ? 1 : 1.08)),
                focusKey: focusAgentKey(snapshot, agent),
                focusKeys: collectFocusedSessionKeys(snapshot, agent),
                hoverHtml: renderAgentHover(snapshot, agent)
              });
            });
          }
        });

        snapshot.agents.forEach((agent) => {
          if (!isBossOfficeCandidate(snapshot, agent)) {
            return;
          }
          const bossPos = agentPositions.get(agent.id);
          if (!bossPos) {
            return;
          }
          childAgentsFor(snapshot, agent.id).forEach((child) => {
            const childPos = agentPositions.get(child.id);
            if (!childPos || childPos.roomId !== bossPos.roomId) {
              return;
            }
            model.relationshipLines.push({
              id: agent.id + "::" + child.id,
              x1: bossPos.x,
              y1: bossPos.y,
              x2: childPos.x,
              y2: childPos.y,
              focusKey: focusAgentKey(snapshot, agent),
              focusKeys: collectFocusedSessionKeys(snapshot, agent)
            });
          });
        });

        return model;
      }

      function destroyOfficeRenderer(renderer) {
        if (!renderer) {
          return;
        }
        try {
          if (renderer.resizeObserver) {
            renderer.resizeObserver.disconnect();
          }
          if (renderer.app && renderer.animateTick) {
            renderer.app.ticker.remove(renderer.animateTick);
          }
          if (renderer.app) {
            renderer.app.destroy(true, { children: true });
          }
        } catch {}
      }

      function cleanupOfficeRenderers() {
        officeSceneRenderers.forEach((renderer, key) => {
          if (!(renderer.host instanceof HTMLElement) || !document.body.contains(renderer.host)) {
            destroyOfficeRenderer(renderer);
            officeSceneRenderers.delete(key);
          }
        });
      }

      async function ensureOfficeRenderer(host) {
        const key = host.dataset.officeMapHost || "";
        const existing = officeSceneRenderers.get(key);
        if (existing && existing.host === host) {
          return existing;
        }
        if (existing) {
          destroyOfficeRenderer(existing);
        }
        const canvasContainer = host.querySelector("[data-office-map-canvas]");
        const anchorLayer = host.querySelector("[data-office-map-anchors]");
        if (!(canvasContainer instanceof HTMLElement) || !(anchorLayer instanceof HTMLElement) || !window.PIXI) {
          return null;
        }
        const renderer = {
          key,
          host,
          canvasContainer,
          anchorLayer,
          app: new window.PIXI.Application(),
          root: null,
          model: null,
          ready: null,
          resizeObserver: null,
          assetUrls: new Set(),
          animatedSprites: [],
          motionStates: new Map(),
          roomDoorStates: new Map(),
          agentHitNodes: new Map(),
          animateTick: null,
          focusables: [],
          roomById: new Map(),
          roomNavigation: new Map(),
          reservedAgentTiles: new Map(),
          updateAutonomousRestingMotion: null,
          syncHeldItemSprite: null
        };
        renderer.ready = renderer.app.init({
          backgroundAlpha: 0,
          antialias: false,
          autoDensity: true,
          resolution: Math.max(1, Number(window.devicePixelRatio || 1)),
          roundPixels: true
        }).then(() => {
          if (window.PIXI.TextureStyle && window.PIXI.SCALE_MODES) {
            window.PIXI.TextureStyle.defaultOptions.scaleMode = window.PIXI.SCALE_MODES.NEAREST;
          }
          if (window.PIXI.settings) {
            window.PIXI.settings.ROUND_PIXELS = true;
          }
          const canvas = renderer.app.canvas;
          canvasContainer.innerHTML = "";
          canvasContainer.appendChild(canvas);
          renderer.root = new window.PIXI.Container();
          renderer.root.sortableChildren = true;
          renderer.app.stage.addChild(renderer.root);
          renderer.animateTick = () => {
            const now = performance.now();
            const deltaMs = renderer.app?.ticker?.deltaMS || 16;
            renderer.animatedSprites.forEach((entry) => {
              if (!entry || (!entry.sprite && entry.kind !== "blink")) {
                return;
              }
              if (entry.kind === "motion") {
                if (entry.autonomy && !entry.exiting && typeof renderer.updateAutonomousRestingMotion === "function") {
                  renderer.updateAutonomousRestingMotion(entry, now);
                }
                const route = Array.isArray(entry.route) ? entry.route : [];
                const speed = Number(entry.speed) || 128;
                let remaining = speed * (deltaMs / 1000);
                while (remaining > 0 && entry.routeIndex < route.length) {
                  const target = route[entry.routeIndex];
                  const dx = target.x - entry.currentX;
                  const dy = target.y - entry.currentY;
                  const distance = Math.hypot(dx, dy);
                  if (distance <= Math.max(1, remaining)) {
                    entry.currentX = target.x;
                    entry.currentY = target.y;
                    if (entry.roomId) {
                      const currentRoom = renderer.model?.rooms?.find((room) => room.id === entry.roomId) || null;
                      entry.currentTile = officeAvatarFootTile(
                        currentRoom,
                        renderer.model?.tile || 16,
                        entry.currentX,
                        entry.currentY,
                        entry.width,
                        entry.height
                      );
                    }
                    entry.routeIndex += 1;
                    remaining -= distance;
                    continue;
                  }
                  const ratio = remaining / distance;
                  entry.currentX += dx * ratio;
                  entry.currentY += dy * ratio;
                  if (entry.roomId) {
                    const currentRoom = renderer.model?.rooms?.find((room) => room.id === entry.roomId) || null;
                    entry.currentTile = officeAvatarFootTile(
                      currentRoom,
                      renderer.model?.tile || 16,
                      entry.currentX,
                      entry.currentY,
                      entry.width,
                      entry.height
                    );
                  }
                  remaining = 0;
                  if (Math.abs(dx) >= 1) {
                    entry.flipX = dx < 0;
                  }
                }
                if (entry.routeIndex >= route.length && typeof entry.targetFlipX === "boolean") {
                  entry.flipX = entry.targetFlipX;
                }
                const renderOffsetX = Number.isFinite(entry.renderOffsetX) ? Number(entry.renderOffsetX) : 0;
                const renderOffsetY = Number.isFinite(entry.renderOffsetY) ? Number(entry.renderOffsetY) : 0;
                const renderWidth = Number.isFinite(entry.renderWidth) ? Number(entry.renderWidth) : pixelSnap(entry.width, 1);
                entry.sprite.x = pixelSnap(entry.currentX + renderOffsetX);
                entry.sprite.y = pixelSnap(entry.currentY + renderOffsetY);
                if (entry.flipX) {
                  entry.sprite.scale.x = -Math.abs(entry.sprite.scale.x || 1);
                  entry.sprite.x = pixelSnap(entry.currentX + renderOffsetX) + renderWidth;
                } else {
                  entry.sprite.scale.x = Math.abs(entry.sprite.scale.x || 1);
                }
                if (entry.bubbleBox && entry.bubbleText) {
                  const bubbleX = pixelSnap(entry.currentX + Math.round(entry.width * 0.2));
                  const bubbleY = pixelSnap(entry.currentY - 14);
                  entry.bubbleBox.x = bubbleX;
                  entry.bubbleBox.y = bubbleY;
                  entry.bubbleText.x = bubbleX + Math.round((entry.bubbleBox.width - entry.bubbleText.width) / 2);
                  entry.bubbleText.y = bubbleY + Math.round((entry.bubbleBox.height - entry.bubbleText.height) / 2) - 1;
                }
                if (entry.statusMarker) {
                  const markerWidth = Math.max(8, Math.round(entry.statusMarker.width || 11));
                  entry.statusMarker.x = pixelSnap(entry.currentX + Math.round((entry.width - markerWidth) / 2));
                  entry.statusMarker.y = pixelSnap(entry.currentY - (entry.bubbleBox ? 20 : 13));
                }
                if (typeof renderer.syncHeldItemSprite === "function") {
                  renderer.syncHeldItemSprite(entry);
                }
                if (typeof renderer.syncMotionStateDepth === "function") {
                  renderer.syncMotionStateDepth(entry);
                }
                syncAgentHitNodePosition(renderer, entry);
                if (entry.exiting && entry.routeIndex >= route.length) {
                  entry.sprite.alpha = Math.max(0, entry.sprite.alpha - 0.16);
                  if (entry.bubbleBox) {
                    entry.bubbleBox.alpha = entry.sprite.alpha;
                  }
                  if (entry.bubbleText) {
                    entry.bubbleText.alpha = entry.sprite.alpha;
                  }
                  if (entry.statusMarker) {
                    entry.statusMarker.alpha = entry.sprite.alpha;
                  }
                  if (entry.heldItemSprite) {
                    entry.heldItemSprite.alpha = entry.sprite.alpha;
                  }
                }
                return;
              }
              if (entry.kind === "blink") {
                const duration = Number(entry.durationMs) || 140;
                const elapsed = now - Number(entry.startedAt || now);
                const phase = elapsed <= 0
                  ? 0
                  : elapsed >= duration
                    ? 4
                    : Math.min(4, Math.floor((elapsed / duration) * 5));
                const visible = phase === 1 || phase === 3 || phase >= 4;
                (entry.nodes || []).forEach((node) => {
                  if (!node) {
                    return;
                  }
                  node.visible = visible;
                });
                return;
              }
              if (entry.kind === "bob") {
                entry.sprite.y = entry.baseY + Math.round(Math.sin((now + entry.phase) / 220) * 1);
                if (typeof renderer.syncMotionStateDepth === "function") {
                  renderer.syncMotionStateDepth(entry);
                }
                return;
              }
              if (entry.kind === "thrown-item") {
                const duration = Math.max(1, Number(entry.durationMs) || 700);
                const elapsed = Math.max(0, now - Number(entry.startedAt || now));
                const progress = Math.min(1, elapsed / duration);
                entry.sprite.x = pixelSnap(entry.startX + (Number(entry.dx) || 0) * progress);
                entry.sprite.y = pixelSnap(entry.startY + (Number(entry.dy) || 0) * progress - Math.sin(progress * Math.PI) * (Number(entry.jumpPx) || 12));
                entry.sprite.alpha = Math.max(0, 1 - progress);
              }
            });
            const doorDefinition = sceneDefinitions && sceneDefinitions.door ? sceneDefinitions.door : {};
            const slideOffsetPx = Number.isFinite(doorDefinition.slideOffsetPx) ? Number(doorDefinition.slideOffsetPx) : 8;
            const openLerp = Number.isFinite(doorDefinition.openLerp) ? Number(doorDefinition.openLerp) : 0.24;
            const closeLerp = Number.isFinite(doorDefinition.closeLerp) ? Number(doorDefinition.closeLerp) : 0.16;
            renderer.roomDoorStates.forEach((doorState) => {
              if (!doorState) {
                return;
              }
              const targetOpen = Number(doorState.doorPulseUntil) > now ? 1 : 0;
              const lerp = targetOpen > Number(doorState.openAmount || 0) ? openLerp : closeLerp;
              doorState.openAmount = Number(doorState.openAmount || 0) + (targetOpen - Number(doorState.openAmount || 0)) * lerp;
              if (Math.abs(targetOpen - doorState.openAmount) < 0.01) {
                doorState.openAmount = targetOpen;
              }
              const slide = Math.round(slideOffsetPx * doorState.openAmount);
              if (doorState.leftSprite) {
                doorState.leftSprite.x = pixelSnap(doorState.baseLeftX - slide);
              }
              if (doorState.rightSprite) {
                doorState.rightSprite.x = pixelSnap(doorState.baseRightX + slide);
              }
            });
            renderer.animatedSprites = renderer.animatedSprites.filter((entry) => {
              if (!entry) {
                return false;
              }
              if (entry.kind === "blink") {
                const done = now - Number(entry.startedAt || now) >= Number(entry.durationMs || 140);
                if (done) {
                  (entry.nodes || []).forEach((node) => {
                    if (node) {
                      node.visible = true;
                    }
                  });
                }
                return !done;
              }
              if (entry.kind === "thrown-item") {
                const done = now - Number(entry.startedAt || now) >= Number(entry.durationMs || 700);
                if (done && entry.sprite && entry.sprite.parent) {
                  entry.sprite.parent.removeChild(entry.sprite);
                  entry.sprite.destroy?.();
                }
                return !done;
              }
              return !entry.exiting || entry.sprite.alpha > 0.02;
            });
            if (notifications.length > 0 && renderer.animatedSprites.some((entry) => entry && entry.kind === "motion")) {
              renderNotifications();
            }
          };
          renderer.app.ticker.add(renderer.animateTick);
          renderer.resizeObserver = new ResizeObserver(() => {
            if (renderer.model) {
              syncOfficeRendererScene(renderer, renderer.model);
            }
          });
          renderer.resizeObserver.observe(host);
        });
        officeSceneRenderers.set(key, renderer);
        await renderer.ready;
        return renderer;
      }

      function collectOfficeSceneAssetUrls(model) {
        const urls = new Set();
        model.roomDoors.forEach((door) => {
          if (door && door.leftSprite) {
            urls.add(door.leftSprite);
          }
          if (door && door.rightSprite) {
            urls.add(door.rightSprite);
          }
        });
        model.tileObjects.forEach((object) => {
          if (object && object.sprite) {
            urls.add(object.sprite);
          }
        });
        model.desks.forEach((desk) => {
          desk.shell.forEach((item) => {
            if (item && item.kind === "sprite" && item.sprite) {
              urls.add(item.sprite);
            }
          });
          desk.agents.forEach((agent) => {
            if (agent && agent.sprite) {
              urls.add(agent.sprite);
            }
            if (agent && agent.statusMarkerIconUrl) {
              urls.add(agent.statusMarkerIconUrl);
            }
          });
        });
        model.offices.forEach((office) => {
          office.shell.forEach((item) => {
            if (item && item.kind === "sprite" && item.sprite) {
              urls.add(item.sprite);
            }
          });
          if (office.agent && office.agent.sprite) {
            urls.add(office.agent.sprite);
          }
          if (office.agent && office.agent.statusMarkerIconUrl) {
            urls.add(office.agent.statusMarkerIconUrl);
          }
        });
        model.recAgents.forEach((agent) => {
          if (agent && agent.sprite) {
            urls.add(agent.sprite);
          }
          if (agent && agent.statusMarkerIconUrl) {
            urls.add(agent.statusMarkerIconUrl);
          }
        });
        model.facilities.forEach((facility) => {
          (facility.items || []).forEach((itemId) => {
            const itemDefinition = sceneHeldItemDefinition(itemId);
            if (itemDefinition && itemDefinition.sprite && itemDefinition.sprite.url) {
              urls.add(itemDefinition.sprite.url);
            }
          });
        });
        return [...urls];
      }

      async function ensureOfficeSceneAssets(model) {
  if (!window.PIXI) {
    return;
  }
  const pending = collectOfficeSceneAssetUrls(model).filter((url) => !loadedOfficeAssetUrls.has(url));
  if (pending.length === 0) {
    return;
  }
  const loadTimeoutMs = 4000;
  const preloadAsset = (url) => new Promise((resolve, reject) => {
    const image = new window.Image();
    let settled = false;
    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      callback();
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error("Asset load timed out: " + url)));
    }, loadTimeoutMs);
    image.onload = () => {
      finish(() => {
        try {
          window.PIXI.Texture.from(url);
        } catch {}
        loadedOfficeAssetImages.set(url, image);
        resolve(url);
      });
    };
    image.onerror = () => {
      finish(() => reject(new Error("Asset load failed: " + url)));
    };
    image.src = url;
  });
  const results = await Promise.allSettled(pending.map((url) => preloadAsset(url)));
  const failures = [];
  results.forEach((result, index) => {
    const url = pending[index];
    if (result.status === "fulfilled") {
      loadedOfficeAssetUrls.add(url);
      return;
    }
    failures.push({
      url,
      message: result.reason instanceof Error ? result.reason.message : String(result.reason)
    });
  });
  if (failures.length > 0) {
    console.warn("office scene asset load degraded", failures);
  }
}

function roleTint(role) {
        const tone = roleTone(role).replace("#", "");
        return Number.parseInt(tone, 16);
      }

      function pixelSnap(value, minimum = 0) {
        const snapped = Math.round(Number(value) || 0);
        return minimum > 0 ? Math.max(minimum, snapped) : snapped;
      }

      function pixiTextResolution(renderer) {
        const deviceScale = Math.max(1, Number(window.devicePixelRatio || 1));
        const sceneScale = Math.max(1, Number(renderer?.scale || 1));
        return Math.max(2, deviceScale * sceneScale);
      }

      function createPixiText(renderer, text, style) {
        const label = new window.PIXI.Text({
          text,
          style
        });
        label.resolution = pixiTextResolution(renderer);
        label.roundPixels = true;
        return label;
      }

      function tileBoundsLabel(width, height, tileSize) {
        const tileWidth = Math.max(1, Math.round(width / tileSize));
        const tileHeight = Math.max(1, Math.round(height / tileSize));
        return \`\${tileWidth}x\${tileHeight}\`;
      }

      function officeAvatarFootTile(room, tileSize, x, y, width, height) {
        if (!room) {
          return null;
        }
        const footX = x + width / 2;
        const footY = y + height - 1;
        const column = Math.max(0, Math.min(Math.floor(room.width / tileSize) - 1, Math.floor((footX - room.x) / tileSize)));
        const row = Math.max(0, Math.min(Math.floor((room.height - room.wallHeight) / tileSize) - 1, Math.floor((footY - room.floorTop) / tileSize)));
        return { column, row };
      }



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
          depthFootY: Number.isFinite(options.depthFootY) ? Math.round(options.depthFootY) : null,
          depthBaseY: Number.isFinite(options.depthBaseY) ? Math.round(options.depthBaseY) : null,
          depthRow: Number.isFinite(options.depthRow) ? Math.round(options.depthRow) : null,
          depthBias: Number.isFinite(options.depthBias) ? Number(options.depthBias) : null,
          z
        };
      }

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
