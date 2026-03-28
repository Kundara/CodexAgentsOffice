export const CLIENT_RUNTIME_LAYOUT_SOURCE = `
      const mapViewButton = document.getElementById("map-view-button");
      const terminalViewButton = document.getElementById("terminal-view-button");
      const splitWorktreesButton = document.getElementById("split-worktrees-button");
      const settingsButton = document.getElementById("settings-button");
      const settingsPopup = document.getElementById("settings-popup");
      const debugTilesButton = document.getElementById("debug-tiles-button");
      const textScaleInput = document.getElementById("text-scale-input");
      const textScaleOutput = document.getElementById("text-scale-output");
      const cursorApiKeyInput = document.getElementById("cursor-api-key-input");
      const cursorApiKeySaveButton = document.getElementById("cursor-api-key-save-button");
      const cursorApiKeyClearButton = document.getElementById("cursor-api-key-clear-button");
      const cursorApiKeyStatus = document.getElementById("cursor-api-key-status");
      const multiplayerEnabledButton = document.getElementById("multiplayer-enabled-button");
      const multiplayerHostInput = document.getElementById("multiplayer-host-input");
      const multiplayerRoomInput = document.getElementById("multiplayer-room-input");
      const multiplayerNicknameInput = document.getElementById("multiplayer-nickname-input");
      const multiplayerStatus = document.getElementById("multiplayer-status");
      const connectionPill = document.getElementById("connection-pill");
      const stamp = document.getElementById("stamp");
      const heroSummary = document.getElementById("hero-summary");
      const projectCount = document.getElementById("project-count");
      const projectTabs = document.getElementById("project-tabs");
      const centerTitle = document.getElementById("center-title");
      const workspaceFocusButton = document.getElementById("workspace-focus-button");
      const workspacePanel = document.getElementById("workspace-panel");
      const centerContent = document.getElementById("center-content");
      const sessionList = document.getElementById("session-list");
      const roomsPath = document.getElementById("rooms-path");
      applyGlobalSceneSettings();
      syncSettingsPopup();
      syncCursorIntegrationUi();
      syncMultiplayerSettingsUi();
      void refreshIntegrationSettings();
      multiplayerPruneTimer = setInterval(pruneMultiplayerPeers, 5000);

      function syncSettingsPopup() {
        if (settingsButton instanceof HTMLButtonElement) {
          settingsButton.classList.toggle("active", state.settingsOpen);
          settingsButton.setAttribute("aria-expanded", state.settingsOpen ? "true" : "false");
        }
        if (settingsPopup instanceof HTMLElement) {
          settingsPopup.hidden = !state.settingsOpen;
        }
      }

      function setSettingsOpen(nextOpen) {
        state.settingsOpen = Boolean(nextOpen);
        syncSettingsPopup();
      }

      function cursorIntegrationStatusText() {
        if (typeof state.integrationSettingsError === "string" && state.integrationSettingsError.length > 0) {
          return state.integrationSettingsError;
        }

        const cursor = state.integrationSettings && state.integrationSettings.cursor
          ? state.integrationSettings.cursor
          : defaultIntegrationSettings().cursor;

        if (state.integrationSettingsPending) {
          return "Saving Cursor API key on this machine...";
        }

        if (cursor.source === "env") {
          const storedSuffix = cursor.storedConfigured && cursor.storedMaskedKey
            ? " A saved key is also present and can be cleared here."
            : "";
          return "Cursor API key is coming from CURSOR_API_KEY in the server process" + (cursor.maskedKey ? " (" + cursor.maskedKey + ")." : ".") + storedSuffix;
        }

        if (cursor.source === "stored") {
          return "Saved on this machine for Agents Office" + (cursor.maskedKey ? " (" + cursor.maskedKey + ")." : ".");
        }

        return "No local Cursor API key is saved. Local Cursor sessions may still appear automatically; save a key only to include official Cursor background agents for matching repos.";
      }

      function syncCursorIntegrationUi() {
        const cursor = state.integrationSettings && state.integrationSettings.cursor
          ? state.integrationSettings.cursor
          : defaultIntegrationSettings().cursor;
        const busy = state.integrationSettingsPending === true;

        if (cursorApiKeyInput instanceof HTMLInputElement) {
          cursorApiKeyInput.disabled = busy;
          if (cursorApiKeyInput.value.length === 0) {
            cursorApiKeyInput.placeholder = cursor.source === "stored"
              ? "Saved on this machine"
              : cursor.source === "env"
                ? "Provided by CURSOR_API_KEY"
                : "cursor_...";
          }
        }

        if (cursorApiKeySaveButton instanceof HTMLButtonElement) {
          cursorApiKeySaveButton.disabled = busy;
          cursorApiKeySaveButton.textContent = busy ? "Saving..." : "Save Key";
        }

        if (cursorApiKeyClearButton instanceof HTMLButtonElement) {
          cursorApiKeyClearButton.disabled = busy || cursor.storedConfigured !== true;
        }

        setTextIfChanged(cursorApiKeyStatus, cursorIntegrationStatusText());
      }

      async function refreshIntegrationSettings() {
        try {
          const response = await fetch("/api/settings/integrations");
          if (!response.ok) {
            throw new Error(await response.text());
          }
          state.integrationSettings = await response.json();
          state.integrationSettingsError = null;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          state.integrationSettings = defaultIntegrationSettings();
          state.integrationSettingsError = "Cursor settings unavailable: " + message;
        } finally {
          state.integrationSettingsPending = false;
          syncCursorIntegrationUi();
        }
      }

      async function saveCursorApiKey() {
        if (!(cursorApiKeyInput instanceof HTMLInputElement)) {
          return;
        }

        const cursorApiKey = cursorApiKeyInput.value.trim();
        if (!cursorApiKey) {
          state.integrationSettingsError = "Enter a Cursor API key before saving.";
          syncCursorIntegrationUi();
          return;
        }

        state.integrationSettingsPending = true;
        state.integrationSettingsError = null;
        syncCursorIntegrationUi();

        try {
          state.integrationSettings = await postJson("/api/settings/integrations", { cursorApiKey });
          state.integrationSettingsError = null;
          cursorApiKeyInput.value = "";
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          state.integrationSettingsError = "Failed to save Cursor API key: " + message;
        } finally {
          state.integrationSettingsPending = false;
          syncCursorIntegrationUi();
        }
      }

      async function clearCursorApiKey() {
        state.integrationSettingsPending = true;
        state.integrationSettingsError = null;
        syncCursorIntegrationUi();

        try {
          state.integrationSettings = await postJson("/api/settings/integrations", { cursorApiKey: null });
          state.integrationSettingsError = null;
          if (cursorApiKeyInput instanceof HTMLInputElement) {
            cursorApiKeyInput.value = "";
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          state.integrationSettingsError = "Failed to clear saved Cursor API key: " + message;
        } finally {
          state.integrationSettingsPending = false;
          syncCursorIntegrationUi();
        }
      }

      function syncFleetBackdrop() {
        const towerMode = state.view === "map";
        document.body.classList.toggle("fleet-sky-active", towerMode);
        if (workspacePanel instanceof HTMLElement) {
          workspacePanel.dataset.panelMode = towerMode ? "tower" : "default";
        }
        if (centerContent instanceof HTMLElement) {
          centerContent.dataset.contentMode = towerMode ? "tower" : "default";
        }
      }

      function syncSkyParallax() {
        const scrollY = Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0, document.body.scrollTop || 0);
        document.documentElement.style.setProperty("--tower-scroll-y", Math.round(scrollY) + "px");
      }

      function syncUrl() {
        const url = new URL(window.location.href);
        if (state.selected === "all") url.searchParams.delete("project");
        else url.searchParams.set("project", state.selected);
        if (state.view === "map") url.searchParams.delete("view");
        else url.searchParams.set("view", state.view);
        if (state.workspaceFullscreen && state.selected !== "all") url.searchParams.set("focus", "1");
        else url.searchParams.delete("focus");
        url.searchParams.delete("active");
        url.searchParams.delete("history");
        window.history.replaceState({}, "", url);
      }

      function setSelection(nextSelection) {
        state.selected = nextSelection;
        if (nextSelection === "all") {
          state.workspaceFullscreen = false;
        }
        syncUrl();
        render();
      }

      function setView(nextView) {
        state.view = nextView === "terminal" ? "terminal" : "map";
        syncUrl();
        render();
      }

      function canFocusWorkspace() {
        return Boolean(state.fleet && state.selected !== "all" && currentSnapshot());
      }

      function syncWorkspaceFullscreenUi() {
        const isVisible = canFocusWorkspace();
        const isActive = isVisible && state.workspaceFullscreen;
        document.body.classList.toggle("workspace-focus", isActive);
        if (!(workspaceFocusButton instanceof HTMLButtonElement)) {
          return;
        }
        workspaceFocusButton.hidden = !isVisible;
        workspaceFocusButton.classList.toggle("active", isActive);
        workspaceFocusButton.setAttribute("aria-pressed", isActive ? "true" : "false");
        workspaceFocusButton.textContent = isActive ? "Close" : "[] Expand";
        workspaceFocusButton.title = isActive
          ? "Close workspace focus (F)"
          : "Expand selected workspace (F)";
      }

      function setWorkspaceFullscreen(nextValue) {
        const normalized = Boolean(nextValue) && canFocusWorkspace();
        if (state.workspaceFullscreen === normalized) {
          syncWorkspaceFullscreenUi();
          return;
        }
        if (normalized) {
          setSettingsOpen(false);
        }
        state.workspaceFullscreen = normalized;
        lastSceneRenderToken = null;
        syncUrl();
        render();
      }

      function toggleWorkspaceFullscreen() {
        if (!canFocusWorkspace()) {
          return;
        }
        setWorkspaceFullscreen(!state.workspaceFullscreen);
      }

      function isTypingTarget(target) {
        if (!(target instanceof HTMLElement)) {
          return false;
        }
        if (target.isContentEditable) {
          return true;
        }
        return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']"));
      }

      function setConnection(nextConnection) {
        state.connection = nextConnection;
        if (!connectionPill) return;
        connectionPill.className = \`status-pill state-\${nextConnection}\`;
        connectionPill.textContent =
          nextConnection === "live" ? "Live stream"
          : nextConnection === "snapshot" ? "Snapshot mode"
          : nextConnection === "offline" ? "Offline"
          : nextConnection === "reconnecting" ? "Reconnecting"
          : "Connecting";
      }

      function countsForSnapshot(snapshot) {
        const counters = { total: 0, active: 0, waiting: 0, blocked: 0, cloud: 0 };
        for (const agent of snapshot.agents) {
          if (!isBusyAgent(agent)) {
            continue;
          }
          counters.total += 1;
          if (agent.state === "waiting") counters.waiting += 1;
          else if (agent.state === "blocked") counters.blocked += 1;
          else if (agent.state === "cloud") counters.cloud += 1;
          else if (agent.state !== "done" && agent.state !== "idle") counters.active += 1;
        }
        return counters;
      }

      function worktreeIconUrl() {
        return pixelOffice && pixelOffice.icons && pixelOffice.icons.worktree && pixelOffice.icons.worktree.url
          ? pixelOffice.icons.worktree.url
          : "/assets/pixel-office/sprites/icons/worktree.svg";
      }

      function worktreeNameForSnapshot(snapshot) {
        return String(snapshot && snapshot.projectIdentity && snapshot.projectIdentity.worktreeName || "").trim();
      }

      function isWorktreeSnapshot(snapshot) {
        return worktreeNameForSnapshot(snapshot).length > 0;
      }

      function snapshotGroupKey(snapshot) {
        const identity = snapshot && snapshot.projectIdentity ? snapshot.projectIdentity : null;
        const commonGitDir = normalizeSharedPathCandidate(identity && identity.commonGitDir || "");
        if (commonGitDir) {
          return "git-common:" + commonGitDir;
        }
        const identityKey = String(identity && identity.key || "").trim();
        if (identityKey) {
          return "git-key:" + identityKey;
        }
        const gitRoot = normalizeSharedPathCandidate(identity && identity.gitRoot || "");
        if (gitRoot) {
          return "git-root:" + gitRoot;
        }
        return "project:" + normalizeSharedPathCandidate(snapshot && snapshot.projectRoot || "");
      }

      function preferredRepresentativeSnapshot(current, candidate) {
        if (!current) {
          return candidate;
        }
        if (!isWorktreeSnapshot(candidate) && isWorktreeSnapshot(current)) {
          return candidate;
        }
        return current;
      }

      function mergedAgentId(projectRoot, agentId) {
        return String(projectRoot || "") + "::" + String(agentId || "");
      }

      function cloneAgentForMergedSnapshot(sourceSnapshot, targetSnapshot, agent, useSyntheticIds) {
        const sourceProjectRoot = sourceSnapshot && sourceSnapshot.projectRoot ? sourceSnapshot.projectRoot : targetSnapshot.projectRoot;
        const remappedPaths = remapSharedPaths(
          sourceProjectRoot,
          targetSnapshot.projectRoot,
          Array.isArray(agent && agent.paths) ? agent.paths : []
        );
        const remappedCwd = remapSharedPath(sourceProjectRoot, targetSnapshot.projectRoot, agent && agent.cwd);
        const fallbackPaths = remappedPaths.length > 0
          ? remappedPaths
          : remapSharedPaths(sourceProjectRoot, targetSnapshot.projectRoot, [
            remappedCwd || agent && agent.cwd || sourceProjectRoot,
            sourceProjectRoot
          ]);
        const roomId = sourceProjectRoot === targetSnapshot.projectRoot
          ? agent.roomId
          : roomIdForSharedPaths(targetSnapshot, fallbackPaths);
        return {
          ...agent,
          id: useSyntheticIds ? mergedAgentId(sourceProjectRoot, agent.id) : agent.id,
          parentThreadId: agent.parentThreadId
            ? (useSyntheticIds ? mergedAgentId(sourceProjectRoot, agent.parentThreadId) : agent.parentThreadId)
            : null,
          roomId: roomId || (sourceProjectRoot === targetSnapshot.projectRoot ? agent.roomId : null),
          cwd: remappedCwd || agent.cwd,
          paths: fallbackPaths.length > 0 ? fallbackPaths : agent.paths,
          sourceProjectRoot,
          sourceAgentId: agent.id,
          worktreeName: worktreeNameForSnapshot(sourceSnapshot)
        };
      }

      function mergeWorktreeProjects(projects) {
        if (state.globalSceneSettings && state.globalSceneSettings.splitWorktrees) {
          return projects;
        }

        const bucketByKey = new Map();
        const buckets = [];
        projects.forEach((snapshot, index) => {
          const key = snapshotGroupKey(snapshot);
          let bucket = bucketByKey.get(key);
          if (!bucket) {
            bucket = {
              firstIndex: index,
              representative: snapshot,
              snapshots: []
            };
            bucketByKey.set(key, bucket);
            buckets.push(bucket);
          }
          bucket.snapshots.push(snapshot);
          bucket.representative = preferredRepresentativeSnapshot(bucket.representative, snapshot);
        });

        return buckets
          .sort((left, right) => left.firstIndex - right.firstIndex)
          .map((bucket) => {
            const representative = bucket.representative;
            const useSyntheticIds = bucket.snapshots.length > 1;
            return {
              ...representative,
              agents: bucket.snapshots.flatMap((snapshot) =>
                snapshot.agents.map((agent) => cloneAgentForMergedSnapshot(snapshot, representative, agent, useSyntheticIds))
              ),
              cloudTasks: bucket.snapshots.flatMap((snapshot) => Array.isArray(snapshot.cloudTasks) ? snapshot.cloudTasks : []),
              events: bucket.snapshots.flatMap((snapshot) => Array.isArray(snapshot.events) ? snapshot.events : []),
              notes: Array.from(new Set(bucket.snapshots.flatMap((snapshot) => Array.isArray(snapshot.notes) ? snapshot.notes : []).filter(Boolean))),
              worktreeGroupSize: bucket.snapshots.length
            };
          });
      }

      function isBusyAgent(agent) {
        return agent.isCurrent === true;
      }

      function parseAgentUpdatedAt(value) {
        const parsed = Date.parse(value || "");
        return Number.isFinite(parsed) ? parsed : Number.NaN;
      }

      function isDeskLiveLocalState(state) {
        return [
          "editing",
          "running",
          "validating",
          "scanning",
          "thinking",
          "planning",
          "delegating",
          "blocked"
        ].includes(String(state || "").toLowerCase());
      }

      function isFinishedLeadForRec(agent) {
        return isRecentLeadCandidate(agent)
          && !shouldSeatAtWorkstation(agent)
          && (agent.state === "waiting" || agent.state === "idle" || agent.state === "done");
      }

      function isRecentLeadCandidate(agent) {
        return agent.source !== "cloud"
          && agent.source !== "presence"
          && !agent.parentThreadId
          && Boolean(agent.threadId || agent.taskId || agent.url || agent.source === "claude");
      }

      function reservedRecentLeadSlots(snapshot) {
        const reservations = activeRecentLeadReservations.get(snapshot.projectRoot);
        return reservations ? reservations.size : 0;
      }

      function updateRecentLeadReservations(projects) {
        for (const snapshot of projects) {
          const previousVisibleIds = recentLeadDisplayMemory.get(snapshot.projectRoot) || [];
          const activeIds = new Set(
            snapshot.agents
              .filter((agent) => shouldSeatAtWorkstation(agent) && isRecentLeadCandidate(agent))
              .map((agent) => agent.id)
          );
          const nextReservations = new Set(
            [...(activeRecentLeadReservations.get(snapshot.projectRoot) || new Set())]
              .filter((agentId) => activeIds.has(agentId))
          );

          for (const agentId of previousVisibleIds) {
            if (activeIds.has(agentId)) {
              nextReservations.add(agentId);
            }
          }

          if (nextReservations.size > 0) {
            activeRecentLeadReservations.set(snapshot.projectRoot, nextReservations);
          } else {
            activeRecentLeadReservations.delete(snapshot.projectRoot);
          }
        }
      }

      function rememberVisibleRecentLeads(projects) {
        for (const snapshot of projects) {
          const visibleIds = snapshot.agents
            .filter((agent) => isFinishedLeadForRec(agent))
            .map((agent) => agent.id);
          recentLeadDisplayMemory.set(snapshot.projectRoot, visibleIds);
        }
      }

      function isRecentSessionCandidate(agent) {
        return agent.source !== "cloud" && agent.source !== "presence";
      }

      function recentLeadAgents(snapshot, limit = SCENE_RECENT_LEAD_LIMIT) {
        const activeIds = new Set(snapshot.agents.filter(shouldSeatAtWorkstation).map((agent) => agent.id));
        const effectiveLimit = Math.max(0, limit - reservedRecentLeadSlots(snapshot));
        return [...snapshot.agents]
          .filter((agent) => isFinishedLeadForRec(agent) && !activeIds.has(agent.id))
          .sort(compareAgentsByRecencyStable)
          .slice(0, effectiveLimit);
      }

      function recentSessionAgents(snapshot, limit = SESSION_RECENT_LEAD_LIMIT) {
        const activeIds = new Set(snapshot.agents.filter(isBusyAgent).map((agent) => agent.id));
        return [...snapshot.agents]
          .filter((agent) => isRecentSessionCandidate(agent) && !activeIds.has(agent.id))
          .sort(compareAgentsByRecencyStable)
          .slice(0, limit);
      }

      function busyCount(snapshot) {
        return snapshot.agents.filter(isBusyAgent).length;
      }

      function notificationSubjectKey(projectRoot, agent, threadId) {
        const explicitThreadId = typeof threadId === "string" && threadId.length > 0 ? threadId : null;
        const agentThreadId = agent && typeof agent.threadId === "string" && agent.threadId.length > 0
          ? agent.threadId
          : null;
        const subjectThreadId = explicitThreadId || agentThreadId;
        if (subjectThreadId) {
          return \`\${projectRoot}::thread::\${subjectThreadId}\`;
        }
        return \`\${projectRoot}::agent::\${agent && agent.id ? agent.id : "unknown"}\`;
      }

      function sceneAgentToken(agent) {
        return [
          agent.id,
          agent.state,
          agent.roomId || "",
          agent.parentThreadId || "",
          agent.isCurrent ? "1" : "0",
          agent.appearance?.id || "",
          agent.source,
          agent.sourceKind || ""
        ].join(":");
      }

      function sceneSnapshotToken(snapshot) {
        return [
          snapshot.projectRoot,
          ...snapshot.agents.map(sceneAgentToken)
        ].join("::");
      }

      function eventSnapshotToken(event) {
        if (!event) {
          return "";
        }
        return [
          event.id || "",
          event.threadId || "",
          event.kind || "",
          event.phase || "",
          event.method || "",
          event.createdAt || "",
          event.itemId || "",
          event.requestId || "",
          event.title || "",
          event.detail || "",
          event.command || "",
          event.path || ""
        ].join(":");
      }

      function roomsSnapshotToken(rooms) {
        if (!rooms) {
          return "";
        }
        return JSON.stringify({
          generated: rooms.generated,
          filePath: rooms.filePath,
          rooms: rooms.rooms
        });
      }

      function projectSemanticToken(snapshot) {
        return [
          snapshot.projectRoot,
          roomsSnapshotToken(snapshot.rooms),
          ...snapshot.agents.map(sceneAgentToken),
          ...((snapshot.events || []).map(eventSnapshotToken)),
          ...((snapshot.notes || []).map((note) => String(note || "")))
        ].join("::");
      }

      function fleetSemanticToken(fleet) {
        if (!fleet || !Array.isArray(fleet.projects)) {
          return "";
        }
        return fleet.projects.map(projectSemanticToken).join("||");
      }

      function isLiveSceneAgent(agent) {
        if (!agent || agent.source === "cloud" || agent.source === "presence") {
          return false;
        }
        return shouldSeatAtWorkstation(agent) || agent.isCurrent === true;
      }

      function viewSnapshot(snapshot, recentLeadLimit = SCENE_RECENT_LEAD_LIMIT, allProjects = null) {
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
      }

      function emptyProjectNeedsRecentFallback(snapshot) {
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
      }

      function visibleProjects(fleet) {
        return fleet.projects;
      }

      function fleetCounts(fleet) {
        return fleet.projects.reduce((acc, snapshot) => {
          const next = countsForSnapshot(snapshot);
          acc.total += next.total;
          acc.active += next.active;
          acc.waiting += next.waiting;
          acc.blocked += next.blocked;
          acc.cloud += next.cloud;
          return acc;
        }, { total: 0, active: 0, waiting: 0, blocked: 0, cloud: 0 });
      }

      function stableHash(input) {
        let hash = 2166136261;
        for (const char of String(input)) {
          hash ^= char.charCodeAt(0);
          hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0);
      }

      function agentRole(agent) {
        if (agent.role) {
          return String(agent.role).toLowerCase();
        }
        if (agent.source === "cloud") {
          return "cloud";
        }
        if (agent.source === "claude") {
          return "claude";
        }
        if (agent.source === "cursor") {
          return "cursor";
        }
        if (agent.source === "openclaw") {
          return "openclaw";
        }
        return "default";
      }

      function titleCaseWords(value) {
        return String(value)
          .split(/\\s+/)
          .filter(Boolean)
          .map((word) => word[0] ? word[0].toUpperCase() + word.slice(1) : word)
          .join(" ");
      }

      function pluralizeWord(word, count) {
        if (count === 1) {
          return word;
        }
        if (/[^aeiou]y$/i.test(word)) {
          return word.slice(0, -1) + "ies";
        }
        if (/(s|x|z|ch|sh)$/i.test(word)) {
          return word + "es";
        }
        return word + "s";
      }

      function pluralizePhrase(phrase, count) {
        if (count === 1) {
          return phrase;
        }
        const words = String(phrase).split(/\\s+/).filter(Boolean);
        if (words.length === 0) {
          return phrase;
        }
        words[words.length - 1] = pluralizeWord(words[words.length - 1], count);
        return words.join(" ");
      }

      function agentRoleLabel(agent) {
        return titleCaseWords(agentRole(agent).replace(/[_-]+/g, " "));
      }

      function childAgentsFor(snapshot, parentThreadId) {
        return snapshot.agents.filter((agent) => agent.parentThreadId === parentThreadId);
      }

      function liveChildAgentsFor(snapshot, parentThreadId) {
        return childAgentsFor(snapshot, parentThreadId).filter((agent) => isBusyAgent(agent));
      }

      function isLeadSession(snapshot, agent) {
        return agent.source !== "cloud"
          && !agent.parentThreadId
          && (Boolean(agent.threadId || agent.taskId || agent.url || agent.source === "claude") || childAgentsFor(snapshot, agent.id).length > 0);
      }

      function agentRankLabel(snapshot, agent) {
        if (isLeadSession(snapshot, agent)) {
          return "mini-boss";
        }
        if (agent.parentThreadId) {
          return "subagent";
        }
        return agent.sourceKind || agentRole(agent);
      }

      function parentLabelFor(snapshot, agent) {
        if (!agent.parentThreadId) {
          return null;
        }
        return snapshot.agents.find((candidate) => candidate.id === agent.parentThreadId)?.label ?? null;
      }

      function focusAgentKey(snapshot, agent) {
        return agentKey(snapshot.projectRoot, agent);
      }

      function collectFocusedSessionKeys(snapshot, agent) {
        const queue = [agent.id];
        const visited = new Set(queue);
        const keys = new Set([focusAgentKey(snapshot, agent)]);
        while (queue.length > 0) {
          const currentId = queue.shift();
          for (const candidate of snapshot.agents) {
            if (candidate.parentThreadId !== currentId || visited.has(candidate.id)) {
              continue;
            }
            visited.add(candidate.id);
            queue.push(candidate.id);
            keys.add(focusAgentKey(snapshot, candidate));
          }
        }
        return [...keys];
      }

      function focusWrapperAttrs(snapshot, agent) {
        if (!agent) {
          return "";
        }
        return \` data-focus-agent="true" data-focus-key="\${escapeHtml(focusAgentKey(snapshot, agent))}" data-focus-keys="\${escapeHtml(JSON.stringify(collectFocusedSessionKeys(snapshot, agent)))}"\`;
      }

      function stationRoleLabel(role, count) {
        const normalized = String(role || "default").trim().toLowerCase().replace(/[_-]+/g, " ");
        const base =
          normalized === "default" ? "generalist"
          : normalized === "cloud" ? "cloud operator"
          : normalized;
        return titleCaseWords(pluralizePhrase(base, count));
      }

      function groupAgentsByRole(agents) {
        const buckets = new Map();
        for (const agent of agents) {
          const role = agentRole(agent);
          const list = buckets.get(role) || [];
          list.push(agent);
          buckets.set(role, list);
        }

        return [...buckets.entries()]
          .map(([role, roleAgents]) => ({
            role,
            agents: [...roleAgents].sort(compareAgentsByRecencyStable)
          }))
          .sort((left, right) => {
            if (right.agents.length !== left.agents.length) {
              return right.agents.length - left.agents.length;
            }
            return stationRoleLabel(left.role, left.agents.length)
              .localeCompare(stationRoleLabel(right.role, right.agents.length));
          });
      }

      function compareAgentsForDeskLayout(snapshot, left, right) {
        const leadDelta = Number(isLeadSession(snapshot, right)) - Number(isLeadSession(snapshot, left));
        if (leadDelta !== 0) {
          return leadDelta;
        }

        const depthDelta = left.depth - right.depth;
        if (depthDelta !== 0) {
          return depthDelta;
        }

        const parentDelta = String(left.parentThreadId || "").localeCompare(String(right.parentThreadId || ""));
        if (parentDelta !== 0) {
          return parentDelta;
        }

        const roleDelta = agentRole(left).localeCompare(agentRole(right));
        if (roleDelta !== 0) {
          return roleDelta;
        }

        const labelDelta = String(left.label || "").localeCompare(String(right.label || ""));
        if (labelDelta !== 0) {
          return labelDelta;
        }

        return String(left.id || "").localeCompare(String(right.id || ""));
      }

      function compareAgentsByRecencyStable(left, right) {
        const updatedAtDelta = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
        if (updatedAtDelta !== 0) {
          return updatedAtDelta;
        }
        return String(left.id || "").localeCompare(String(right.id || ""));
      }

      function roleTone(role) {
        const normalized = String(role || "default").toLowerCase();
        switch (normalized) {
          case "boss":
            return "#ffcf4d";
          case "worker":
            return "#4bd69f";
          case "explorer":
            return "#f5b74f";
          case "cloud":
            return "#98d8ff";
          case "claude":
            return "#ffab91";
          case "cursor":
            return "#9fd6a4";
          case "openclaw":
            return "#7ad0b3";
          case "default":
            return "#f2ead7";
          default:
            if (normalized.includes("design") || normalized.includes("copy") || normalized.includes("writer")) {
              return "#ff9a7a";
            }
            if (normalized.includes("map") || normalized.includes("research") || normalized.includes("docs")) {
              return "#8cd5ff";
            }
            if (normalized.includes("review") || normalized.includes("qa")) {
              return "#ffd479";
            }
            return "#d7b7ff";
        }
      }

      function isBossOfficeCandidate(snapshot, agent) {
        return isLeadSession(snapshot, agent) && liveChildAgentsFor(snapshot, agent.id).length > 1;
      }

      function sortedBossOfficeAgents(snapshot, agents) {
        return [...agents].sort((left, right) => {
          const childDelta = liveChildAgentsFor(snapshot, right.id).length - liveChildAgentsFor(snapshot, left.id).length;
          if (childDelta !== 0) {
            return childDelta;
          }
          return compareAgentsForDeskLayout(snapshot, left, right);
        });
      }

      function previousSceneSlotId(snapshot, agent) {
        const sceneState = sceneStateForAgent(snapshot, agent.id);
        return sceneState && sceneState.slotId ? String(sceneState.slotId) : null;
      }

      function previousSceneMirrored(snapshot, agent) {
        const sceneState = sceneStateForAgent(snapshot, agent.id);
        return sceneState && typeof sceneState.mirrored === "boolean" ? sceneState.mirrored : null;
      }

      function assignAgentsToOfficeSlots(snapshot, agents, slots) {
        const sortedAgents = sortedBossOfficeAgents(snapshot, agents);
        const slotById = new Map(slots.map((slot) => [slot.id, slot]));
        const assignments = [];
        const usedSlots = new Set();
        const remaining = [];

        for (const agent of sortedAgents) {
          const previousSlotId = previousSceneSlotId(snapshot, agent);
          if (previousSlotId && slotById.has(previousSlotId) && !usedSlots.has(previousSlotId)) {
            assignments.push({ slot: slotById.get(previousSlotId), agent });
            usedSlots.add(previousSlotId);
            continue;
          }
          remaining.push(agent);
        }

        const freeSlots = slots.filter((slot) => !usedSlots.has(slot.id)).sort((left, right) => left.order - right.order);
        remaining.forEach((agent, index) => {
          const slot = freeSlots[index];
          if (slot) {
            assignments.push({ slot, agent });
          }
        });

        return assignments.sort((left, right) => left.slot.order - right.slot.order);
      }

      function assignAgentsToDeskSlots(snapshot, agents, slots) {
        const slotById = new Map(slots.map((slot) => [slot.id, slot]));
        const cubicles = new Map();
        slots.forEach((slot) => {
          const existing = cubicles.get(slot.cubicleId) || { id: slot.cubicleId, slots: [], agents: [] };
          existing.slots.push(slot);
          cubicles.set(slot.cubicleId, existing);
        });
        cubicles.forEach((cubicle) => {
          cubicle.slots.sort((left, right) => left.order - right.order);
        });

        const slotAgents = new Map();
        const remainingAgents = [];

        for (const agent of [...agents].sort((left, right) => compareAgentsForDeskLayout(snapshot, left, right))) {
          const previousSlotId = previousSceneSlotId(snapshot, agent);
          const slot = previousSlotId ? slotById.get(previousSlotId) : null;
          if (!slot) {
            remainingAgents.push(agent);
            continue;
          }
          const assigned = slotAgents.get(slot.id) || [];
          if (assigned.length >= (slot.capacity || 1)) {
            remainingAgents.push(agent);
            continue;
          }
          assigned.push(agent);
          slotAgents.set(slot.id, assigned);
          cubicles.get(slot.cubicleId)?.agents.push(agent);
        }

        const roleGroups = groupAgentsByRole(remainingAgents);
        for (const group of roleGroups) {
          const queue = [...group.agents];
          const preferredCubicles = [...cubicles.values()].sort((left, right) => {
            const leftRoles = new Set(left.agents.map((agent) => agentRole(agent)));
            const rightRoles = new Set(right.agents.map((agent) => agentRole(agent)));
            const leftMatches = leftRoles.has(group.role) ? 2 : leftRoles.size === 0 ? 1 : 0;
            const rightMatches = rightRoles.has(group.role) ? 2 : rightRoles.size === 0 ? 1 : 0;
            if (rightMatches !== leftMatches) {
              return rightMatches - leftMatches;
            }
            return left.slots[0].order - right.slots[0].order;
          });

          preferredCubicles.forEach((cubicle) => {
            while (queue.length > 0) {
              const nextSlot = cubicle.slots.find((slot) => {
                const assigned = slotAgents.get(slot.id) || [];
                return assigned.length < (slot.capacity || 1);
              });
              if (!nextSlot) {
                break;
              }
              const agent = queue.shift();
              const assigned = slotAgents.get(nextSlot.id) || [];
              assigned.push(agent);
              slotAgents.set(nextSlot.id, assigned);
              cubicle.agents.push(agent);
            }
          });
        }

        return [...slots]
          .filter((slot) => (slotAgents.get(slot.id) || []).length > 0)
          .map((slot) => ({
            slot,
            agents: slotAgents.get(slot.id)
              .slice(0, slot.capacity || 1)
              .sort((left, right) => {
                const leftMirrored = previousSceneMirrored(snapshot, left);
                const rightMirrored = previousSceneMirrored(snapshot, right);
                if (leftMirrored !== rightMirrored) {
                  if (leftMirrored === null) return 1;
                  if (rightMirrored === null) return -1;
                  return Number(leftMirrored) - Number(rightMirrored);
                }
                return compareAgentsForDeskLayout(snapshot, left, right);
              })
          }))
          .sort((left, right) => left.slot.order - right.slot.order);
      }

      function renderBossRelationshipLines(snapshot, roomId, roomPixelWidth, roomPixelHeight) {
        const lineEntries = [];
        for (const agent of snapshot.agents) {
          if (!isBossOfficeCandidate(snapshot, agent)) {
            continue;
          }
          const bossScene = sceneStateForAgent(snapshot, agent.id);
          if (!bossScene || bossScene.roomId !== roomId) {
            continue;
          }
          const childStates = childAgentsFor(snapshot, agent.id)
            .map((child) => ({ child, sceneState: sceneStateForAgent(snapshot, child.id) }))
            .filter((entry) => entry.sceneState && entry.sceneState.roomId === roomId);
          if (childStates.length === 0) {
            continue;
          }
          const bossFocusKey = focusAgentKey(snapshot, agent);
          const startX = Math.round(Number(bossScene.avatarX) + Number(bossScene.avatarWidth || 18) * 0.62);
          const startY = Math.round(Number(bossScene.avatarY) + Number(bossScene.avatarHeight || 24) * 0.46);
          for (const entry of childStates) {
            const childScene = entry.sceneState;
            const endX = Math.round(Number(childScene.avatarX) + Number(childScene.avatarWidth || 18) * 0.4);
            const endY = Math.round(Number(childScene.avatarY) + Number(childScene.avatarHeight || 24) * 0.48);
            const controlOffset = Math.max(18, Math.round((endX - startX) * 0.35));
            const path = \`M \${startX} \${startY} C \${startX + controlOffset} \${startY}, \${endX - controlOffset} \${endY}, \${endX} \${endY}\`;
            lineEntries.push(
              \`<path class="relationship-line" data-focus-line="true" data-focus-boss-key="\${escapeHtml(bossFocusKey)}" d="\${path}" />\`
            );
          }
        }
        if (lineEntries.length === 0) {
          return "";
        }
        return \`<svg class="relationship-lines" viewBox="0 0 \${roomPixelWidth} \${roomPixelHeight}" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="relationship-arrow-\${escapeHtml(roomId)}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="rgba(255, 221, 120, 0.9)"></path></marker></defs>\${lineEntries.join("").replaceAll('class="relationship-line"', \`class="relationship-line" marker-end="url(#relationship-arrow-\${escapeHtml(roomId)})"\`)}</svg>\`;
      }

      function avatarForAgent(agent) {
        const roster = pixelOffice.avatars;
        return roster[stableHash(\`\${agent.appearance.id}:\${agentRole(agent)}:\${agent.id}\`) % roster.length];
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function relativeLocation(projectRoot, location) {
        if (!location) return "";
        if (/^https?:\\/\\//.test(location)) return location;
        if (location === projectRoot) return ".";
        if (location.startsWith(projectRoot + "/")) {
          return location.slice(projectRoot.length + 1);
        }
        return location;
      }

      function wslToWindowsPath(location) {
        const normalized = String(location || "").trim();
        if (!normalized.startsWith("/mnt/") || normalized.length < 6) {
          return normalized;
        }
        const drive = normalized[5];
        const lowerDrive = drive.toLowerCase();
        if (lowerDrive < "a" || lowerDrive > "z") {
          return normalized;
        }
        const rest = normalized.startsWith("/mnt/" + drive + "/")
          ? normalized.slice(7)
          : normalized.length === 6
            ? ""
            : null;
        if (rest === null) {
          return normalized;
        }
        const restWindows = String(rest).replaceAll("/", "\\\\");
        return restWindows ? drive.toUpperCase() + ":\\\\" + restWindows : drive.toUpperCase() + ":\\\\";
      }

      function stripDisplayMarkdown(value) {
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
        const isPathBoundary = (character) => {
          if (!character) {
            return true;
          }
          const code = character.charCodeAt(0);
          return (
            code === 32 || code === 9 || code === 10 || code === 13 ||
            code === 34 || code === 39 || code === 40 || code === 41 ||
            code === 44 || code === 58 || code === 59 || code === 60 ||
            code === 62 || code === 63 || code === 91 || code === 92 ||
            code === 93 || code === 123 || code === 124 || code === 125 ||
            code === 33
          );
        };
        let output = "";
        let index = 0;
        while (index < plainText.length) {
          const next = plainText.indexOf("/mnt/", index);
          if (next === -1) {
            output += plainText.slice(index);
            break;
          }
          const previousChar = next > 0 ? plainText[next - 1] : "";
          if (!isPathBoundary(previousChar)) {
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
      }`;
