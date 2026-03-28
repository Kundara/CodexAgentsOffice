export const CLIENT_RUNTIME_RENDER_SOURCE = `          if (!isPathBoundary(previousChar)) {
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
      }

      function cleanReportedPath(projectRoot, location) {
        if (!location) {
          return "";
        }
        const normalized = relativeLocation(projectRoot, String(location));
        if (!normalized) {
          return normalized;
        }
        if (normalized === ".") {
          return ".";
        }
        return wslToWindowsPath(normalized);
      }

      function primaryFocusPath(snapshot, agent) {
        const focusPath = Array.isArray(agent.paths) && agent.paths.length > 0
          ? agent.paths.find((entry) => typeof entry === "string" && entry.length > 0) || null
          : null;
        if (focusPath) {
          return cleanReportedPath(snapshot.projectRoot, focusPath);
        }
        if (agent.cwd) {
          const cwd = cleanReportedPath(snapshot.projectRoot, agent.cwd);
          return cwd === "." ? null : cwd;
        }
        return null;
      }

      function formatUpdatedAt(value) {
        const updatedAt = Date.parse(value);
        if (!Number.isFinite(updatedAt)) {
          return value;
        }
        const deltaSeconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
        if (deltaSeconds < 60) {
          return \`\${deltaSeconds}s ago\`;
        }
        const deltaMinutes = Math.round(deltaSeconds / 60);
        if (deltaMinutes < 60) {
          return \`\${deltaMinutes}m ago\`;
        }
        const deltaHours = Math.round(deltaMinutes / 60);
        if (deltaHours < 24) {
          return \`\${deltaHours}h ago\`;
        }
        const deltaDays = Math.round(deltaHours / 24);
        return \`\${deltaDays}d ago\`;
      }

      function updatedAtAgeMs(value) {
        const updatedAt = Date.parse(value || "");
        if (!Number.isFinite(updatedAt)) {
          return null;
        }
        return Math.max(0, Date.now() - updatedAt);
      }

      function isDormantRestingAgent(agent) {
        if (!agent || agent.state === "waiting" || agent.isCurrent) {
          return false;
        }
        if (agent.state === "done") {
          return true;
        }
        const ageMs = updatedAtAgeMs(agent.updatedAt);
        return Number.isFinite(ageMs) && ageMs >= RESTING_DORMANT_MS && agent.isOngoing !== true;
      }

      function agentKindLabel(snapshot, agent) {
        const role = agentRoleLabel(agent).toLowerCase();
        if (agent.source === "cloud") {
          return \`cloud \${role}\`;
        }
        if (isLeadSession(snapshot, agent)) {
          return \`lead \${role}\`;
        }
        if (agent.parentThreadId) {
          return \`\${role} subagent\`;
        }
        return role;
      }

      function agentProvenanceLabel(agent) {
        return agent.confidence === "inferred"
          ? titleCaseWords(agent.provenance) + " inferred"
          : titleCaseWords(agent.provenance) + " typed";
      }

      function agentNetworkLabel(agent) {
        if (!agent || !agent.network) {
          return "";
        }
        const location = agent.network.peerHost ? \` @ \${agent.network.peerHost}\` : "";
        return \`\${agent.network.peerLabel}\${location}\`;
      }

      function agentHoverSourceLabel(agent, summarySource) {
        if (summarySource === "user") {
          return agent.confidence === "inferred" ? "User inferred" : "User typed";
        }
        return agentProvenanceLabel(agent);
      }

      function latestAgentMessage(agent) {
        const text = normalizeDisplayText("", agent && agent.latestMessage ? agent.latestMessage : "");
        return text || "";
      }

      function agentHoverSummary(snapshot, agent) {
        const message = latestAgentMessage(agent);
        if (message) {
          return { text: message, source: "agent" };
        }
        const detail = normalizeDisplayText(snapshot.projectRoot, agent.detail);
        const focus = primaryFocusPath(snapshot, agent);
        const source = agent.activityEvent && agent.activityEvent.type === "userMessage" ? "user" : "agent";
        if (!focus) {
          return { text: detail, source };
        }
        if (["Thinking", "Idle", "Finished recently", "No turns yet"].includes(detail)) {
          return { text: \`In \${focus}\`, source };
        }
        return { text: detail, source };
      }

      function notificationLabel(event) {
        if (!event) {
          return "";
        }
        switch (event.action) {
          case "created":
            return "Created";
          case "deleted":
            return "Deleted";
          case "moved":
            return "Moved";
          case "edited":
            return event.isImage ? "Updated" : "Edited";
          case "ran":
            return "Ran";
          case "said":
            return "Update";
          default:
            return "Changed";
        }
      }

      function notificationKindClassForFileChange(action) {
        switch (action) {
          case "created":
            return "create";
          case "deleted":
            return "blocked";
          case "moved":
            return "update";
          default:
            return "edit";
        }
      }

      function notificationFileName(projectRoot, location, fallback = "") {
        const cleaned = cleanReportedPath(projectRoot, location);
        const normalized = cleaned || String(fallback || "").trim();
        if (!normalized) {
          return "";
        }
        if (normalized === ".") {
          return projectLabel(projectRoot) || "workspace";
        }
        const parts = normalized.split(/[\\\\/]/).filter(Boolean);
        return parts[parts.length - 1] || normalized;
      }

      function fileChangeDescriptor(projectRoot, event, fallbackTitle, options = {}) {
        const path = event.path || null;
        const imageUrl =
          event.isImage && path && event.action !== "deleted"
            ? projectFileUrl(projectRoot, path)
            : null;
        return {
          kindClass: notificationKindClassForFileChange(event.action),
          label: notificationLabel(event),
          labelIconUrl: options.labelIconUrl || null,
          title: notificationFileName(projectRoot, path, fallbackTitle) || fallbackTitle || "Files",
          imageUrl,
          anchor: "agent",
          isFileChange: true,
          priority: NOTIFICATION_PRIORITY_DEFAULT,
          linesAdded: Number.isFinite(event.linesAdded) && Number(event.linesAdded) > 0 ? Math.max(0, Number(event.linesAdded)) : null,
          linesRemoved: Number.isFinite(event.linesRemoved) && Number(event.linesRemoved) > 0 ? Math.max(0, Number(event.linesRemoved)) : null
        };
      }

      function commandDescriptor(kindClass, label, title, options = {}) {
        return {
          kindClass,
          label,
          title,
          labelIconUrl: options.labelIconUrl || null,
          imageUrl: null,
          anchor: "agent",
          isFileChange: false,
          isCommand: options.isCommand === true,
          priority: Number.isFinite(options.priority) ? Number(options.priority) : NOTIFICATION_PRIORITY_DEFAULT,
          linesAdded: null,
          linesRemoved: null
        };
      }

      function eventIconUrlForMethod(method) {
        if (typeof method !== "string" || method.length === 0) {
          return null;
        }
        if (Object.prototype.hasOwnProperty.call(eventIconUrls, method)) {
          return eventIconUrls[method];
        }
        if (method === "turn/interrupted" || method === "turn/failed") {
          return eventIconUrls["turn/completed"] || null;
        }
        return null;
      }

      function eventIconUrlForThreadItemType(type) {
        if (typeof type !== "string" || type.length === 0) {
          return null;
        }
        if (Object.prototype.hasOwnProperty.call(threadItemIconUrls, type)) {
          return threadItemIconUrls[type];
        }
        return null;
      }

      function eventIconUrlForActivityType(type, options = {}) {
        switch (type) {
          case "approval":
            return eventIconUrlForMethod(
              options.approvalType === "fileChange"
                ? "item/fileChange/requestApproval"
                : "item/commandExecution/requestApproval"
            );
          case "input":
            return eventIconUrlForMethod("item/tool/requestUserInput");
          default:
            return options.isCommand ? null : eventIconUrlForThreadItemType(type);
        }
      }

      function splitShellWords(command) {
        const text = String(command || "").trim();
        const parts = [];
        let current = "";
        let quote = "";
        for (let index = 0; index < text.length; index += 1) {
          const character = text[index];
          if (quote) {
            if (character === quote) {
              quote = "";
            } else {
              current += character;
            }
            continue;
          }
          const code = character.charCodeAt(0);
          if (code === 39 || code === 34) {
            quote = character;
            continue;
          }
          if (code === 32 || code === 9 || code === 10 || code === 13) {
            if (current) {
              parts.push(current);
              current = "";
            }
            continue;
          }
          current += character;
        }
        if (current) {
          parts.push(current);
        }
        return parts;
      }

      function commandPathTokens(tokens) {
        return tokens.filter((token, index) => {
          if (!token || index === 0 || token.startsWith("-")) {
            return false;
          }
          if (token === "|" || token === "&&" || token === "||") {
            return false;
          }
          for (let index = 0; index < token.length; index += 1) {
            const code = token.charCodeAt(index);
            if (code === 47 || code === 92 || code === 46) {
              return true;
            }
          }
          return false;
        });
      }

      function readCommandDescriptor(snapshot, command, phase, method) {
        if (!command || phase === "failed" || method === "item/commandExecution/requestApproval") {
          return null;
        }
        const tokens = splitShellWords(command);
        if (tokens.length === 0) {
          return null;
        }
        const executable = tokens[0];
        const pathTokens = commandPathTokens(tokens);
        const firstPath = pathTokens[0] || "";
        const firstPathLabel = firstPath
          ? notificationFileName(snapshot.projectRoot, firstPath, firstPath)
          : "file";

        let title = "";
        if (executable === "sed" || executable === "cat" || executable === "head" || executable === "tail" || executable === "less" || executable === "more" || executable === "bat") {
          title = "Read " + firstPathLabel;
        } else if (executable === "rg" || executable === "grep") {
          title =
            pathTokens.length > 1 ? "Exploring " + pathTokens.length + " files"
            : firstPath ? "Search " + firstPathLabel
            : "Search files";
        } else if (executable === "ls" || executable === "find" || executable === "tree") {
          title =
            pathTokens.length > 1 ? "Exploring " + pathTokens.length + " files"
            : firstPath ? "Explore " + cleanReportedPath(snapshot.projectRoot, firstPath)
            : "Explore files";
        } else {
          return null;
        }

        return commandDescriptor("read", "", title, {
          isCommand: false,
          labelIconUrl: eventIconUrlForMethod(method) || eventIconUrlForActivityType("commandExecution", { isCommand: false })
        });
      }

      function typedNotificationKey(event) {
        if (!event) {
          return null;
        }
        return event.requestId
          ? "request::" + event.requestId
          : event.itemId
            ? "item::" + event.itemId + "::" + (event.method || event.kind)
            : "event::" + event.id;
      }

      function agentHasTypedEvent(snapshot, agent) {
        if (!snapshot || !agent || !agent.threadId) {
          return false;
        }
        const agentUpdatedAt = Date.parse(agent.updatedAt || "");
        return (snapshot.events || []).some((event) => {
          if (event.threadId !== agent.threadId) {
            return false;
          }
          if (event.kind === "status") {
            return false;
          }
          const createdAt = Date.parse(event.createdAt || "");
          if (!Number.isFinite(createdAt) || !Number.isFinite(agentUpdatedAt)) {
            return true;
          }
          return createdAt >= agentUpdatedAt - 15000;
        });
      }

      function latestTypedMessageEvent(snapshot, agent) {
        if (!snapshot || !agent || !agent.threadId) {
          return null;
        }
        const matching = (snapshot.events || [])
          .filter((event) => event.threadId === agent.threadId && event.kind === "message");
        if (matching.length === 0) {
          return null;
        }
        return matching.sort((left, right) => {
          const leftAt = Date.parse(left.createdAt || "");
          const rightAt = Date.parse(right.createdAt || "");
          return (Number.isFinite(rightAt) ? rightAt : 0) - (Number.isFinite(leftAt) ? leftAt : 0);
        })[0] || null;
      }

      function notificationDescriptor(snapshot, agent, previous) {
        const event = agent.activityEvent;
        const stateChanged = !previous || previous.state !== agent.state || previous.detail !== agent.detail;
        const latestMessageChanged = Boolean(agent.latestMessage) && agent.latestMessage !== (previous ? previous.latestMessage : null);
        const typedMessageEvent = latestTypedMessageEvent(snapshot, agent);

        if (latestMessageChanged) {
          return {
            kindClass: "update",
            label: "",
            labelIconUrl: eventIconUrlForActivityType("agentMessage"),
            title: normalizeDisplayText(snapshot.projectRoot, typedMessageEvent?.detail || agent.latestMessage),
            imageUrl: null,
            anchor: "agent",
            isFileChange: false,
            isCommand: false,
            isTextMessage: true,
            priority: NOTIFICATION_PRIORITY_MESSAGE,
            linesAdded: null,
            linesRemoved: null
          };
        }

        if (!agent.isCurrent && !(stateChanged && (agent.state === "waiting" || agent.state === "blocked"))) {
          return null;
        }

        if (agentHasTypedEvent(snapshot, agent) && !(typedMessageEvent && stateChanged)) {
          return null;
        }

        if (event && agent.isCurrent) {
          if (event.type === "userMessage") {
            return null;
          }

          if (event.type === "fileChange") {
            return fileChangeDescriptor(snapshot.projectRoot, event, notificationTitle(snapshot, agent), {
              labelIconUrl: eventIconUrlForActivityType("fileChange")
            });
          }

          if (event.type === "commandExecution") {
            const readDescriptor = readCommandDescriptor(
              snapshot,
              notificationTitle(snapshot, agent),
              agent.state === "blocked" ? "failed" : "started",
              ""
            );
            if (readDescriptor) {
              return readDescriptor;
            }
            return commandDescriptor(
              agent.state === "blocked" ? "blocked" : "run",
              agent.state === "blocked" ? "Failed" : "Ran",
              notificationTitle(snapshot, agent),
              { isCommand: true }
            );
          }

          if (event.type === "webSearch" && stateChanged) {
            return {
              kindClass: "update",
              label: "",
              labelIconUrl: eventIconUrlForActivityType("webSearch"),
              title: webSearchNotificationTitle(snapshot.projectRoot, event.title, "completed"),
              imageUrl: null,
              anchor: "agent",
              isFileChange: false,
              isCommand: false,
              isTextMessage: false,
              priority: NOTIFICATION_PRIORITY_MESSAGE,
              linesAdded: null,
              linesRemoved: null
            };
          }

          if (event.type === "agentMessage" && stateChanged) {
            return {
              kindClass: "update",
              label: "",
              labelIconUrl: eventIconUrlForActivityType("agentMessage"),
              title: notificationTitle(snapshot, agent),
              imageUrl: null,
              anchor: "agent",
              isFileChange: false,
              isCommand: false,
              isTextMessage: true,
              priority: NOTIFICATION_PRIORITY_MESSAGE,
              linesAdded: null,
              linesRemoved: null
            };
          }

          const genericIconUrl = eventIconUrlForActivityType(event.type);
          if (genericIconUrl && stateChanged) {
            return {
              kindClass:
                agent.state === "blocked" ? "blocked"
                : agent.state === "waiting" ? "waiting"
                : "update",
              label: "",
              labelIconUrl: genericIconUrl,
              title: notificationTitle(snapshot, agent),
              imageUrl: null,
              anchor: "agent",
              isFileChange: false,
              isCommand: false,
              priority: NOTIFICATION_PRIORITY_DEFAULT,
              linesAdded: null,
              linesRemoved: null
            };
          }
        }

        if (!stateChanged) {
          return null;
        }

        if (agent.needsUser && agent.needsUser.kind === "approval") {
          return {
            kindClass: "blocked",
            label: "Needs",
            labelIconUrl: eventIconUrlForActivityType("approval"),
            title: agent.needsUser.command || agent.needsUser.reason || "approval",
            imageUrl: null,
            anchor: "agent",
            isFileChange: false,
            isCommand: false,
            linesAdded: null,
            linesRemoved: null
          };
        }

        if (agent.needsUser && agent.needsUser.kind === "input") {
          return {
            kindClass: "waiting",
            label: "Needs",
            labelIconUrl: eventIconUrlForActivityType("input"),
            title: agent.needsUser.reason || "input",
            imageUrl: null,
            anchor: "agent",
            isFileChange: false,
            isCommand: false,
            linesAdded: null,
            linesRemoved: null
          };
        }

        return null;
      }


      function renderAgentHover(snapshot, agent, options = {}) {
        const lead = parentLabelFor(snapshot, agent);
        const summary = agentHoverSummary(snapshot, agent);
        const hoverTitle = agent.nickname || agent.label;
        const className = options.className || "agent-hover";
        const styleAttr = options.style ? \` style="\${escapeHtml(options.style)}"\` : "";
        const summaryClass = summary.source === "user"
          ? "agent-hover-summary agent-hover-summary-user"
          : "agent-hover-summary";
        const metaParts = [
          \`<span>\${escapeHtml(titleCaseWords(agentKindLabel(snapshot, agent)))}</span>\`,
          \`<span>\${escapeHtml(agentHoverSourceLabel(agent, summary.source))}</span>\`,
          agent.network
            ? \`<span class="agent-hover-peer">\${escapeHtml(agent.network.peerLabel)}</span>\${agent.network.peerHost ? \`<span>\${escapeHtml(" @ " + agent.network.peerHost)}</span>\` : ""}\`
            : "",
          lead ? \`<span>\${escapeHtml("with " + lead)}</span>\` : "",
          \`<span>\${escapeHtml(formatUpdatedAt(agent.updatedAt))}</span>\`
        ].filter(Boolean);
        const meta = metaParts.join('<span class="agent-hover-separator"> · </span>');

        return \`<div class="\${escapeHtml(className)}"\${styleAttr}><div class="agent-hover-title"><strong>\${escapeHtml(hoverTitle)}</strong></div><div class="\${escapeHtml(summaryClass)}">\${escapeHtml(summary.text)}</div><div class="agent-hover-meta">\${meta}</div></div>\`;
      }

      function flattenRooms(rooms) {
        const output = [];
        const queue = [...rooms];
        while (queue.length > 0) {
          const room = queue.shift();
          output.push(room);
          if (Array.isArray(room.children)) queue.unshift(...room.children);
        }
        return output.sort((left, right) => (right.width * right.height) - (left.width * left.height));
      }

      function fitSpriteToWidth(sprite, width, minScale, maxScale) {
        return Math.max(minScale, Math.min(maxScale, width / sprite.w));
      }

      function fileSpriteForRole(role) {
        switch (role) {
          case "explorer":
          case "office_mapper":
            return pixelOffice.props.fileBlue;
          case "worker":
          case "engineer":
          case "implementer":
            return pixelOffice.props.fileGreen;
          default:
            return pixelOffice.props.filePurple;
        }
      }

      function sofaSpriteAt(index) {
        const sofas = [
          pixelOffice.props.sofaOrange,
          pixelOffice.props.sofaGray,
          pixelOffice.props.sofaBlue,
          pixelOffice.props.sofaGreen
        ];
        return sofas[index % sofas.length];
      }

      function recRoomSofaLayout(compact, roomPixelWidth, baseY) {
        const tile = sceneTileSize(compact);
        const roomWidthTiles = Math.round(roomPixelWidth / tile);
        const rightColumn = roomWidthTiles - 7;
        const leftColumn = rightColumn - 3;
        return {
          scale: 1,
          sofaWidth: tile * 2,
          sofaHeight: tile,
          sofas: [
            { id: "sofa-left", sprite: sofaSpriteAt(1), x: leftColumn * tile, y: baseY },
            { id: "sofa-right", sprite: sofaSpriteAt(0), x: rightColumn * tile, y: baseY }
          ]
        };
      }

      function primaryFurnitureDefaults(room) {
        const rightSofaColumn = room.width - 7;
        const leftSofaColumn = rightSofaColumn - 3;
        return [
          { id: "vending", sprite: pixelOffice.props.vending, column: 0, baseRow: 0, widthTiles: 1, heightTiles: 2, z: 3, furniture: true },
          { id: "cooler", sprite: pixelOffice.props.cooler, column: 2, baseRow: 0, widthTiles: 1, heightTiles: 1, z: 3, furniture: true },
          { id: "counter", sprite: pixelOffice.props.counter, column: 3, baseRow: 0, widthTiles: 2, heightTiles: 1, z: 3, furniture: true },
          { id: "sofa-left", sprite: sofaSpriteAt(1), column: leftSofaColumn, baseRow: 0, widthTiles: 2, heightTiles: 1, z: 3, furniture: true },
          { id: "sofa-right", sprite: sofaSpriteAt(0), column: rightSofaColumn, baseRow: 0, widthTiles: 2, heightTiles: 1, z: 4, furniture: true },
          { id: "shelf", sprite: pixelOffice.props.bookshelf, column: room.width - 2, baseRow: 0, widthTiles: 1, heightTiles: 2, z: 3, furniture: true }
        ];
      }

      function tileFootprintForSprite(sprite, tileSize) {
        return {
          widthTiles: Math.max(1, Math.ceil((Number(sprite?.w) || tileSize) / tileSize)),
          heightTiles: Math.max(1, Math.ceil((Number(sprite?.h) || tileSize) / tileSize))
        };
      }

      function normalizeFurnitureItem(item, tileSize) {
        const footprint = tileFootprintForSprite(item.sprite, tileSize);
        return {
          ...item,
          widthTiles: footprint.widthTiles,
          heightTiles: footprint.heightTiles
        };
      }

      function rectanglesOverlap(a, b) {
        return a.column < b.column + b.widthTiles
          && a.column + a.widthTiles > b.column
          && a.baseRow < b.baseRow + b.heightTiles
          && a.baseRow + a.heightTiles > b.baseRow;
      }

      function resolveFurnitureLayout(snapshot, room, tileSize) {
        const defaults = primaryFurnitureDefaults(room).map((item) => normalizeFurnitureItem(item, tileSize));
        const placed = [];
        defaults.forEach((item) => {
          const requested = furnitureColumnOverride(snapshot.projectRoot, room.id, item.id, item.column);
          const maxColumn = Math.max(0, room.width - item.widthTiles);
          let column = Math.max(0, Math.min(maxColumn, requested));
          while (placed.some((other) => rectanglesOverlap({ ...item, column }, other)) && column < maxColumn) {
            column += 1;
          }
          while (placed.some((other) => rectanglesOverlap({ ...item, column }, other)) && column > 0) {
            column -= 1;
          }
          const resolved = { ...item, column };
          placed.push(resolved);
        });
        return placed;
      }

      function recRoomSeatSlotAt(agent, index, compact, roomPixelWidth, baseY, sofaColumns = null) {
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
      }

      function computerSpriteForAgent(agent, mirrored) {
        return pixelOffice.props.workstation;
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
          alpha: options.alpha ?? 1,
          z
        };
      }

      function buildCubicleCellVisualModel(snapshot, agent, role, x, y, boothWidth, boothHeight, compact, options = {}) {
        const state = agent?.state || "idle";
        const avatar = agent ? avatarForAgent(agent) : null;
        const avatarScale = compact ? 1.25 : 1.5;
        const avatarWidth = avatar ? avatar.w * avatarScale : 0;
        const avatarHeight = avatar ? avatar.h * avatarScale : 0;
        const mirrored = options.mirrored === true;
        const chair = agent ? chairSpriteForAgent(agent) : pixelOffice.chairs[0];
        const deskSprite = pixelOffice.props.cubiclePanelLeft;
        const deskScale = fitSpriteToWidth(
          deskSprite,
          boothWidth * (options.lead ? 0.2 : 0.18),
          compact ? 1.28 : 1.42,
          compact ? 1.44 : 1.62
        );
        const computerSprite = computerSpriteForAgent(agent, mirrored);
        const workstationScale = fitSpriteToWidth(
          computerSprite,
          boothWidth * (options.lead ? 0.23 : 0.21),
          compact ? 1.32 : 1.48,
          compact ? 1.68 : 1.96
        );
        const chairScale = compact ? 1.18 : 1.34;
        const deskWidth = deskSprite.w * deskScale;
        const deskHeight = deskSprite.h * deskScale;
        const workstationWidth = computerSprite.w * workstationScale;
        const workstationHeight = computerSprite.h * workstationScale;
        const chairWidth = chair.w * chairScale;
        const chairHeight = chair.h * chairScale;
        const sceneTile = sceneTileSize(compact);
        const centerX = Math.round(boothWidth / 2);
        const innerInset = compact ? 4 : 6;
        const centerInset = options.sharedCenter ? 0 : innerInset;
        const deskEdgeClamp = options.sharedCenter ? 0 : 2;
        const workstationX = mirrored
          ? centerInset
          : Math.round(boothWidth - workstationWidth - centerInset);
        const deskX = mirrored
          ? Math.max(deskEdgeClamp, Math.round(workstationX + workstationWidth * 0.54 - deskWidth * 0.52))
          : Math.max(deskEdgeClamp, Math.round(workstationX + workstationWidth * 0.48 - deskWidth * 0.5));
        const deskY = Math.round(boothHeight - deskHeight - (compact ? 11 : 13) + sceneTile);
        const workstationY = Math.round(deskY - workstationHeight * (compact ? 0.2 : 0.18));
        const chairOutset = compact ? 7 : 10;
        const chairLift = compact ? 1 : 2;
        const chairX = (mirrored
          ? Math.round(workstationX + workstationWidth - chairWidth * 0.18)
          : Math.round(workstationX - chairWidth * 0.82))
          + (mirrored ? chairOutset : -chairOutset);
        const chairY = Math.round(deskY + deskHeight - chairHeight * 0.74) - chairLift;
        const minAvatarX = 2;
        const maxAvatarX = boothWidth - avatarWidth - 2;
        const clampAvatarX = (value) => Math.max(minAvatarX, Math.min(maxAvatarX, value));
        const sideX = mirrored
          ? clampAvatarX(Math.round(deskX + deskWidth + (compact ? 6 : 8)))
          : clampAvatarX(Math.round(deskX - avatarWidth - (compact ? 6 : 8)));
        const avatarPose = (() => {
          if (!agent) {
            return null;
          }
          const workstationFlip = mirrored;
          const baseY = Math.round(deskY + deskHeight - avatarHeight + (compact ? 1 : 2));
          const seatInset = chairWidth * 0.22 - (compact ? 4 : 6);
          const seatedX = mirrored
            ? clampAvatarX(Math.round(chairX + chairWidth - avatarWidth - seatInset))
            : clampAvatarX(Math.round(chairX + seatInset));
          if (state === "editing" || state === "thinking" || state === "planning" || state === "scanning" || state === "delegating") {
            return { x: seatedX, y: Math.max(0, baseY - (compact ? 1 : 3)), flip: workstationFlip };
`;
