export const CLIENT_RUNTIME_UI_SOURCE = `      function renderSessions(snapshot) {
        if (!snapshot || snapshot.agents.length === 0) {
          return '<div class="empty">No live or recent lead sessions in the selected workspace right now.</div>';
        }

        const sorted = [...snapshot.agents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        return renderNeedsAttention([snapshot]) + sorted.map((agent) => {
          const appearanceProjectRoot = agent.sourceProjectRoot || snapshot.projectRoot;
          const appearanceAgentId = agent.sourceAgentId || agent.id;
          const appearanceAction = agent.network
            ? ""
            : \`<button data-action="cycle-look" data-project-root="\${escapeHtml(appearanceProjectRoot)}" data-agent-id="\${escapeHtml(appearanceAgentId)}">Cycle look</button>\`;
          const focusKeys = escapeHtml(JSON.stringify(collectFocusedSessionKeys(snapshot, agent)));
          const description = normalizeDisplayText(snapshot.projectRoot, agent.detail)
            || latestAgentMessage(agent)
            || \`[\${agent.state}]\`;
          const sourceLabel = agentNetworkLabel(agent);
          const fullDescription = sourceLabel ? \`\${sourceLabel} · \${description}\` : description;
          return \`<article class="session-card" tabindex="0" data-focus-keys="\${focusKeys}"><div class="session-card-header"><strong class="session-card-title">\${escapeHtml(agent.label)}</strong><div class="card-actions">\${appearanceAction}</div></div><div class="muted session-card-description" title="\${escapeHtml(fullDescription)}">\${escapeHtml(fullDescription)}</div></article>\`;
        }).join("");
      }

      function renderFleetSessions(projects) {
        const entries = projects.flatMap((snapshot) =>
          snapshot.agents.map((agent) => ({ snapshot, agent }))
        );

        if (entries.length === 0) {
          return '<div class="empty">No live or recent lead sessions across the tracked workspaces right now.</div>';
        }

        entries.sort((left, right) => right.agent.updatedAt.localeCompare(left.agent.updatedAt));
        return renderNeedsAttention(projects) + entries.map(({ snapshot, agent }) => {
          const appearanceProjectRoot = agent.sourceProjectRoot || snapshot.projectRoot;
          const appearanceAgentId = agent.sourceAgentId || agent.id;
          const appearanceAction = agent.network
            ? ""
            : \`<button data-action="cycle-look" data-project-root="\${escapeHtml(appearanceProjectRoot)}" data-agent-id="\${escapeHtml(appearanceAgentId)}">Cycle look</button>\`;
          const focusKeys = escapeHtml(JSON.stringify(collectFocusedSessionKeys(snapshot, agent)));
          const detail = normalizeDisplayText(snapshot.projectRoot, agent.detail)
            || latestAgentMessage(agent)
            || \`[\${agent.state}]\`;
          const sourceLabel = agentNetworkLabel(agent);
          const description = projectLabel(snapshot.projectRoot) + " · " + (sourceLabel ? sourceLabel + " · " : "") + detail;
          return \`<article class="session-card" tabindex="0" data-focus-keys="\${focusKeys}"><div class="session-card-header"><strong class="session-card-title">\${escapeHtml(agent.label)}</strong><div class="card-actions">\${appearanceAction}</div></div><div class="muted session-card-description" title="\${escapeHtml(description)}">\${escapeHtml(description)}</div></article>\`;
        }).join("");
      }

      function applySessionFocus() {
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
      }

      function syncSessionFocusFromDom() {
        const activeSceneAgent = document.querySelector("[data-focus-agent]:focus-within, [data-focus-agent]:hover");
        if (activeSceneAgent instanceof HTMLElement) {
          setSessionFocusFromElement(activeSceneAgent);
          return;
        }
        const activeCard = document.querySelector(".session-card:focus-within, .session-card:hover");
        if (activeCard instanceof HTMLElement) {
          setSessionFocusFromElement(activeCard);
          return;
        }
        state.focusedSessionKeys = [];
        applySessionFocus();
      }

      function syncLiveAgentState(projects) {
        const now = Date.now();
        const previousKeys = new Set(liveAgentMemory.keys());
        const nextMemory = new Map();

        for (const snapshot of projects) {
          for (const agent of snapshot.agents) {
            const key = agentKey(snapshot.projectRoot, agent);
            nextMemory.set(key, {
              key,
              projectRoot: snapshot.projectRoot,
              roomId: agent.roomId,
              agent
            });
          }
        }

        enteringAgentKeys = previousKeys.size === 0 || screenshotMode
          ? new Set()
          : new Set(
              [...nextMemory.keys()].filter((key) => !previousKeys.has(key))
            );

        for (const [key, entry] of liveAgentMemory.entries()) {
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
        }

        departingAgents = departingAgents.filter((ghost) => ghost.expiresAt > now && !nextMemory.has(ghost.key));
        liveAgentMemory.clear();
        for (const [key, entry] of nextMemory.entries()) {
          liveAgentMemory.set(key, entry);
        }
      }

      function fitScenes() {
        const wrappers = document.querySelectorAll("[data-scene-fit]");
        const canZoom = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("zoom", "1");
        wrappers.forEach((wrapper) => {
          const grid = wrapper.querySelector("[data-scene-grid]");
          if (!(wrapper instanceof HTMLElement) || !(grid instanceof HTMLElement)) {
            return;
          }

          const rawWidth = Number.parseFloat(grid.style.width || "0");
          const rawHeight = Number.parseFloat(grid.style.height || "0");
          if (!rawWidth || !rawHeight) {
            return;
          }

          const focusMode = wrapper.dataset.sceneMode === "focus";
          const towerMode = wrapper.closest(".tower-floor-body") instanceof HTMLElement;
          const availableWidth = Math.max(wrapper.clientWidth - (focusMode ? 0 : 4), 1);
          const wrapperRect = wrapper.getBoundingClientRect();
          const viewportRemaining = Math.max(window.innerHeight - wrapperRect.top - (focusMode ? 0 : 20), 1);
          const availableHeight = focusMode
            ? Math.max(wrapper.clientHeight || viewportRemaining, 1)
            : Math.max(
              Math.min(
                viewportRemaining,
                window.innerHeight * (
                  towerMode
                    ? (wrapper.classList.contains("compact") ? 0.52 : 0.72)
                    : (wrapper.classList.contains("compact") ? 0.34 : 0.68)
                )
              ),
              wrapper.classList.contains("compact")
                ? (towerMode ? 240 : 180)
                : 220
            );
          if (focusMode) {
            const coverScale = Math.max(availableWidth / rawWidth, availableHeight / rawHeight);
            const boundedCoverScale = Number.isFinite(coverScale) && coverScale > 0
              ? Math.min(Math.max(coverScale, 0.2), 6)
              : 1;

            wrapper.style.height = \`\${Math.max(1, Math.round(availableHeight))}px\`;
            grid.style.zoom = "";
            grid.style.transform = \`translate(-50%, -50%) scale(\${boundedCoverScale})\`;
            wrapper.dataset.sceneFitted = "true";
            return;
          }

          if (towerMode) {
            const scale = availableWidth / rawWidth;
            const boundedScale = Number.isFinite(scale) && scale > 0
              ? Math.min(Math.max(scale, 0.2), 3.5)
              : 1;

            wrapper.style.height = \`\${Math.max(220, Math.round(rawHeight * boundedScale))}px\`;
            if (canZoom) {
              grid.style.zoom = String(boundedScale);
              grid.style.transform = "";
            } else {
              grid.style.zoom = "";
              grid.style.transform = \`scale(\${boundedScale})\`;
            }
            wrapper.dataset.sceneFitted = "true";
            return;
          }

          const heightScale = wrapper.classList.contains("compact")
            ? availableHeight / rawHeight
            : Math.max(1, availableHeight / rawHeight);
          const scale = Math.min(availableWidth / rawWidth, heightScale);
          const boundedScale = Number.isFinite(scale) && scale > 0
            ? Math.min(Math.max(scale, 0.2), 3.5)
            : 1;

          wrapper.style.height = \`\${Math.max(160, Math.round(rawHeight * boundedScale))}px\`;
          if (canZoom) {
            grid.style.zoom = String(boundedScale);
            grid.style.transform = "";
          } else {
            grid.style.zoom = "";
            grid.style.transform = \`scale(\${boundedScale})\`;
          }
          wrapper.dataset.sceneFitted = "true";
        });
      }

      async function postJson(path, payload = {}) {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        return response.json();
      }

      function setTextIfChanged(element, value) {
        if (!element) {
          return false;
        }
        const next = String(value ?? "");
        if (element.textContent === next) {
          return false;
        }
        element.textContent = next;
        return true;
      }

      function setHtmlIfChanged(element, html, options = {}) {
        if (!element) {
          return false;
        }
        if (element.dataset.renderHtml === html) {
          return false;
        }

        const preserveScroll = options.preserveScroll === true;
        const scrollTop = preserveScroll ? element.scrollTop : 0;
        const scrollLeft = preserveScroll ? element.scrollLeft : 0;
        element.innerHTML = html;
        element.dataset.renderHtml = html;
        if (preserveScroll) {
          element.scrollTop = scrollTop;
          element.scrollLeft = scrollLeft;
        }
        return true;
      }

      function currentSnapshot() {
        if (!state.fleet) return null;
        if (state.selected === "all") return null;
        return state.fleet.projects.find((snapshot) => snapshot.projectRoot === state.selected) || null;
      }

      function renderHeroSummary(counts) {
        return [
          ["Agents", counts.total, "primary"],
          ["Active", counts.active, "is-active"],
          ["Waiting", counts.waiting, "is-waiting"],
          ["Blocked", counts.blocked, "is-blocked"],
          ["Cloud", counts.cloud, "is-cloud"]
        ].map(([label, value, className]) =>
          \`<span class="hero-summary-item \${className}"><strong>\${value}</strong><span>\${label}</span></span>\`
        ).join("");
      }

      function ingestFleet(fleet) {
        state.localFleet = fleet;
        applyFleet(fleet);
        scheduleMultiplayerBroadcast();
      }

      function render() {
        if (!state.fleet) return;

        const fleet = state.fleet;
        const rawProjects = visibleProjects(fleet);
        const floorProjects = mergeWorktreeProjects(rawProjects);
        const towerProjects = state.selected === "all" ? floorProjects : rawProjects;
        updateRecentLeadReservations(towerProjects);
        const displayedProjects = towerProjects.map((project) => viewSnapshot(project, SCENE_RECENT_LEAD_LIMIT));
        const sessionProjects = towerProjects.map((project) => viewSessionSnapshot(project, SESSION_RECENT_LEAD_LIMIT));
        const selectedRawSnapshot = currentSnapshot();
        const snapshot = selectedRawSnapshot
          ? viewSnapshot(selectedRawSnapshot, SCENE_RECENT_LEAD_LIMIT, rawProjects)
          : null;
        const sessionSnapshot = selectedRawSnapshot
          ? viewSessionSnapshot(selectedRawSnapshot, SESSION_RECENT_LEAD_LIMIT, rawProjects)
          : null;
        if (!snapshot && state.workspaceFullscreen) {
          state.workspaceFullscreen = false;
          syncUrl();
        }
        syncLiveAgentState(state.selected === "all" ? towerProjects : rawProjects);
        sceneStateDraft = null;
        const counts = fleetCounts({ projects: sessionProjects });
        const nextSceneToken = state.view === "map"
          ? (snapshot
            ? \`project-shell::\${snapshot.projectRoot}::\${state.workspaceFullscreen ? "focus" : "default"}\`
            : \`fleet-shell::\${displayedProjects.map((project) => project.projectRoot).join("||")}\`)
          : (snapshot
            ? \`project::\${sceneSnapshotToken(snapshot)}\`
            : \`fleet::\${displayedProjects.map(sceneSnapshotToken).join("||")}\`);

        setTextIfChanged(stamp, \`Updated \${fleet.generatedAt}\`);
        setTextIfChanged(projectCount, \`\${fleet.projects.length} tracked · \${floorProjects.length} floors · \${displayedProjects.filter((project) => busyCount(project) > 0).length} live · \${SESSION_RECENT_LEAD_LIMIT} recent sessions\`);
        mapViewButton.classList.toggle("active", state.view === "map");
        terminalViewButton.classList.toggle("active", state.view === "terminal");
        setConnection(state.connection);
        rememberVisibleRecentLeads(displayedProjects);
        syncWorkspaceFullscreenUi();
        syncFleetBackdrop();
        syncSkyParallax();
        if (state.view !== "map") {
          cleanupOfficeRenderers();
        }

        setHtmlIfChanged(heroSummary, renderHeroSummary(counts));

        setHtmlIfChanged(projectTabs, [
          \`<button class="project-tab\${state.selected === "all" ? " active" : ""}" data-action="select-project" data-project-root="all">All</button>\`,
          ...rawProjects.map((project) => {
            const counts = countsForSnapshot(project);
            const activeClass = project.projectRoot === state.selected ? " active" : "";
            const badge = counts.active;
            return \`<button class="project-tab\${activeClass}" data-action="select-project" data-project-root="\${escapeHtml(project.projectRoot)}" title="\${escapeHtml(project.projectRoot)}">\${escapeHtml(projectLabel(project.projectRoot))} <span class="muted">\${badge}</span></button>\`;
          })
        ].join(""));

        try {
          if (!snapshot) {
            const shouldRenderScene = state.view !== "map" || nextSceneToken !== lastSceneRenderToken;
            const centerChanged = shouldRenderScene
              ? setHtmlIfChanged(centerContent, renderWorkspaceScroll(displayedProjects), { preserveScroll: true })
              : false;
            if (shouldRenderScene) {
              lastSceneRenderToken = nextSceneToken;
            }
            setHtmlIfChanged(sessionList, renderFleetSessions(sessionProjects), { preserveScroll: true });
            setTextIfChanged(centerTitle, "All Workspaces");
            setTextIfChanged(roomsPath, \`Live agents on the floor plus \${SESSION_RECENT_LEAD_LIMIT} recent sessions in the panel across tracked workspaces\`);
            if (centerChanged) {
              fitScenes();
            }
            if (sceneStateDraft) {
              renderedAgentSceneState = sceneStateDraft;
            }
            sceneStateDraft = null;
            syncSessionFocusFromDom();
            syncWorkstationEffects();
            if (state.view === "map") {
              void syncOfficeMapScenes(displayedProjects);
            }
            renderNotifications();
            return;
          }

          setTextIfChanged(centerTitle, projectLabel(snapshot.projectRoot));
          const shouldRenderScene = state.view !== "map" || nextSceneToken !== lastSceneRenderToken;
          const centerChanged = shouldRenderScene
            ? setHtmlIfChanged(
              centerContent,
              state.view === "terminal"
                ? renderTerminalSnapshot(snapshot)
                : \`<div class="workspace-tower workspace-tower-single">\${renderWorkspaceFloor(snapshot, {
                  compact: true,
                  focusMode: state.workspaceFullscreen,
                  action: {
                    type: "toggle-workspace-focus",
                    label: state.workspaceFullscreen ? "Close" : "Expand"
                  }
                })}</div>\`,
              { preserveScroll: true }
            )
            : false;
          if (shouldRenderScene) {
            lastSceneRenderToken = nextSceneToken;
          }
          const sessionsHtml = renderSessions(sessionSnapshot || snapshot);
          setHtmlIfChanged(sessionList, sessionsHtml, { preserveScroll: true });
          setTextIfChanged(
            roomsPath,
            snapshot.rooms.generated
              ? \`Auto rooms · floor shows live agents plus \${SCENE_RECENT_LEAD_LIMIT} recent leads · panel shows \${SESSION_RECENT_LEAD_LIMIT} recent sessions\`
              : \`.codex-agents/rooms.xml · floor shows live agents plus \${SCENE_RECENT_LEAD_LIMIT} recent leads · panel shows \${SESSION_RECENT_LEAD_LIMIT} recent sessions\`
          );
          if (centerChanged) {
            fitScenes();
          }
          if (sceneStateDraft) {
            renderedAgentSceneState = sceneStateDraft;
          }
          sceneStateDraft = null;
          syncSessionFocusFromDom();
          syncWorkstationEffects();
          if (state.view === "map") {
            void syncOfficeMapScenes(snapshot ? [snapshot] : displayedProjects);
          }
          renderNotifications();
        } catch (error) {
          console.error("render failed", error);
          const message = error instanceof Error ? error.message : String(error);
          setHtmlIfChanged(centerContent, '<div class="empty">Render failed: ' + escapeHtml(message) + "</div>");
          setHtmlIfChanged(sessionList, '<div class="empty">Render failed: ' + escapeHtml(message) + "</div>");
          setConnection("offline");
          lastSceneRenderToken = null;
          renderedAgentSceneState = new Map();
          sceneStateDraft = null;
          syncWorkstationEffects();
        }
      }

      async function refreshFleet() {
        const response = await fetch("/api/fleet");
        ingestFleet(await response.json());
      }

      function connectEvents() {
        if (events) {
          events.close();
        }

        setConnection("connecting");
        events = new EventSource("/api/events");
        events.addEventListener("open", () => {
          setConnection("live");
        });
        events.addEventListener("fleet", (event) => {
          ingestFleet(JSON.parse(event.data));
          setConnection("live");
        });
        events.addEventListener("error", () => {
          setConnection(navigator.onLine === false ? "offline" : "reconnecting");
        });
      }

      document.body.addEventListener("click", async (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest("[data-action], [data-view], #workspace-focus-button") : null;
        if (!(target instanceof HTMLElement)) return;

        if (target.dataset.view) {
          setView(target.dataset.view);
          return;
        }

        const action = target.dataset.action;
        if (action === "toggle-settings") {
          setSettingsOpen(!state.settingsOpen);
          return;
        }

        if (action === "close-settings") {
          setSettingsOpen(false);
          return;
        }

        if (action === "select-project" && target.dataset.projectRoot) {
          setSettingsOpen(false);
          setSelection(target.dataset.projectRoot);
          return;
        }

        if (action === "toggle-workspace-focus") {
          toggleWorkspaceFullscreen();
          return;
        }

        if (target === workspaceFocusButton) {
          toggleWorkspaceFullscreen();
          return;
        }

        if (action === "cycle-look" && target.dataset.projectRoot && target.dataset.agentId) {
          await postJson("/api/appearance/cycle", {
            projectRoot: target.dataset.projectRoot,
            agentId: target.dataset.agentId
          });
        }
      });

      document.body.addEventListener("pointerover", (event) => {
        const focusTarget = event.target instanceof HTMLElement
          ? event.target.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")
          : null;
        const relatedTarget = event.relatedTarget;
        if (!(focusTarget instanceof HTMLElement)) {
          return;
        }
        if (relatedTarget instanceof Node && focusTarget.contains(relatedTarget)) {
          return;
        }
        setSessionFocusFromElement(focusTarget);
      });

      document.body.addEventListener("pointerout", (event) => {
        const focusTarget = event.target instanceof HTMLElement
          ? event.target.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")
          : null;
        const relatedTarget = event.relatedTarget;
        if (!(focusTarget instanceof HTMLElement)) {
          return;
        }
        if (relatedTarget instanceof Node && focusTarget.contains(relatedTarget)) {
          return;
        }
        if (relatedTarget instanceof HTMLElement && relatedTarget.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")) {
          return;
        }
        setSessionFocusFromElement(null);
      });

      document.body.addEventListener("focusin", (event) => {
        const focusTarget = event.target instanceof HTMLElement
          ? event.target.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")
          : null;
        if (focusTarget instanceof HTMLElement) {
          setSessionFocusFromElement(focusTarget);
        }
      });

      document.addEventListener("pointerdown", (event) => {
        if (!state.settingsOpen) {
          return;
        }
        const withinSettings = event.target instanceof HTMLElement
          ? event.target.closest(".settings-shell")
          : null;
        if (!withinSettings) {
          setSettingsOpen(false);
        }
      });

      document.body.addEventListener("focusout", (event) => {
        const focusTarget = event.target instanceof HTMLElement
          ? event.target.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")
          : null;
        const relatedTarget = event.relatedTarget;
        if (!(focusTarget instanceof HTMLElement)) {
          return;
        }
        if (relatedTarget instanceof Node && focusTarget.contains(relatedTarget)) {
          return;
        }
        if (relatedTarget instanceof HTMLElement && relatedTarget.closest(".session-card[data-focus-keys], [data-focus-agent][data-focus-keys]")) {
          return;
        }
        setSessionFocusFromElement(null);
      });

      document.body.addEventListener("pointerdown", (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest(".office-map-furniture-hit") : null;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const host = target.closest("[data-office-map-host]");
        const renderer = rendererForHost(host);
        if (!renderer || !renderer.model) {
          return;
        }
        const item = renderer.model.furniture.find((entry) => entry.id === target.dataset.furnitureId && entry.roomId === target.dataset.roomId);
        if (!item) {
          return;
        }
        const rect = target.getBoundingClientRect();
        const pointerOffsetTiles = ((event.clientX - rect.left) / (renderer.scale * renderer.model.tile));
        furnitureDragState = {
          renderer,
          projectRoot: renderer.model.projectRoot,
          item,
          currentColumn: item.column,
          pointerOffsetTiles,
          hostRect: renderer.host.getBoundingClientRect()
        };
        window.addEventListener("pointermove", handleFurnitureDragMove);
        window.addEventListener("pointerup", stopFurnitureDrag);
        window.addEventListener("pointercancel", stopFurnitureDrag);
        event.preventDefault();
      });

      if (textScaleInput instanceof HTMLInputElement) {
        textScaleInput.addEventListener("input", () => {
          syncTextScalePreview(textScaleInput.value);
        });
        textScaleInput.addEventListener("change", () => {
          commitTextScale(textScaleInput.value);
        });
      }
      if (debugTilesButton instanceof HTMLButtonElement) {
        debugTilesButton.addEventListener("click", () => {
          state.globalSceneSettings = {
            ...state.globalSceneSettings,
            debugTiles: !state.globalSceneSettings.debugTiles
          };
          applyGlobalSceneSettings();
          saveGlobalSceneSettings();
          render();
        });
      }
      if (splitWorktreesButton instanceof HTMLButtonElement) {
        splitWorktreesButton.addEventListener("click", () => {
          state.globalSceneSettings = {
            ...state.globalSceneSettings,
            splitWorktrees: !state.globalSceneSettings.splitWorktrees
          };
          applyGlobalSceneSettings();
          saveGlobalSceneSettings();
          lastSceneRenderToken = null;
          render();
        });
      }
      if (cursorApiKeyInput instanceof HTMLInputElement) {
        cursorApiKeyInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void saveCursorApiKey();
          }
        });
      }
      if (cursorApiKeySaveButton instanceof HTMLButtonElement) {
        cursorApiKeySaveButton.addEventListener("click", () => {
          void saveCursorApiKey();
        });
      }
      if (cursorApiKeyClearButton instanceof HTMLButtonElement) {
        cursorApiKeyClearButton.addEventListener("click", () => {
          void clearCursorApiKey();
        });
      }
      const commitMultiplayerInputs = () => {
        commitMultiplayerSettings({
          host: multiplayerHostInput instanceof HTMLInputElement ? multiplayerHostInput.value : "",
          room: multiplayerRoomInput instanceof HTMLInputElement ? multiplayerRoomInput.value : "",
          nickname: multiplayerNicknameInput instanceof HTMLInputElement ? multiplayerNicknameInput.value : ""
        });
      };
      if (multiplayerHostInput instanceof HTMLInputElement) {
        multiplayerHostInput.addEventListener("change", commitMultiplayerInputs);
        multiplayerHostInput.addEventListener("blur", commitMultiplayerInputs);
        multiplayerHostInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitMultiplayerInputs();
          }
        });
      }
      if (multiplayerRoomInput instanceof HTMLInputElement) {
        multiplayerRoomInput.addEventListener("change", commitMultiplayerInputs);
        multiplayerRoomInput.addEventListener("blur", commitMultiplayerInputs);
        multiplayerRoomInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitMultiplayerInputs();
          }
        });
      }
      if (multiplayerNicknameInput instanceof HTMLInputElement) {
        multiplayerNicknameInput.addEventListener("change", commitMultiplayerInputs);
        multiplayerNicknameInput.addEventListener("blur", commitMultiplayerInputs);
        multiplayerNicknameInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitMultiplayerInputs();
          }
        });
      }
      if (multiplayerEnabledButton instanceof HTMLButtonElement) {
        multiplayerEnabledButton.addEventListener("click", () => {
          commitMultiplayerSettings({
            ...state.multiplayerSettings,
            enabled: !state.multiplayerSettings.enabled
          });
        });
      }
      void refreshMultiplayerConnection();

      if (!screenshotMode) {
        window.addEventListener("online", () => setConnection("reconnecting"));
        window.addEventListener("offline", () => setConnection("offline"));
        window.addEventListener("scroll", syncSkyParallax, { passive: true });
      }
      document.addEventListener("keydown", (event) => {
        if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        if (isTypingTarget(event.target)) {
          return;
        }
        if (event.key === "Escape" && state.settingsOpen) {
          event.preventDefault();
          setSettingsOpen(false);
          return;
        }
        if (event.key === "Escape" && state.workspaceFullscreen) {
          event.preventDefault();
          setWorkspaceFullscreen(false);
          return;
        }
        if ((event.key === "f" || event.key === "F") && canFocusWorkspace()) {
          event.preventDefault();
          toggleWorkspaceFullscreen();
        }
      });
      window.addEventListener("resize", () => {
        syncSkyParallax();
        fitScenes();
        renderNotifications();
      });

      refreshFleet()
        .then(() => {
          if (screenshotMode) {
            setConnection("snapshot");
            return;
          }
          connectEvents();
        })
        .catch((error) => {
          console.error("initial refresh failed", error);
          setConnection("offline");
        });

`;
