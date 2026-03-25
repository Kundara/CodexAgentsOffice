interface ClientScriptOptions {
  projectsJson: string;
  pixelOfficeJson: string;
  eventIconUrlsJson: string;
  threadItemIconUrlsJson: string;
}

export function renderClientScript({
  projectsJson,
  pixelOfficeJson,
  eventIconUrlsJson,
  threadItemIconUrlsJson
}: ClientScriptOptions): string {
  return `

      const configuredProjects = ${projectsJson};
      const pixelOffice = ${pixelOfficeJson};
      const eventIconUrls = ${eventIconUrlsJson};
      const threadItemIconUrls = ${threadItemIconUrlsJson};
      const params = new URLSearchParams(window.location.search);
      const initialProject = params.get("project") || "all";
      const initialView = params.get("view") || "map";
      const initialWorkspaceFullscreen = params.get("focus") === "1" && initialProject !== "all";
      const initialActiveOnly = true;
      const screenshotMode = params.get("screenshot") === "1";
      if (screenshotMode) {
        document.body.classList.add("snapshot-mode");
      }
      const state = {
        fleet: null,
        selected: initialProject,
        view: initialView === "terminal" ? "terminal" : "map",
        workspaceFullscreen: initialWorkspaceFullscreen,
        activeOnly: initialActiveOnly,
        connection: screenshotMode ? "snapshot" : "connecting",
        focusedSessionKeys: []
      };
      let events = null;
      const liveAgentMemory = new Map();
      let renderedAgentSceneState = new Map();
      let sceneStateDraft = null;
      let enteringAgentKeys = new Set();
      let departingAgents = [];
      let notifications = [];
      let notificationPruneTimer = null;
      let workstationEffectPruneTimer = null;
      let toastPreviewRun = 0;
      let toastPreviewTimerIds = [];
      const workstationEffects = new Map();
      const seenNotificationKeys = new Set();
      const recentNotificationTimes = new Map();
      const recentNotificationFingerprintTimes = new Map();
      const recentToastLineTimes = new Map();
      const NOTIFICATION_TTL_MS = 2400;
      const MESSAGE_NOTIFICATION_TTL_MS = 4600;
      const TOAST_FLOAT_ANIMATION_MS = 3300;
      const COMMAND_NOTIFICATION_BASE_TTL_MS = 2600;
      const COMMAND_NOTIFICATION_LINE_TTL_MS = 1200;
      const FILE_CHANGE_COMPUTER_FX_MS = 330;
      const NOTIFICATION_DEDUPE_WINDOW_MS = 1000;
      const NOTIFICATION_FINGERPRINT_DEDUPE_MS = 4000;
      const TOAST_LINE_DEDUPE_MS = 45000;
      const NOTIFICATION_PRIORITY_DEFAULT = 0;
      const NOTIFICATION_PRIORITY_MESSAGE = 2;
      const SCENE_RECENT_LEAD_LIMIT = 4;
      const SESSION_RECENT_LEAD_LIMIT = 10;
      const RESTING_DORMANT_MS = 15 * 60 * 1000;
      const DEPARTING_AGENT_TTL_MS = 520;
      let lastSceneRenderToken = null;
      let lastFleetSemanticToken = null;
      const recentLeadDisplayMemory = new Map();
      const activeRecentLeadReservations = new Map();

      const projectMetaByRoot = new Map(configuredProjects.map((project) => [project.root, project]));
      function projectInfo(projectRoot) {
        return projectMetaByRoot.get(projectRoot) || {
          root: projectRoot,
          label: projectRoot.split(/[\\\\/]/).filter(Boolean).pop() || projectRoot
        };
      }

      function projectLabel(projectRoot) {
        return projectInfo(projectRoot).label;
      }

      function agentKey(projectRoot, agent) {
        return \`\${projectRoot}::\${agent.id}\`;
      }

      function rememberAgentSceneState(snapshot, agent, sceneState) {
        if (!agent || !sceneState) {
          return;
        }
        const target = sceneStateDraft || renderedAgentSceneState;
        target.set(agentKey(snapshot.projectRoot, agent), sceneState);
      }

      function triggerWorkstationFileChangeEffect(entry) {
        if (!entry || !entry.isFileChange || !entry.key) {
          return;
        }
        const previous = workstationEffects.get(entry.key);
        const token = Number.isFinite(previous?.token) ? Number(previous.token) + 1 : 1;
        workstationEffects.set(entry.key, {
          token,
          expiresAt: Date.now() + FILE_CHANGE_COMPUTER_FX_MS
        });
        scheduleWorkstationEffectPrune();
      }

      function pruneWorkstationEffects() {
        const now = Date.now();
        workstationEffects.forEach((effect, key) => {
          if (!effect || !Number.isFinite(effect.expiresAt) || effect.expiresAt <= now) {
            workstationEffects.delete(key);
          }
        });
        scheduleWorkstationEffectPrune();
      }

      function scheduleWorkstationEffectPrune() {
        if (workstationEffectPruneTimer) {
          clearTimeout(workstationEffectPruneTimer);
          workstationEffectPruneTimer = null;
        }
        if (workstationEffects.size === 0) {
          syncWorkstationEffects();
          return;
        }
        const now = Date.now();
        const nextExpiry = Math.min(...Array.from(workstationEffects.values()).map((effect) => Number(effect.expiresAt) || now));
        const delay = Math.max(16, nextExpiry - now);
        workstationEffectPruneTimer = setTimeout(() => {
          workstationEffectPruneTimer = null;
          pruneWorkstationEffects();
          syncWorkstationEffects();
        }, delay);
        syncWorkstationEffects();
      }

      function syncWorkstationEffects() {
        const now = Date.now();
        document.querySelectorAll("[data-workstation-computer]").forEach((element) => {
          if (!(element instanceof HTMLElement)) {
            return;
          }
          const key = element.dataset.workstationComputer || "";
          const effect = workstationEffects.get(key);
          const isActive = Boolean(effect && Number(effect.expiresAt) > now);
          const token = isActive ? String(effect.token) : "";
          if (!isActive) {
            element.classList.remove("file-change-hit");
            delete element.dataset.workstationFxToken;
            return;
          }
          if (element.dataset.workstationFxToken !== token) {
            element.classList.remove("file-change-hit");
            void element.offsetWidth;
            element.dataset.workstationFxToken = token;
          }
          if (!element.classList.contains("file-change-hit")) {
            element.classList.add("file-change-hit");
          }
        });
      }

      function roomEntranceLayout(roomPixelWidth, compact) {
        const doorScale = compact ? 1.42 : 1.7;
        const clockScale = compact ? 0.92 : 1.08;
        const centerDoorY = compact ? 26 : 34;
        return {
          doorScale,
          clockScale,
          centerDoorX: Math.round(roomPixelWidth / 2 - pixelOffice.props.boothDoor.w * doorScale),
          centerDoorY,
          entryX: Math.round(roomPixelWidth / 2),
          entryY: Math.round(centerDoorY + pixelOffice.props.boothDoor.h * doorScale + (compact ? 2 : 3))
        };
      }

      function agentPathDelta(entrance, targetX, targetY, avatarWidth, avatarHeight) {
        const startX = Math.round(entrance.entryX - avatarWidth / 2);
        const startY = Math.round(entrance.entryY - avatarHeight + 2);
        return {
          pathX: startX - targetX,
          pathY: startY - targetY
        };
      }

      function sceneStateForAgent(snapshot, agentId) {
        if (!snapshot || !agentId) {
          return null;
        }
        const key = snapshot.projectRoot + "::" + agentId;
        return (sceneStateDraft && sceneStateDraft.get(key))
          || renderedAgentSceneState.get(key)
          || null;
      }

      function enteringMotionState(snapshot, agent, entrance, targetX, targetY, avatarWidth, avatarHeight) {
        return {
          mode: "entering",
          path: entrance
            ? agentPathDelta(entrance, targetX, targetY, avatarWidth, avatarHeight)
            : { pathX: 0, pathY: 0 }
        };
      }

      function motionShellClass(mode) {
        return mode ? \`office-avatar-shell \${mode}\` : "office-avatar-shell";
      }

      const mapViewButton = document.getElementById("map-view-button");
      const terminalViewButton = document.getElementById("terminal-view-button");
      const refreshButton = document.getElementById("refresh-button");
      const previewToastsButton = document.getElementById("preview-toasts-button");
      const scaffoldButton = document.getElementById("scaffold-button");
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

      function isBusyAgent(agent) {
        return agent.isCurrent === true;
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
              .filter((agent) => isBusyAgent(agent) && isRecentLeadCandidate(agent))
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
            .filter((agent) => isRecentLeadCandidate(agent) && !isBusyAgent(agent))
            .map((agent) => agent.id);
          recentLeadDisplayMemory.set(snapshot.projectRoot, visibleIds);
        }
      }

      function isRecentSessionCandidate(agent) {
        return agent.source !== "cloud" && agent.source !== "presence";
      }

      function recentLeadAgents(snapshot, limit = SCENE_RECENT_LEAD_LIMIT) {
        const activeIds = new Set(snapshot.agents.filter(isBusyAgent).map((agent) => agent.id));
        const effectiveLimit = Math.max(0, limit - reservedRecentLeadSlots(snapshot));
        return [...snapshot.agents]
          .filter((agent) => isRecentLeadCandidate(agent) && !activeIds.has(agent.id))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, effectiveLimit);
      }

      function recentSessionAgents(snapshot, limit = SESSION_RECENT_LEAD_LIMIT) {
        const activeIds = new Set(snapshot.agents.filter(isBusyAgent).map((agent) => agent.id));
        return [...snapshot.agents]
          .filter((agent) => isRecentSessionCandidate(agent) && !activeIds.has(agent.id))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
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

      function viewSnapshot(snapshot, recentLeadLimit = SCENE_RECENT_LEAD_LIMIT) {
        const activeAgents = snapshot.agents.filter(isBusyAgent);
        const recentLeads = recentLeadAgents(snapshot, recentLeadLimit);
        return {
          ...snapshot,
          agents: [...activeAgents, ...recentLeads]
        };
      }

      function viewSessionSnapshot(snapshot, recentSessionLimit = SESSION_RECENT_LEAD_LIMIT) {
        const activeAgents = snapshot.agents.filter(isBusyAgent);
        const recentAgents = recentSessionAgents(snapshot, recentSessionLimit);
        return {
          ...snapshot,
          agents: [...activeAgents, ...recentAgents]
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
            agents: [...roleAgents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
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

      function fixedSceneLayoutConfig(compact) {
        return compact
          ? {
              deskStartRatio: 0.2,
              deskColumnGap: 16,
              deskRowGap: 0,
              deskCubicleGap: 0,
              cubiclesPerColumn: 1,
              cubicleRows: 3,
              deskTopY: 56,
              podWidth: 120,
              podHeight: 54,
              bossLaneX: 8,
              bossLaneWidth: 64,
              bossOfficeGapToDesk: 8,
              bossOfficeTopY: 68,
              bossOfficeGapY: 8,
              bossOfficeWidth: 56,
              bossOfficeHeight: 34
            }
          : {
              deskStartRatio: 0.2,
              deskColumnGap: 20,
              deskRowGap: 0,
              deskCubicleGap: 0,
              cubiclesPerColumn: 1,
              cubicleRows: 3,
              deskTopY: 66,
              podWidth: 152,
              podHeight: 70,
              bossLaneX: 10,
              bossLaneWidth: 74,
              bossOfficeGapToDesk: 10,
              bossOfficeTopY: 82,
              bossOfficeGapY: 10,
              bossOfficeWidth: 62,
              bossOfficeHeight: 40
            };
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
                order: columnIndex * slotsPerColumn + cubicleIndex * config.cubicleRows + rowIndex,
                columnIndex,
                cubicleIndex,
                rowIndex,
                cubicleId: \`cubicle-\${columnIndex}-\${cubicleIndex}\`,
                x: columnX,
                y: cubicleBaseY + rowIndex * (config.podHeight + config.deskRowGap),
                width: config.podWidth,
                height: config.podHeight,
                capacity: 2
              });
            }
          }
        }
        return slots;
      }

      function previousSceneSlotId(snapshot, agent) {
        const sceneState = sceneStateForAgent(snapshot, agent.id);
        return sceneState && sceneState.slotId ? String(sceneState.slotId) : null;
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
            agents: slotAgents.get(slot.id).slice(0, slot.capacity || 1)
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

      function normalizeDisplayText(projectRoot, value) {
        const normalized = String(value || "").trim();
        if (!normalized) {
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
        while (index < normalized.length) {
          const next = normalized.indexOf("/mnt/", index);
          if (next === -1) {
            output += normalized.slice(index);
            break;
          }
          const previousChar = next > 0 ? normalized[next - 1] : "";
          if (!isPathBoundary(previousChar)) {
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

      function buildNotificationFingerprint(projectRoot, agent, descriptor) {
        return [
          projectRoot,
          agent.id,
          descriptor.kindClass,
          descriptor.label,
          descriptor.title,
          descriptor.imageUrl || "",
          descriptor.anchor || "agent",
          descriptor.isCommand ? "cmd" : "",
          descriptor.linesAdded ?? "",
          descriptor.linesRemoved ?? ""
        ].join("::");
      }

      function notificationPriorityValue(descriptor) {
        return Number.isFinite(descriptor && descriptor.priority)
          ? Number(descriptor.priority)
          : NOTIFICATION_PRIORITY_DEFAULT;
      }

      function commandNotificationLifetimeMs(lineCount) {
        const count = Math.max(1, Math.min(3, Number.isFinite(lineCount) ? Number(lineCount) : 1));
        return COMMAND_NOTIFICATION_BASE_TTL_MS + count * COMMAND_NOTIFICATION_LINE_TTL_MS;
      }

      function notificationLifetimeMs(entry) {
        const priority = Number.isFinite(entry && entry.priority)
          ? Number(entry.priority)
          : NOTIFICATION_PRIORITY_DEFAULT;
        return priority >= NOTIFICATION_PRIORITY_MESSAGE ? MESSAGE_NOTIFICATION_TTL_MS : NOTIFICATION_TTL_MS;
      }

      function notificationExpiresAt(entry) {
        if (Number.isFinite(entry && entry.expiresAt)) {
          return Number(entry.expiresAt);
        }
        return Number(entry.createdAt) + notificationLifetimeMs(entry);
      }

      function toastAnimationDelay(entry, now = Date.now()) {
        const createdAt = Number(entry && entry.createdAt);
        if (!Number.isFinite(createdAt)) {
          return "0ms";
        }
        const elapsed = Math.max(0, Math.min(TOAST_FLOAT_ANIMATION_MS, now - createdAt));
        return "-" + Math.round(elapsed) + "ms";
      }

      function notificationSemanticKey(projectRoot, key, descriptor) {
        return [
          projectRoot,
          key,
          descriptor.kindClass || "",
          descriptor.label || "",
          descriptor.title || "",
          descriptor.labelIconUrl || "",
          descriptor.imageUrl || "",
          descriptor.anchor || "agent",
          descriptor.isFileChange ? "file" : "",
          descriptor.isCommand ? "cmd" : "",
          notificationPriorityValue(descriptor),
          descriptor.linesAdded ?? "",
          descriptor.linesRemoved ?? ""
        ].join("::");
      }

      function notificationInstanceId(projectRoot, subjectKey, descriptor, fallbackId) {
        if (notificationPriorityValue(descriptor) >= NOTIFICATION_PRIORITY_MESSAGE) {
          return [
            "message",
            projectRoot,
            subjectKey,
            normalizeMessageToastText(descriptor.title || "")
          ].join("::");
        }
        return fallbackId;
      }

      function notificationTitle(snapshot, agent) {
        const event = agent.activityEvent;
        if (!event) {
          return normalizeDisplayText(snapshot.projectRoot, agent.detail);
        }
        if (event.type === "fileChange" && event.path) {
          const cleaned = cleanReportedPath(snapshot.projectRoot, event.path);
          return cleaned || normalizeDisplayText(snapshot.projectRoot, event.title || agent.detail);
        }
        return normalizeDisplayText(snapshot.projectRoot, event.title || agent.detail);
      }

      function webSearchNotificationTitle(projectRoot, query, phase = "completed") {
        const normalizedQuery = normalizeDisplayText(projectRoot, query || "Web search");
        return (phase === "started" ? "Searching web for " : "Searched web for ") + normalizedQuery;
      }

      function shortenNotificationText(value, maxLength = 44) {
        const normalized = String(value || "").replace(/\\s+/g, " ").trim();
        if (normalized.length <= maxLength) {
          return normalized;
        }
        return normalized.slice(0, maxLength - 1) + "…";
      }

      function normalizeMessageToastText(value) {
        return String(value || "")
          .replace(/\\s+/g, " ")
          .replace(/[.?!,:;]+$/g, "")
          .replace(/…$/g, "")
          .trim()
          .toLowerCase();
      }

      function normalizeToastLineFingerprint(value) {
        return String(value || "")
          .replace(/\\s+/g, " ")
          .replace(/[.?!,:;]+$/g, "")
          .replace(/…$/g, "")
          .trim()
          .toLowerCase();
      }

      function equivalentMessageToastText(left, right) {
        const normalizedLeft = normalizeMessageToastText(left);
        const normalizedRight = normalizeMessageToastText(right);
        if (!normalizedLeft || !normalizedRight) {
          return false;
        }
        return normalizedLeft === normalizedRight
          || normalizedLeft.startsWith(normalizedRight)
          || normalizedRight.startsWith(normalizedLeft);
      }

      function commandLineText(value) {
        return shortenNotificationText(value || "", 88);
      }

      function stackableToastLineText(value, priority) {
        return shortenNotificationText(value || "", priority >= NOTIFICATION_PRIORITY_MESSAGE ? 156 : 104);
      }

      function isSuppressedCommandToastTitle(value) {
        const normalized = String(value || "").replace(/\\s+/g, " ").trim();
        return normalized.length === 0 || /^[-–—_]+$/.test(normalized);
      }

      function commandLinesForEntry(entry) {
        if (Array.isArray(entry && entry.commandLines) && entry.commandLines.length > 0) {
          return entry.commandLines
            .map((line) => commandLineText(line))
            .filter((line) => !isSuppressedCommandToastTitle(line))
            .slice(-3);
        }
        const title = commandLineText(entry && entry.title ? entry.title : "");
        return isSuppressedCommandToastTitle(title) ? [] : [title];
      }

      function stackableToastLinesForEntry(entry) {
        if (Array.isArray(entry && entry.toastLines) && entry.toastLines.length > 0) {
          return entry.toastLines
            .map((line) => stackableToastLineText(line, notificationPriorityValue(entry)))
            .filter(Boolean)
            .slice(-3);
        }
        const title = stackableToastLineText(entry && entry.title ? entry.title : "", notificationPriorityValue(entry));
        return title ? [title] : [];
      }

      function notificationLine(descriptor) {
        const isMessageToast = notificationPriorityValue(descriptor) >= NOTIFICATION_PRIORITY_MESSAGE;
        const label = descriptor.labelIconUrl && !isMessageToast ? "" : shortenNotificationText(descriptor.label || "", 18);
        const commandLines = descriptor.isCommand ? commandLinesForEntry(descriptor) : [];
        const toastLines = descriptor.isCommand ? [] : stackableToastLinesForEntry(descriptor);
        const title = descriptor.isCommand
          ? (commandLines[commandLines.length - 1] || "")
          : (toastLines[toastLines.length - 1] || "");
        return {
          label,
          title,
          commandLines,
          toastLines,
          labelIconUrl: isMessageToast ? null : (descriptor.labelIconUrl || null),
          isCommand: descriptor.isCommand === true,
          linesAdded: Number.isFinite(descriptor.linesAdded) ? descriptor.linesAdded : null,
          linesRemoved: Number.isFinite(descriptor.linesRemoved) ? descriptor.linesRemoved : null
        };
      }

      function notificationDescriptorFromEvent(snapshot, event) {
        if (!event) {
          return null;
        }
        const requestTitle = normalizeDisplayText(snapshot.projectRoot, event.command || event.reason || event.detail || event.title);
        const labelIconUrl = eventIconUrlForMethod(event.method) || eventIconUrlForThreadItemType(event.itemType);
        switch (event.kind) {
          case "approval":
            return {
              kindClass: "blocked",
              label: event.method === "item/commandExecution/requestApproval" && event.networkApprovalContext ? "Network" : "Needs",
              labelIconUrl,
              title: requestTitle || "approval",
              imageUrl: null,
              anchor: "agent",
              isFileChange: false,
              isCommand: false,
              priority: NOTIFICATION_PRIORITY_DEFAULT,
              linesAdded: null,
              linesRemoved: null
            };
          case "input":
            return {
              kindClass: "waiting",
              label: event.phase === "completed" ? "Answered" : "Needs",
              labelIconUrl,
              title: requestTitle || "input",
              imageUrl: null,
              anchor: "agent",
              isFileChange: false,
              isCommand: false,
              priority: NOTIFICATION_PRIORITY_DEFAULT,
              linesAdded: null,
              linesRemoved: null
            };
          case "turn":
            return {
              kindClass: event.phase === "failed" ? "blocked" : event.phase === "interrupted" ? "waiting" : "update",
              label:
                event.phase === "failed" ? "Failed"
                : event.phase === "completed" ? "Done"
                : event.phase === "interrupted" ? "Interrupted"
                : event.method === "turn/plan/updated" ? "Plan"
                : event.method === "turn/diff/updated" ? "Diff"
                : "Turn",
              labelIconUrl,
              title: normalizeDisplayText(snapshot.projectRoot, event.title || event.detail),
              imageUrl: null,
              anchor: "agent",
              isFileChange: false,
              isCommand: false,
              priority: NOTIFICATION_PRIORITY_DEFAULT,
              linesAdded: null,
              linesRemoved: null
            };
          case "command":
            {
              const readDescriptor = readCommandDescriptor(
                snapshot,
                normalizeDisplayText(snapshot.projectRoot, event.command || event.detail || event.title),
                event.phase,
                event.method
              );
              if (readDescriptor) {
                return readDescriptor;
              }
            }
            return commandDescriptor(
              event.phase === "failed" ? "blocked" : "run",
              event.method === "item/commandExecution/requestApproval"
                ? (event.networkApprovalContext ? "Network" : "Needs")
                : event.phase === "failed" ? "Failed"
                : event.phase === "completed" ? "Done"
                : event.phase === "updated" ? "Output"
                : "Ran",
              normalizeDisplayText(snapshot.projectRoot, event.command || event.detail || event.title),
              { isCommand: true, labelIconUrl }
            );
          case "tool":
            if (event.itemType === "webSearch") {
              return {
                kindClass: "update",
                label: "",
                title: webSearchNotificationTitle(snapshot.projectRoot, event.detail || event.title, event.phase),
                labelIconUrl,
                imageUrl: null,
                anchor: "agent",
                isFileChange: false,
                isCommand: false,
                priority: NOTIFICATION_PRIORITY_MESSAGE,
                linesAdded: null,
                linesRemoved: null
              };
            }
            return {
              kindClass: "update",
              label: "",
              title: normalizeDisplayText(snapshot.projectRoot, event.detail || event.title),
              labelIconUrl,
              imageUrl: null,
              anchor: "agent",
              isFileChange: false,
              isCommand: false,
              priority: NOTIFICATION_PRIORITY_DEFAULT,
              linesAdded: null,
              linesRemoved: null
            };
          case "fileChange":
            return fileChangeDescriptor(snapshot.projectRoot, event, event.title || event.detail, { labelIconUrl });
          case "subagent":
            return {
              kindClass: "update",
              label: "Spawn",
              labelIconUrl,
              title: normalizeDisplayText(snapshot.projectRoot, event.detail || event.title),
              imageUrl: null,
              anchor: "agent",
              isFileChange: false,
              isCommand: false,
              priority: NOTIFICATION_PRIORITY_DEFAULT,
              linesAdded: null,
              linesRemoved: null
            };
          case "message":
            return {
              kindClass: "update",
              label: "",
              labelIconUrl,
              title: normalizeDisplayText(snapshot.projectRoot, event.detail || event.title),
              imageUrl: null,
              anchor: "agent",
              isFileChange: false,
              isCommand: false,
              priority: NOTIFICATION_PRIORITY_MESSAGE,
              linesAdded: null,
              linesRemoved: null
            };
          case "item":
            return {
              kindClass:
                event.phase === "failed" ? "blocked"
                : event.phase === "completed" ? "update"
                : "update",
              label: "",
              labelIconUrl,
              title: normalizeDisplayText(snapshot.projectRoot, event.detail || event.title),
              imageUrl: null,
              anchor: "agent",
              isFileChange: false,
              isCommand: false,
              priority: NOTIFICATION_PRIORITY_DEFAULT,
              linesAdded: null,
              linesRemoved: null
            };
          default:
            return null;
        }
      }

      function trimRecentNotificationTimes(now) {
        recentNotificationTimes.forEach((timestamp, key) => {
          if (!Number.isFinite(timestamp) || now - timestamp > MESSAGE_NOTIFICATION_TTL_MS) {
            recentNotificationTimes.delete(key);
          }
        });
        recentNotificationFingerprintTimes.forEach((timestamp, key) => {
          if (!Number.isFinite(timestamp) || now - timestamp > NOTIFICATION_FINGERPRINT_DEDUPE_MS) {
            recentNotificationFingerprintTimes.delete(key);
          }
        });
        recentToastLineTimes.forEach((timestamp, key) => {
          if (!Number.isFinite(timestamp) || now - timestamp > TOAST_LINE_DEDUPE_MS) {
            recentToastLineTimes.delete(key);
          }
        });
      }

      function hasActiveHigherPriorityNotification(priority, now) {
        return notifications.some((entry) => {
          if (!Number.isFinite(entry.priority) || entry.priority <= priority) {
            return false;
          }
          return now < notificationExpiresAt(entry);
        });
      }

      function hasActiveSemanticNotification(semanticKey, now) {
        return notifications.some((entry) => {
          if (entry.semanticKey !== semanticKey) {
            return false;
          }
          return now < notificationExpiresAt(entry);
        });
      }

      function hasActiveEquivalentMessageNotification(entry, now) {
        return notifications.some((candidate) => {
          if (notificationPriorityValue(candidate) < NOTIFICATION_PRIORITY_MESSAGE) {
            return false;
          }
          if (now >= notificationExpiresAt(candidate)) {
            return false;
          }
          if (candidate.projectRoot !== entry.projectRoot || candidate.key !== entry.key) {
            return false;
          }
          return equivalentMessageToastText(candidate.title, entry.title);
        });
      }

      function notificationStackKey(entry) {
        if (!entry || entry.isCommand || entry.imageUrl) {
          return null;
        }
        return [
          entry.projectRoot,
          entry.key,
          entry.kindClass || "",
          entry.label || "",
          entry.labelIconUrl || "",
          entry.anchor || "agent",
          entry.isFileChange ? "file" : "",
          Number.isFinite(entry.priority) ? Number(entry.priority) : NOTIFICATION_PRIORITY_DEFAULT
        ].join("::");
      }

      function notificationFingerprint(entry) {
        if (!entry) {
          return null;
        }
        const priority = notificationPriorityValue(entry);
        const normalizedTitle = priority >= NOTIFICATION_PRIORITY_MESSAGE
          ? normalizeMessageToastText(entry.title || "")
          : normalizeToastLineFingerprint(entry.title || "");
        return [
          entry.projectRoot || "",
          entry.key || "",
          entry.kindClass || "",
          entry.label || "",
          normalizedTitle,
          entry.labelIconUrl || "",
          entry.imageUrl || "",
          entry.anchor || "agent",
          entry.isFileChange ? "file" : "",
          entry.isCommand ? "cmd" : "",
          priority
        ].join("::");
      }

      function toastLineDedupeKey(entry, line) {
        const normalizedLine = normalizeToastLineFingerprint(line);
        if (!normalizedLine) {
          return null;
        }
        const scope = entry.isCommand
          ? ["command", entry.projectRoot, entry.key, entry.anchor || "agent"].join("::")
          : notificationStackKey(entry) || ["toast", entry.projectRoot, entry.key, entry.kindClass || "", entry.anchor || "agent"].join("::");
        return scope + "::" + normalizedLine;
      }

      function hasEquivalentToastLine(lines, nextLine) {
        const normalizedNextLine = normalizeToastLineFingerprint(nextLine);
        if (!normalizedNextLine) {
          return false;
        }
        return lines.some((line) => normalizeToastLineFingerprint(line) === normalizedNextLine);
      }

      function hasRecentlySeenToastLine(entry, line, now) {
        const dedupeKey = toastLineDedupeKey(entry, line);
        if (!dedupeKey) {
          return false;
        }
        const lastShownAt = recentToastLineTimes.get(dedupeKey);
        return Number.isFinite(lastShownAt) && now - lastShownAt < TOAST_LINE_DEDUPE_MS;
      }

      function rememberToastLine(entry, line, now) {
        const dedupeKey = toastLineDedupeKey(entry, line);
        if (!dedupeKey) {
          return;
        }
        recentToastLineTimes.set(dedupeKey, now);
      }

      function hasRecentlySeenNotificationFingerprint(entry, now) {
        const fingerprint = notificationFingerprint(entry);
        if (!fingerprint) {
          return false;
        }
        const lastShownAt = recentNotificationFingerprintTimes.get(fingerprint);
        return Number.isFinite(lastShownAt) && now - lastShownAt < NOTIFICATION_FINGERPRINT_DEDUPE_MS;
      }

      function rememberNotificationFingerprint(entry, now) {
        const fingerprint = notificationFingerprint(entry);
        if (!fingerprint) {
          return;
        }
        recentNotificationFingerprintTimes.set(fingerprint, now);
      }

      function stackableNotificationLifetimeMs(entry, lineCount) {
        const base = notificationPriorityValue(entry) >= NOTIFICATION_PRIORITY_MESSAGE
          ? MESSAGE_NOTIFICATION_TTL_MS
          : NOTIFICATION_TTL_MS;
        return base + Math.max(0, lineCount - 1) * 900;
      }

      function mergeStackableNotification(entry, now) {
        const stackKey = notificationStackKey(entry);
        if (!stackKey) {
          return false;
        }

        const nextLine = stackableToastLineText(entry.title || "", notificationPriorityValue(entry));
        if (!nextLine) {
          return false;
        }

        const existing = notifications.find((candidate) =>
          !candidate.isCommand
          && candidate.stackKey === stackKey
          && now < notificationExpiresAt(candidate)
        );

        if (!existing) {
          return false;
        }

        const previousLines = stackableToastLinesForEntry(existing);
        if (hasEquivalentToastLine(previousLines, nextLine) || hasRecentlySeenToastLine(existing, nextLine, now)) {
          return false;
        }
        const shouldAppend = true;
        const mergedLines = shouldAppend ? [...previousLines, nextLine].slice(-3) : previousLines.slice(-3);

        existing.kindClass = entry.kindClass;
        existing.label = entry.label;
        existing.title = entry.title;
        existing.labelIconUrl = entry.labelIconUrl;
        existing.imageUrl = entry.imageUrl;
        existing.anchor = entry.anchor;
        existing.isFileChange = entry.isFileChange === true;
        existing.isCommand = false;
        existing.priority = Number.isFinite(entry.priority) ? Number(entry.priority) : NOTIFICATION_PRIORITY_DEFAULT;
        existing.linesAdded = Number.isFinite(entry.linesAdded) ? Number(entry.linesAdded) : null;
        existing.linesRemoved = Number.isFinite(entry.linesRemoved) ? Number(entry.linesRemoved) : null;
        existing.semanticKey = entry.semanticKey;
        existing.toastLines = mergedLines;
        existing.stackKey = stackKey;
        existing.expiresAt = now + stackableNotificationLifetimeMs(existing, mergedLines.length);
        if (shouldAppend) {
          existing.lastToastLine = nextLine;
          existing.lastToastLineAt = now;
          rememberToastLine(existing, nextLine, now);
        }
        return shouldAppend;
      }

      function mergeCommandNotification(entry, now) {
        const nextLine = commandLineText(entry.title || "");
        if (isSuppressedCommandToastTitle(nextLine)) {
          return false;
        }

        const existing = notifications.find((candidate) =>
          candidate.isCommand
          && candidate.key === entry.key
          && candidate.projectRoot === entry.projectRoot
          && now < notificationExpiresAt(candidate)
        );

        if (!existing) {
          if (hasRecentlySeenToastLine(entry, nextLine, now)) {
            return false;
          }
          notifications.push({
            ...entry,
            createdAt: now,
            expiresAt: now + commandNotificationLifetimeMs(1),
            commandLines: [nextLine],
            lastCommandLine: nextLine,
            lastCommandLineAt: now
          });
          rememberToastLine(entry, nextLine, now);
          return true;
        }

        const previousLines = commandLinesForEntry(existing);
        if (hasEquivalentToastLine(previousLines, nextLine) || hasRecentlySeenToastLine(existing, nextLine, now)) {
          return false;
        }
        const shouldAppend = true;
        const mergedLines = shouldAppend ? [...previousLines, nextLine].slice(-3) : previousLines.slice(-3);

        existing.kindClass = entry.kindClass;
        existing.label = entry.label;
        existing.title = nextLine;
        existing.labelIconUrl = entry.labelIconUrl;
        existing.imageUrl = null;
        existing.anchor = entry.anchor;
        existing.isFileChange = false;
        existing.isCommand = true;
        existing.priority = Number.isFinite(entry.priority) ? Number(entry.priority) : NOTIFICATION_PRIORITY_DEFAULT;
        existing.linesAdded = null;
        existing.linesRemoved = null;
        existing.semanticKey = entry.semanticKey;
        existing.commandLines = mergedLines;
        existing.expiresAt = now + commandNotificationLifetimeMs(mergedLines.length);
        if (shouldAppend) {
          existing.lastCommandLine = nextLine;
          existing.lastCommandLineAt = now;
          rememberToastLine(existing, nextLine, now);
        }
        return shouldAppend;
      }

      function enqueueNotification(entry) {
        const now = Date.now();
        const priority = Number.isFinite(entry.priority) ? entry.priority : NOTIFICATION_PRIORITY_DEFAULT;
        trimRecentNotificationTimes(now);

        if (hasRecentlySeenNotificationFingerprint({ ...entry, priority }, now)) {
          return false;
        }

        if (hasActiveHigherPriorityNotification(priority, now)) {
          return false;
        }

        if (priority >= NOTIFICATION_PRIORITY_MESSAGE && hasActiveEquivalentMessageNotification(entry, now)) {
          return false;
        }

        if (entry.isCommand) {
          const changed = mergeCommandNotification({ ...entry, priority }, now);
          if (changed) {
            rememberNotificationFingerprint({ ...entry, priority }, now);
            triggerWorkstationFileChangeEffect(entry);
          }
          notifications = notifications.slice(-24);
          scheduleNotificationPrune();
          return changed;
        }

        const stacked = mergeStackableNotification({ ...entry, priority }, now);
        if (stacked) {
          rememberNotificationFingerprint({ ...entry, priority }, now);
          triggerWorkstationFileChangeEffect(entry);
          notifications = notifications.slice(-24);
          scheduleNotificationPrune();
          return true;
        }

        if (priority >= NOTIFICATION_PRIORITY_MESSAGE) {
          notifications = [];
        }

        const lastShownAt = recentNotificationTimes.get(entry.semanticKey);
        if (Number.isFinite(lastShownAt) && now - lastShownAt < NOTIFICATION_DEDUPE_WINDOW_MS) {
          return false;
        }

        if (hasActiveSemanticNotification(entry.semanticKey, now)) {
          return false;
        }

        const initialToastLines = stackableToastLinesForEntry({ ...entry, priority });
        if (initialToastLines.length > 0 && hasRecentlySeenToastLine({ ...entry, priority }, initialToastLines[initialToastLines.length - 1], now)) {
          return false;
        }

        notifications.push({
          ...entry,
          priority,
          createdAt: now,
          toastLines: initialToastLines,
          stackKey: notificationStackKey({ ...entry, priority }),
          expiresAt: now + stackableNotificationLifetimeMs({ ...entry, priority }, 1)
        });
        rememberNotificationFingerprint({ ...entry, priority }, now);
        triggerWorkstationFileChangeEffect(entry);
        if (initialToastLines.length > 0) {
          rememberToastLine({ ...entry, priority }, initialToastLines[initialToastLines.length - 1], now);
        }
        recentNotificationTimes.set(entry.semanticKey, now);
        notifications = notifications.slice(-24);
        scheduleNotificationPrune();
        return true;
      }

      function clearToastPreviewTimers() {
        toastPreviewTimerIds.forEach((timerId) => clearTimeout(timerId));
        toastPreviewTimerIds = [];
      }

      function currentPreviewSnapshot() {
        const fleet = state.fleet;
        if (!fleet || !Array.isArray(fleet.projects) || fleet.projects.length === 0) {
          return null;
        }
        if (state.selected !== "all") {
          return fleet.projects.find((snapshot) => snapshot.projectRoot === state.selected) || fleet.projects[0] || null;
        }
        return fleet.projects.find((snapshot) => snapshot.agents.some((agent) => agent.isCurrent)) || fleet.projects[0] || null;
      }

      function currentPreviewAgent(snapshot) {
        if (!snapshot || !Array.isArray(snapshot.agents)) {
          return null;
        }
        return snapshot.agents.find((agent) => agent.isCurrent) || snapshot.agents[0] || null;
      }

      function queueToastPreviewDescriptor(snapshot, agent, descriptor, runId, index) {
        const key = agentKey(snapshot.projectRoot, agent);
        enqueueNotification({
          id: \`preview::\${runId}::\${index}\`,
          key,
          projectRoot: snapshot.projectRoot,
          semanticKey: \`preview::\${runId}::\${index}\`,
          kindClass: descriptor.kindClass,
          label: descriptor.label,
          title: descriptor.title,
          labelIconUrl: descriptor.labelIconUrl,
          imageUrl: descriptor.imageUrl,
          anchor: descriptor.anchor,
          isFileChange: descriptor.isFileChange,
          isCommand: descriptor.isCommand,
          priority: notificationPriorityValue(descriptor),
          linesAdded: descriptor.linesAdded,
          linesRemoved: descriptor.linesRemoved
        });
        renderNotifications();
      }

      function runToastPreview() {
        const snapshot = currentPreviewSnapshot();
        const agent = currentPreviewAgent(snapshot);
        if (!snapshot || !agent) {
          return;
        }

        toastPreviewRun += 1;
        const runId = toastPreviewRun;
        const threadId = agent.threadId || \`preview-thread-\${agent.id}\`;
        const baseIso = new Date().toISOString();
        const previewEvents = [
          {
            kind: "fileChange",
            phase: "completed",
            method: "item/fileChange/outputDelta",
            title: "architecture.md",
            detail: "Updated architecture.md",
            path: "docs/architecture.md",
            action: "edited",
            isImage: false,
            linesAdded: 12,
            linesRemoved: 4
          },
          {
            kind: "tool",
            phase: "completed",
            method: "item/completed",
            itemType: "webSearch",
            title: "Web search completed",
            detail: "official Codex app-server events"
          },
          {
            kind: "input",
            phase: "waiting",
            method: "item/tool/requestUserInput",
            title: "input",
            detail: "Choose the release lane for this preview run"
          },
          {
            kind: "approval",
            phase: "waiting",
            method: "item/commandExecution/requestApproval",
            title: "approval",
            detail: "npm publish --tag next",
            command: "npm publish --tag next"
          },
          {
            kind: "command",
            phase: "started",
            method: "item/commandExecution/outputDelta",
            title: "npm run build -w packages/web",
            detail: "npm run build -w packages/web",
            command: "npm run build -w packages/web"
          },
          {
            kind: "message",
            phase: "updated",
            method: "item/agentMessage/delta",
            title: "Toast preview message",
            detail: "Toast preview: message icon replaces the type label and clears older toasts."
          }
        ];

        clearToastPreviewTimers();
        notifications = [];
        renderNotifications();

        previewEvents.forEach((previewEvent, index) => {
          const timerId = setTimeout(() => {
            if (runId !== toastPreviewRun) {
              return;
            }
            const descriptor = notificationDescriptorFromEvent(snapshot, {
              id: \`preview-event-\${runId}-\${index}\`,
              source: agent.provenance || "codex",
              confidence: agent.confidence || "typed",
              threadId,
              createdAt: baseIso,
              turnId: \`preview-turn-\${runId}\`,
              itemId: \`preview-item-\${runId}-\${index}\`,
              requestId:
                previewEvent.kind === "approval" || previewEvent.kind === "input"
                  ? \`preview-request-\${runId}-\${index}\`
                  : undefined,
              path: null,
              reason: undefined,
              cwd: agent.cwd || snapshot.projectRoot,
              grantRoot: snapshot.projectRoot,
              availableDecisions: undefined,
              networkApprovalContext: null,
              linesAdded: undefined,
              linesRemoved: undefined,
              ...previewEvent
            });
            if (!descriptor) {
              return;
            }
            queueToastPreviewDescriptor(snapshot, agent, descriptor, runId, index);
          }, index * 1250);
          toastPreviewTimerIds.push(timerId);
        });
      }

      function projectFileUrl(projectRoot, path) {
        return \`/api/project-file?projectRoot=\${encodeURIComponent(projectRoot)}&path=\${encodeURIComponent(path)}\`;
      }

      function queueAgentNotifications(previousFleet, nextFleet) {
        if (!previousFleet || screenshotMode) {
          return;
        }

        const previousAgents = new Map();
        for (const snapshot of previousFleet.projects || []) {
          for (const agent of snapshot.agents || []) {
            previousAgents.set(agentKey(snapshot.projectRoot, agent), agent);
          }
        }

        for (const snapshot of nextFleet.projects || []) {
          for (const agent of snapshot.agents || []) {
            const key = agentKey(snapshot.projectRoot, agent);
            const semanticSubjectKey = notificationSubjectKey(snapshot.projectRoot, agent, agent.threadId);
            const previous = previousAgents.get(key);
            const descriptor = notificationDescriptor(snapshot, agent, previous);
            if (!descriptor) {
              continue;
            }

            const nextFingerprint = buildNotificationFingerprint(snapshot.projectRoot, agent, descriptor);
            const previousDescriptor = previous ? notificationDescriptor(snapshot, previous, null) : null;
            const previousFingerprint = previous && previousDescriptor
              ? buildNotificationFingerprint(snapshot.projectRoot, previous, previousDescriptor)
              : null;
            const nextNotificationKey = notificationInstanceId(
              snapshot.projectRoot,
              semanticSubjectKey,
              descriptor,
              nextFingerprint + "::" + agent.updatedAt
            );

            if (nextFingerprint === previousFingerprint || seenNotificationKeys.has(nextNotificationKey)) {
              continue;
            }

            enqueueNotification({
              id: nextNotificationKey,
              key,
              projectRoot: snapshot.projectRoot,
              semanticKey: notificationSemanticKey(snapshot.projectRoot, semanticSubjectKey, descriptor),
              kindClass: descriptor.kindClass,
              label: descriptor.label,
              title: descriptor.title,
              labelIconUrl: descriptor.labelIconUrl,
              imageUrl: descriptor.imageUrl,
              anchor: descriptor.anchor,
              isFileChange: descriptor.isFileChange,
              isCommand: descriptor.isCommand,
              priority: notificationPriorityValue(descriptor),
              linesAdded: descriptor.linesAdded,
              linesRemoved: descriptor.linesRemoved
            });
            seenNotificationKeys.add(nextNotificationKey);
          }
        }

        scheduleNotificationPrune();
      }

      function queueSnapshotEvents(previousFleet, nextFleet) {
        if (!previousFleet || !nextFleet || screenshotMode) {
          return;
        }

        const previousEventIds = new Set();
        for (const snapshot of previousFleet.projects || []) {
          for (const event of snapshot.events || []) {
            previousEventIds.add(event.id);
          }
        }

        for (const snapshot of nextFleet.projects || []) {
          for (const event of snapshot.events || []) {
            if (previousEventIds.has(event.id)) {
              continue;
            }
            const descriptor = notificationDescriptorFromEvent(snapshot, event);
            if (!descriptor) {
              continue;
            }
            const agent = snapshot.agents.find((candidate) => candidate.threadId && candidate.threadId === event.threadId);
            if (!agent) {
              continue;
            }
            if (
              !agent.isCurrent
              && agent.state !== "waiting"
              && agent.state !== "blocked"
              && event.kind !== "message"
              && !(event.kind === "tool" && event.itemType === "webSearch")
            ) {
              continue;
            }
            const key = agentKey(snapshot.projectRoot, agent);
            const semanticSubjectKey = notificationSubjectKey(snapshot.projectRoot, agent, event.threadId);
            const notificationId = notificationInstanceId(
              snapshot.projectRoot,
              semanticSubjectKey,
              descriptor,
              typedNotificationKey(event) || ("event::" + event.id)
            );
            if (seenNotificationKeys.has(notificationId)) {
              continue;
            }
            enqueueNotification({
              id: notificationId,
              key,
              projectRoot: snapshot.projectRoot,
              semanticKey: notificationSemanticKey(snapshot.projectRoot, semanticSubjectKey, descriptor),
              kindClass: descriptor.kindClass,
              label: descriptor.label,
              title: descriptor.title,
              labelIconUrl: descriptor.labelIconUrl,
              imageUrl: descriptor.imageUrl,
              anchor: descriptor.anchor,
              isFileChange: descriptor.isFileChange,
              isCommand: descriptor.isCommand,
              priority: notificationPriorityValue(descriptor),
              linesAdded: descriptor.linesAdded,
              linesRemoved: descriptor.linesRemoved
            });
            seenNotificationKeys.add(notificationId);
          }
        }

        scheduleNotificationPrune();
      }

      function pruneNotifications() {
        const now = Date.now();
        notifications = notifications.filter((entry) => now < notificationExpiresAt(entry));
        trimRecentNotificationTimes(now);
        scheduleNotificationPrune();
        renderNotifications();
      }

      function renderNotifications() {
        const wrappers = document.querySelectorAll("[data-scene-fit]");
        wrappers.forEach((wrapper) => {
          const layer = wrapper.querySelector("[data-scene-notifications]");
          if (!(wrapper instanceof HTMLElement) || !(layer instanceof HTMLElement)) {
            return;
          }

          const wrapperRect = wrapper.getBoundingClientRect();
          const selectedProject = state.selected === "all" ? null : state.selected;
          const visible = notifications.filter((entry) => {
            if (selectedProject) {
              return entry.projectRoot === selectedProject;
            }
            return true;
          });
          const stackByKey = new Map();
          const renderedIds = new Set();

          visible.forEach((entry) => {
            let anchor = wrapper.querySelector(
              entry.anchor === "workstation"
                ? \`[data-workstation-key="\${CSS.escape(entry.key)}"]\`
                : \`[data-agent-key="\${CSS.escape(entry.key)}"]\`
            );
            if (!(anchor instanceof HTMLElement) && entry.anchor === "workstation") {
              anchor = wrapper.querySelector(\`[data-agent-key="\${CSS.escape(entry.key)}"]\`);
            }
            if (!(anchor instanceof HTMLElement)) {
              return;
            }
            const stackIndex = stackByKey.get(entry.key) ?? 0;
            stackByKey.set(entry.key, stackIndex + 1);
            const rect = anchor.getBoundingClientRect();
            const computedLeft = rect.left - wrapperRect.left + rect.width / 2;
            const computedTop = entry.anchor === "workstation"
              ? rect.top - wrapperRect.top + rect.height * 0.72 - stackIndex * 20
              : rect.top - wrapperRect.top - stackIndex * (entry.isCommand ? 28 : 18);
            if (!Number.isFinite(entry.originLeft) || !Number.isFinite(entry.originTop)) {
              entry.originLeft = computedLeft;
              entry.originTop = computedTop;
            }
            const left = entry.originLeft;
            const top = entry.originTop;
            const line = notificationLine(entry);
            if (entry.isCommand && isSuppressedCommandToastTitle(line.title)) {
              return;
            }
            renderedIds.add(entry.id);
            let toast = layer.querySelector(\`[data-toast-id="\${CSS.escape(entry.id)}"]\`);
            if (!(toast instanceof HTMLElement)) {
              toast = document.createElement("div");
              toast.dataset.toastId = entry.id;
              layer.appendChild(toast);
            }

            const className = \`agent-toast \${entry.kindClass}\${entry.imageUrl ? " image" : ""}\${entry.isFileChange ? " file-change" : ""}\${entry.isCommand ? " command-window" : ""}\${!entry.isCommand && Number(entry.priority) >= NOTIFICATION_PRIORITY_MESSAGE ? " message-toast" : ""}\`;
            if (toast.className !== className) {
              toast.className = className;
            }

            const nextStyle = \`left:\${Math.round(left)}px; top:\${Math.round(top)}px;\`;
            if (toast.getAttribute("style") !== nextStyle) {
              toast.setAttribute("style", nextStyle);
            }
            if (!entry.isCommand) {
              const nextAnimationDelay = toastAnimationDelay(entry);
              if (toast.style.animationDelay !== nextAnimationDelay) {
                toast.style.animationDelay = nextAnimationDelay;
              }
            }

            const statsHtml =
              line.linesAdded !== null || line.linesRemoved !== null
                ? \`<div class="agent-toast-stats">\${line.linesAdded !== null ? \`<span class="agent-toast-delta add">+\${line.linesAdded}</span>\` : ""}\${line.linesRemoved !== null ? \`<span class="agent-toast-delta remove">-\${line.linesRemoved}</span>\` : ""}</div>\`
                : "";
            const commandLinesHtml = line.commandLines.map((commandLine, index) =>
              \`<div class="agent-toast-command-line"><span class="agent-toast-command-prefix">&gt; </span>\${escapeHtml(commandLine)}\${index === line.commandLines.length - 1 ? \`<span class="agent-toast-command-cursor">_</span>\` : ""}</div>\`
            ).join("");
            const toastLinesHtml = line.toastLines.map((toastLine) =>
              \`<div class="agent-toast-line">\${escapeHtml(toastLine)}</div>\`
            ).join("");
            const nextHtml = entry.isCommand
              ? \`<div class="agent-toast-window-bar"><div class="agent-toast-window-label">cmd.exe</div><div class="agent-toast-window-lights"><span></span><span></span><span></span></div></div><div class="agent-toast-window-body"><pre class="agent-toast-command">\${commandLinesHtml}</pre></div>\`
              : \`<div class="agent-toast-copy"><div class="agent-toast-head">\${line.labelIconUrl || line.label ? \`<div class="agent-toast-label-group">\${line.labelIconUrl ? \`<img class="agent-toast-label-icon" src="\${escapeHtml(line.labelIconUrl)}" alt="" />\` : ""}\${line.label ? \`<div class="agent-toast-label">\${escapeHtml(line.label)}</div>\` : ""}</div>\` : ""}<div class="\${line.toastLines.length > 1 ? "agent-toast-lines" : "agent-toast-title"}">\${line.toastLines.length > 1 ? toastLinesHtml : escapeHtml(line.title)}</div></div>\${statsHtml}</div>\${entry.imageUrl ? \`<img class="agent-toast-preview" src="\${escapeHtml(entry.imageUrl)}" alt="\${escapeHtml(entry.title)}" />\` : ""}\`;
            if (toast.dataset.renderHtml !== nextHtml) {
              toast.innerHTML = nextHtml;
              toast.dataset.renderHtml = nextHtml;
            }
          });

          layer.querySelectorAll("[data-toast-id]").forEach((node) => {
            if (!(node instanceof HTMLElement)) {
              return;
            }
            if (!renderedIds.has(node.dataset.toastId || "")) {
              node.remove();
            }
          });
        });
      }

      function scheduleNotificationPrune() {
        if (notificationPruneTimer) {
          clearTimeout(notificationPruneTimer);
          notificationPruneTimer = null;
        }
        if (screenshotMode || notifications.length === 0) {
          return;
        }
        const now = Date.now();
        const nextExpiry = Math.min(...notifications.map((entry) => notificationExpiresAt(entry)));
        const delay = Math.max(60, nextExpiry - now);
        notificationPruneTimer = setTimeout(() => {
          notificationPruneTimer = null;
          pruneNotifications();
        }, delay);
      }

      function renderAgentHover(snapshot, agent, options = {}) {
        const lead = parentLabelFor(snapshot, agent);
        const summary = agentHoverSummary(snapshot, agent);
        const hoverTitle = agent.nickname || agent.label;
        const meta = [
          titleCaseWords(agentKindLabel(snapshot, agent)),
          agentHoverSourceLabel(agent, summary.source),
          lead ? \`with \${lead}\` : "",
          formatUpdatedAt(agent.updatedAt)
        ].filter(Boolean).join(" · ");
        const className = options.className || "agent-hover";
        const styleAttr = options.style ? \` style="\${escapeHtml(options.style)}"\` : "";
        const summaryClass = summary.source === "user"
          ? "agent-hover-summary agent-hover-summary-user"
          : "agent-hover-summary";

        return \`<div class="\${escapeHtml(className)}"\${styleAttr}><div class="agent-hover-title"><strong>\${escapeHtml(hoverTitle)}</strong></div><div class="\${escapeHtml(summaryClass)}">\${escapeHtml(summary.text)}</div><div class="agent-hover-meta">\${escapeHtml(meta)}</div></div>\`;
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

      function renderSprite(sprite, x, y, scale, className, extraStyle = "", title = "", options = {}) {
        const width = Math.round(sprite.w * scale);
        const height = Math.round(sprite.h * scale);
        const style = [
          \`left:\${Math.round(x)}px\`,
          \`top:\${Math.round(y)}px\`,
          \`width:\${width}px\`,
          \`height:\${height}px\`,
          \`background-image:url(\${sprite.url})\`,
          extraStyle
        ].filter(Boolean).join(";");
        const titleAttr = title ? \` title="\${escapeHtml(title)}"\` : "";
        return \`<div class="\${className}"\${titleAttr} style="\${style}"></div>\`;
      }

      function renderWorkstationComputer(snapshot, agent, sprite, x, y, scale, mirrored) {
        const width = Math.round(sprite.w * scale);
        const height = Math.round(sprite.h * scale);
        const key = agent ? agentKey(snapshot.projectRoot, agent) : "";
        const wrapperStyle = [
          \`left:\${Math.round(x)}px\`,
          \`top:\${Math.round(y)}px\`,
          \`width:\${width}px\`,
          \`height:\${height}px\`,
          "z-index:5;"
        ].join(";");
        const spriteStyle = mirrored ? "transform:scaleX(-1);transform-origin:50% 50%;" : "";
        const computerHtml = renderSprite(sprite, 0, 0, scale, "office-sprite workstation-computer-sprite", spriteStyle);
        return \`<div class="workstation-computer" data-workstation-computer="\${escapeHtml(key)}" style="\${wrapperStyle}">\${computerHtml}</div>\`;
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

      function computerSpriteForAgent(agent, mirrored) {
        return pixelOffice.props.workstation;
      }

      function buildLeadClusters(occupants) {
        const ordered = [...occupants].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
            if (agent.isCurrent) {
              return false;
            }
            return agent.state === "idle" || agent.state === "done" || isRecentLeadCandidate(agent);
          })
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      }

      function loungeMetaLabel(waitingCount, restingCount) {
        const parts = [];
        if (waitingCount > 0) {
          parts.push(\`\${waitingCount} waiting\`);
        }
        if (restingCount > 0) {
          parts.push(\`\${restingCount} resting\`);
        }
        return parts.length > 0 ? parts.join(" · ") : "no breaks";
      }

      function loungeSlotAt(index, compact, recRoomWidth) {
        const slots = compact
          ? [
              { x: 16, y: 34, flip: false, bubble: "zz", settle: true },
              { x: 38, y: 34, flip: true, bubble: null, settle: true },
              { x: 84, y: 40, flip: false, bubble: "sip", settle: false },
              { x: 116, y: 34, flip: true, bubble: "sip", settle: false },
              { x: recRoomWidth - 56, y: 38, flip: true, bubble: null, settle: false }
            ]
          : [
              { x: 22, y: 48, flip: false, bubble: "zz", settle: true },
              { x: 50, y: 48, flip: true, bubble: null, settle: true },
              { x: 116, y: 54, flip: false, bubble: "sip", settle: false },
              { x: 156, y: 48, flip: true, bubble: "sip", settle: false },
              { x: recRoomWidth - 60, y: 50, flip: true, bubble: null, settle: false },
              { x: 88, y: 70, flip: stableHash(index) % 2 === 0, bubble: null, settle: false }
            ];
        return slots[index % slots.length];
      }

      function renderBlockedMarker(x, y) {
        return \`<img class="avatar-status-marker blocked" src="/assets/pixel-office/sprites/icons/state/blocked.svg" alt="" style="left:\${Math.round(x)}px; top:\${Math.round(y)}px;" />\`;
      }

      function chairSpriteForAgent(agent) {
        return pixelOffice.chairs[stableHash(agent.id) % pixelOffice.chairs.length];
      }

      function renderAvatarShell(snapshot, agent, state, shellStyle, avatarStyle, mode) {
        return \`<div class="\${motionShellClass(mode)}" style="\${shellStyle}"><div class="office-avatar state-\${state}" data-agent-key="\${escapeHtml(agentKey(snapshot.projectRoot, agent))}" data-agent-id="\${escapeHtml(agent.id)}" data-project-root="\${escapeHtml(snapshot.projectRoot)}" style="\${avatarStyle}"></div></div>\`;
      }

      function renderCubicleCell(snapshot, agent, role, x, y, boothWidth, boothHeight, compact, options = {}) {
        const state = agent?.state || "idle";
        const motionMode = options.motionMode || null;
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
        const deskY = Math.round(boothHeight - deskHeight - (compact ? 11 : 13));
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
            return {
              x: seatedX,
              y: Math.max(0, baseY - (compact ? 1 : 3)),
              flip: workstationFlip
            };
          }
          if (state === "running" || state === "validating" || state === "blocked") {
            const workingX = mirrored
              ? clampAvatarX(sideX + (compact ? 4 : 6))
              : clampAvatarX(sideX - (compact ? 4 : 6));
            return {
              x: workingX,
              y: baseY,
              flip: workstationFlip
            };
          }
          if (state === "idle" || state === "done") {
            return {
              x: Math.max(2, Math.round(centerX - avatarWidth / 2)),
              y: Math.max(0, baseY + (compact ? 1 : 2)),
              flip: stableHash(agent.id) % 2 === 0
            };
          }
          return {
            x: sideX,
            y: baseY,
            flip: workstationFlip
          };
        })();
        const bubbleClass = state === "blocked" ? "speech-bubble blocked"
          : state === "waiting" ? "speech-bubble waiting"
          : "speech-bubble";
        const bubbleLabel = !agent ? null
          : state === "waiting" ? "..."
          : state === "cloud" ? "cloud"
          : state === "validating" ? "ok"
          : null;
        const bubble = bubbleLabel && !motionMode
          ? \`<div class="\${bubbleClass}" style="left:\${Math.round((avatarPose?.x || 0) + avatarWidth / 2)}px; top:\${Math.max(0, Math.round((avatarPose?.y || 0) - 12))}px;">\${escapeHtml(bubbleLabel)}</div>\`
          : "";
        const blockedMarker = agent && avatarPose && state === "blocked" && agent.isCurrent && !motionMode
          ? renderBlockedMarker(
            (avatarPose.x || 0) + avatarWidth / 2 - (compact ? 8 : 9),
            Math.max(0, (avatarPose.y || 0) - (compact ? 19 : 21))
          )
          : "";
        const avatarStyle = avatar && agent && avatarPose
          ? [
            \`background-image:url(\${avatar.url})\`,
            \`--appearance-body:\${agent.appearance.body}\`,
            \`--appearance-shadow:\${agent.appearance.shadow}\`
          ].filter(Boolean).join(";")
          : "";
        const monitorClass = agent && isBusyAgent(agent) && state !== "waiting" && state !== "blocked"
          ? "booth-monitor state-active"
          : "booth-monitor";

        const screenGlow = monitorClass.includes("state-active")
          ? \`<div style="position:absolute;left:\${Math.round(workstationX + workstationWidth * 0.19)}px;top:\${Math.round(workstationY + workstationHeight * 0.14)}px;width:\${Math.max(8, Math.round(workstationWidth * 0.36))}px;height:\${Math.max(5, Math.round(workstationHeight * 0.16))}px;background:rgba(75,214,159,0.3);box-shadow:0 0 10px rgba(75,214,159,0.28);pointer-events:none;z-index:7;"></div>\`
          : "";
        const absoluteCellX = Math.round(options.absoluteX ?? x);
        const absoluteCellY = Math.round(options.absoluteY ?? y);
        const avatarTargetX = avatarPose ? absoluteCellX + Math.round(avatarPose.x) : null;
        const avatarTargetY = avatarPose ? absoluteCellY + Math.round(avatarPose.y) : null;
        const entrance = options.entrance || null;
        const enteringMotion = avatarPose && motionMode === "entering"
          ? enteringMotionState(snapshot, agent, entrance, avatarTargetX, avatarTargetY, avatarWidth, avatarHeight)
          : null;
        const resolvedMotionMode = enteringMotion ? enteringMotion.mode : motionMode;
        const path = avatarPose
          ? (
            motionMode === "departing" && entrance
              ? agentPathDelta(entrance, avatarTargetX, avatarTargetY, avatarWidth, avatarHeight)
              : enteringMotion
                ? enteringMotion.path
                : { pathX: 0, pathY: 0 }
          )
          : { pathX: 0, pathY: 0 };
        const shellStyle = avatar && agent && avatarPose
          ? [
            \`left:\${Math.round(avatarPose.x)}px\`,
            \`top:\${Math.round(avatarPose.y)}px\`,
            \`width:\${Math.round(avatarWidth)}px\`,
            \`height:\${Math.round(avatarHeight)}px\`,
            \`--avatar-flip:\${avatarPose.flip ? -1 : 1}\`,
            \`--path-x:\${Math.round(path.pathX)}px\`,
            \`--path-y:\${Math.round(path.pathY)}px\`
          ].join(";")
          : "";
        const avatarHtml = avatar && agent && avatarPose
          ? renderAvatarShell(snapshot, agent, state, shellStyle, avatarStyle, resolvedMotionMode)
          : "";
        if (agent && avatar && avatarPose && entrance && motionMode !== "departing") {
          rememberAgentSceneState(snapshot, agent, {
            roomId: options.roomId || agent.roomId,
            slotId: options.slotId || null,
            compact,
            kind: "desk",
            cellX: absoluteCellX,
            cellY: absoluteCellY,
            cellWidth: boothWidth,
            cellHeight: boothHeight,
            mirrored,
            lead: Boolean(options.lead),
            role,
            entrance,
            avatarX: avatarTargetX,
            avatarY: avatarTargetY,
            avatarWidth: Math.round(avatarWidth),
            avatarHeight: Math.round(avatarHeight),
            avatarFlip: avatarPose.flip ? -1 : 1
          });
        }
        const deskShell = [
          renderSprite(deskSprite, deskX, deskY, deskScale, "office-sprite", \`z-index:3;\${mirrored ? "transform:scaleX(-1);transform-origin:50% 50%;" : ""}\`),
          renderSprite(chair, chairX, chairY, chairScale, "office-sprite", \`z-index:4;\${mirrored ? "transform:scaleX(-1);transform-origin:50% 50%;" : ""}\`),
          renderWorkstationComputer(snapshot, agent, computerSprite, workstationX, workstationY, workstationScale, mirrored),
          screenGlow
        ].join("");
        const hoverHtml = agent ? renderAgentHover(snapshot, agent) : "";
        const tabIndex = agent ? "0" : "-1";
        const cellClasses = ["cubicle-cell"];
        if (resolvedMotionMode) cellClasses.push(resolvedMotionMode);
        return \`<div class="\${cellClasses.join(" ")}" tabindex="\${tabIndex}"\${focusWrapperAttrs(snapshot, agent)} style="left:\${Math.round(x)}px; top:\${Math.round(y)}px; width:\${boothWidth}px; height:\${boothHeight}px;"><div class="desk-shell"\${agent ? \` data-workstation-key="\${escapeHtml(agentKey(snapshot.projectRoot, agent))}"\` : ""}>\${deskShell}</div>\${avatarHtml}\${blockedMarker}\${bubble}\${hoverHtml}</div>\`;
      }

      function renderDeskPod(snapshot, agents, role, x, y, podWidth, podHeight, compact, options = {}) {
        const padX = compact ? 8 : 10;
        const centerGap = 0;
        const cellWidth = Math.max(compact ? 44 : 58, Math.floor((podWidth - padX * 2 - centerGap) / 2));
        const classes = ["booth"];
        if (options.lead) classes.push("lead");
        const stackOrder = 100 + Math.round(y + podHeight);
        const leftAgent = agents[0] || null;
        const rightAgent = agents[1] || null;
        const hasBothSides = Boolean(leftAgent && rightAgent);
        const singleCellX = Math.round((podWidth - cellWidth) / 2);
        const podBase = [];
        const cells = [
          leftAgent
            ? renderCubicleCell(
              snapshot,
              leftAgent,
              role,
              hasBothSides ? padX : singleCellX,
              0,
              cellWidth,
              podHeight,
              compact,
              {
                ...options,
                sharedCenter: hasBothSides,
                mirrored: false,
                lead: options.lead && Boolean(leftAgent),
                absoluteX: x + (hasBothSides ? padX : singleCellX),
                absoluteY: y,
                motionMode: options.liveOnly && enteringAgentKeys.has(agentKey(snapshot.projectRoot, leftAgent)) ? "entering" : null,
                slotId: options.leftSlotId || (hasBothSides ? null : options.slotId || null)
              }
            )
            : "",
          rightAgent
            ? renderCubicleCell(
              snapshot,
              rightAgent,
              role,
              hasBothSides ? padX + cellWidth + centerGap : singleCellX,
              0,
              cellWidth,
              podHeight,
              compact,
              {
                ...options,
                sharedCenter: hasBothSides,
                mirrored: true,
                lead: false,
                absoluteX: x + (hasBothSides ? padX + cellWidth + centerGap : singleCellX),
                absoluteY: y,
                motionMode: options.liveOnly && enteringAgentKeys.has(agentKey(snapshot.projectRoot, rightAgent)) ? "entering" : null,
                slotId: options.rightSlotId || null
              }
            )
            : ""
        ].join("");
        return \`<div class="\${classes.join(" ")}" style="left:\${Math.round(x)}px; top:\${Math.round(y)}px; width:\${podWidth}px; height:\${podHeight}px; --booth-accent:\${roleTone(role)}; --stack-order:\${stackOrder};">\${podBase.join("")}\${cells}</div>\`;
      }

      function renderBossOffice(snapshot, agent, x, y, officeWidth, officeHeight, compact, options = {}) {
        const role = agentRole(agent);
        const innerPadX = compact ? 12 : 14;
        const cellWidth = compact ? 76 : 94;
        const cellX = Math.max(innerPadX, officeWidth - cellWidth - innerPadX);
        const cellY = 0;
        const stackOrder = 110 + Math.round(y + officeHeight);
        const badgeLabel = liveChildAgentsFor(snapshot, agent.id).length + " spawned";
        const officeCell = renderCubicleCell(
          snapshot,
          agent,
          role,
          cellX,
          cellY,
          cellWidth,
          officeHeight,
          compact,
          {
            liveOnly: options.liveOnly,
            roomId: options.roomId,
            entrance: options.entrance,
            mirrored: false,
            absoluteX: x + cellX,
            absoluteY: y + cellY,
            motionMode: options.motionMode || (options.liveOnly && enteringAgentKeys.has(agentKey(snapshot.projectRoot, agent)) ? "entering" : null),
            slotId: options.slotId
          }
        );
        return \`<div class="boss-office" style="left:\${Math.round(x)}px; top:\${Math.round(y)}px; width:\${officeWidth}px; height:\${officeHeight}px; --office-tone:\${roleTone(role)}; --stack-order:\${stackOrder};"><div class="boss-office-badge">\${escapeHtml(badgeLabel)}</div>\${officeCell}</div>\`;
      }

      function renderCubicleRow(snapshot, agents, role, x, y, rowWidth, rowHeight, compact, options = {}) {
        const columns = Math.max(1, options.slots || agents.length);
        const padX = compact ? 6 : 8;
        const dividerGap = compact ? 10 : 14;
        const cellWidth = Math.max(compact ? 42 : 56, Math.floor((rowWidth - padX * 2 - dividerGap * (columns - 1)) / columns));
        const classes = ["booth"];
        if (options.lead) classes.push("lead");
        const stackOrder = 100 + Math.round(y + rowHeight);
        const rowBase = [];
        const mirrored = options.mirrored ?? ((options.rowIndex || 0) % 2 === 1);
        const cells = agents.map((agent, index) => {
          const cellX = padX + index * (cellWidth + dividerGap);
          return renderCubicleCell(
            snapshot,
            agent,
            role,
            cellX,
            0,
            cellWidth,
            rowHeight,
            compact,
            {
              ...options,
              mirrored,
              absoluteX: x + cellX,
              absoluteY: y,
              motionMode: options.motionMode || (options.liveOnly && enteringAgentKeys.has(agentKey(snapshot.projectRoot, agent)) ? "entering" : null)
            }
          );
        }).join("");
        return \`<div class="\${classes.join(" ")}" style="left:\${Math.round(x)}px; top:\${Math.round(y)}px; width:\${rowWidth}px; height:\${rowHeight}px; --booth-accent:\${roleTone(role)}; --stack-order:\${stackOrder};">\${rowBase.join("")}\${cells}</div>\`;
      }

      function renderBooth(snapshot, agent, role, x, y, boothWidth, boothHeight, compact, options = {}) {
        return renderCubicleRow(snapshot, [agent], role, x, y, boothWidth, boothHeight, compact, options);
      }

      function renderWaitingAvatar(snapshot, agent, x, y, compact) {
        const avatar = avatarForAgent(agent);
        const avatarScale = compact ? 1.25 : 1.5;
        const avatarWidth = avatar.w * avatarScale;
        const avatarHeight = avatar.h * avatarScale;
        const avatarStyle = [
          "left:0",
          "top:0",
          \`width:\${Math.round(avatarWidth)}px\`,
          \`height:\${Math.round(avatarHeight)}px\`,
          \`background-image:url(\${avatar.url})\`,
          \`--appearance-body:\${agent.appearance.body}\`,
          \`--appearance-shadow:\${agent.appearance.shadow}\`
        ].join(";");
        return \`<div class="waiting-agent" tabindex="0"\${focusWrapperAttrs(snapshot, agent)} style="left:\${Math.round(x)}px; top:\${Math.round(y)}px;"><div class="office-avatar state-waiting" data-agent-key="\${escapeHtml(agentKey(snapshot.projectRoot, agent))}" style="\${avatarStyle}"></div><div class="speech-bubble waiting" style="left:\${Math.round(avatarWidth / 2)}px; top:-10px;">...</div>\${renderAgentHover(snapshot, agent).replace("agent-hover", "waiting-hover")}</div>\`;
      }

      function renderRestingAvatar(snapshot, agent, index, compact, recRoomWidth) {
        const avatar = avatarForAgent(agent);
        const avatarScale = compact ? 1.25 : 1.5;
        const avatarWidth = avatar.w * avatarScale;
        const avatarHeight = avatar.h * avatarScale;
        const slot = loungeSlotAt(index, compact, recRoomWidth);
        const transforms = [];
        if (slot.settle) {
          transforms.push("translateY(3px)");
        }
        if (slot.flip) {
          transforms.push("scaleX(-1)");
        }
        const avatarStyle = [
          "left:0",
          "top:0",
          \`width:\${Math.round(avatarWidth)}px\`,
          \`height:\${Math.round(avatarHeight)}px\`,
          \`background-image:url(\${avatar.url})\`,
          \`--appearance-body:\${agent.appearance.body}\`,
          \`--appearance-shadow:\${agent.appearance.shadow}\`,
          transforms.length > 0 ? \`transform:\${transforms.join(" ")}\` : ""
        ].filter(Boolean).join(";");
        const bubble = slot.bubble
          ? \`<div class="speech-bubble resting" style="left:\${Math.round(avatarWidth / 2)}px; top:-10px;">\${escapeHtml(slot.bubble)}</div>\`
          : "";
        return \`<div class="lounge-agent" tabindex="0"\${focusWrapperAttrs(snapshot, agent)} style="left:\${Math.round(slot.x)}px; top:\${Math.round(slot.y)}px;"><div class="office-avatar state-\${agent.state}" data-agent-key="\${escapeHtml(agentKey(snapshot.projectRoot, agent))}" style="\${avatarStyle}"></div>\${bubble}\${renderAgentHover(snapshot, agent).replace("agent-hover", "lounge-hover")}</div>\`;
      }

      function renderWallsideAvatar(snapshot, agent, x, y, compact, options = {}) {
        const motionMode = options.motionMode || null;
        const avatar = avatarForAgent(agent);
        const avatarScale = compact ? 1.25 : 1.5;
        const avatarWidth = avatar.w * avatarScale;
        const avatarHeight = avatar.h * avatarScale;
        const dormant = isDormantRestingAgent(agent);
        const visualState = !agent.isCurrent && agent.state !== "waiting" && agent.state !== "blocked"
          ? (agent.state === "done" || dormant ? "done" : "idle")
          : agent.state;
        const settled = Boolean(options.settle) || dormant;
        const avatarStyle = [
          \`background-image:url(\${avatar.url})\`,
          \`--appearance-body:\${agent.appearance.body}\`,
          \`--appearance-shadow:\${agent.appearance.shadow}\`
        ].filter(Boolean).join(";");
        const targetX = Math.round(x);
        const targetY = Math.round(y + (settled ? 3 : 0));
        const entrance = options.entrance || null;
        const enteringMotion = motionMode === "entering"
          ? enteringMotionState(snapshot, agent, entrance, targetX, targetY, avatarWidth, avatarHeight)
          : null;
        const resolvedMotionMode = enteringMotion ? enteringMotion.mode : motionMode;
        const path = motionMode === "departing" && entrance
          ? agentPathDelta(entrance, targetX, targetY, avatarWidth, avatarHeight)
          : enteringMotion
            ? enteringMotion.path
            : { pathX: 0, pathY: 0 };
        const shellStyle = [
          "left:0",
          "top:0",
          \`width:\${Math.round(avatarWidth)}px\`,
          \`height:\${Math.round(avatarHeight)}px\`,
          \`--avatar-flip:\${options.flip ? -1 : 1}\`,
          \`--path-x:\${Math.round(path.pathX)}px\`,
          \`--path-y:\${Math.round(path.pathY)}px\`
        ].join(";");
        const bubbleLabel = options.bubble ?? (
          visualState === "waiting" ? "..."
          : dormant ? "zZ"
          : visualState === "idle" ? "ok"
          : null
        );
        const bubbleClass = bubbleLabel === "..."
          ? "speech-bubble waiting"
          : bubbleLabel
            ? "speech-bubble resting"
            : "";
        const bubble = bubbleLabel && !resolvedMotionMode
          ? \`<div class="\${bubbleClass}" style="left:\${Math.round(avatarWidth / 2)}px; top:-10px;">\${escapeHtml(bubbleLabel)}</div>\`
          : "";
        const blockedMarker = visualState === "blocked" && agent.isCurrent && !resolvedMotionMode
          ? renderBlockedMarker(avatarWidth / 2 - (compact ? 8 : 9), compact ? -18 : -20)
          : "";
        const hoverClass = visualState === "waiting" ? "waiting-hover" : "lounge-hover";
        const wrapperClass = visualState === "waiting" ? "waiting-agent" : "lounge-agent";
        if (motionMode !== "departing") {
          rememberAgentSceneState(snapshot, agent, {
            roomId: options.roomId || agent.roomId,
            compact,
            kind: "wallside",
            x: targetX,
            y: targetY,
            entrance,
            bubble: options.bubble ?? null,
            flip: options.flip ? -1 : 1,
            settle: settled,
            avatarWidth: Math.round(avatarWidth),
            avatarHeight: Math.round(avatarHeight)
          });
        }
        return \`<div class="\${wrapperClass}\${resolvedMotionMode ? \` \${resolvedMotionMode}\` : ""}" tabindex="0"\${focusWrapperAttrs(snapshot, agent)} style="left:\${Math.round(x)}px; top:\${Math.round(y)}px;">\${renderAvatarShell(snapshot, agent, visualState, shellStyle, avatarStyle, resolvedMotionMode)}\${blockedMarker}\${bubble}\${renderAgentHover(snapshot, agent).replace("agent-hover", hoverClass)}</div>\`;
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

      function wallsideRestingSlotAt(index, compact, roomPixelWidth, walkwayY) {
        const columns = compact ? 4 : 5;
        const column = index % columns;
        const row = Math.floor(index / columns);
        const maxX = roomPixelWidth - (compact ? 72 : 94);
        const stepX = compact ? 24 : 30;
        const stepY = compact ? 14 : 17;
        const startX = Math.max(compact ? 186 : 236, maxX - (columns - 1) * stepX);
        return {
          x: startX + column * stepX,
          y: walkwayY + (compact ? 2 : 4) + row * stepY + (column % 2 === 0 ? 1 : 3),
          flip: column % 2 === 0,
          settle: row === 0 && column % 3 === 0
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

      function renderRoomEntranceDecor(roomPixelWidth, compact, options = {}) {
        const entrance = roomEntranceLayout(roomPixelWidth, compact);
        const plantScale = compact ? 1.08 : 1.22;
        const sprites = [
          renderSprite(pixelOffice.props.boothDoor, entrance.centerDoorX, entrance.centerDoorY, entrance.doorScale, "office-sprite", "z-index:2;"),
          renderSprite(pixelOffice.props.boothDoor, Math.round(roomPixelWidth / 2), entrance.centerDoorY, entrance.doorScale, "office-sprite", "z-index:2; transform:scaleX(-1); transform-origin:50% 50%;")
        ];
        if (options.clock !== false) {
          sprites.push(
            renderSprite(pixelOffice.props.clock, Math.round(roomPixelWidth / 2 - pixelOffice.props.clock.w * entrance.clockScale / 2), compact ? 12 : 14, entrance.clockScale, "office-sprite", "z-index:3;")
          );
        }
        if (options.plants) {
          sprites.push(
            renderSprite(pixelOffice.props.plant, entrance.centerDoorX - (compact ? 24 : 28), compact ? 48 : 60, plantScale, "office-sprite", "z-index:3;"),
            renderSprite(pixelOffice.props.plant, Math.round(roomPixelWidth / 2 + pixelOffice.props.boothDoor.w * entrance.doorScale + (compact ? 6 : 8)), compact ? 48 : 60, plantScale, "office-sprite", "z-index:3;")
          );
        }
        return {
          entrance,
          html: sprites.join("")
        };
      }

      function renderIntegratedRecArea(snapshot, primaryRoomId, waitingAgents, restingAgents, compact, roomPixelWidth) {
        const sofaScale = compact ? 1.18 : 1.42;
        const shelfScale = compact ? 0.96 : 1.12;
        const coolerScale = compact ? 1.18 : 1.36;
        const vendingScale = compact ? 1.02 : 1.16;
        const counterScale = compact ? 0.88 : 1.02;
        const baseY = compact ? 42 : 54;
        const walkwayY = compact ? 62 : 78;
        const entranceDecor = renderRoomEntranceDecor(roomPixelWidth, compact, { plants: true });
        const facilityHtml = [
          entranceDecor.html,
          renderSprite(pixelOffice.props.vending, compact ? 10 : 14, baseY - (compact ? 2 : 4), vendingScale, "office-sprite", "z-index:3;"),
          renderSprite(pixelOffice.props.cooler, compact ? 38 : 48, baseY + (compact ? 8 : 10), coolerScale, "office-sprite", "z-index:3;"),
          renderSprite(pixelOffice.props.counter, compact ? 60 : 76, baseY + (compact ? 8 : 10), counterScale, "office-sprite", "z-index:3;"),
          renderSprite(pixelOffice.props.sofaOrange, roomPixelWidth - (compact ? 118 : 152), baseY + (compact ? 8 : 10), sofaScale, "office-sprite", "z-index:3;"),
          renderSprite(pixelOffice.props.bookshelf, roomPixelWidth - (compact ? 34 : 40), baseY - (compact ? 2 : 4), shelfScale, "office-sprite", "z-index:3;")
        ];
        const agentHtml = [
          ...waitingAgents.map((agent, index) => {
            const slot = wallsideWaitingSlotAt(index, compact, roomPixelWidth, walkwayY);
            return renderWallsideAvatar(snapshot, agent, slot.x, slot.y, compact, { flip: slot.flip, bubble: "...", entrance: entranceDecor.entrance, roomId: primaryRoomId, motionMode: enteringAgentKeys.has(agentKey(snapshot.projectRoot, agent)) ? "entering" : null });
          }),
          ...restingAgents.map((agent, index) => {
            const slot = wallsideRestingSlotAt(index, compact, roomPixelWidth, walkwayY);
            return renderWallsideAvatar(snapshot, agent, slot.x, slot.y, compact, { flip: slot.flip, settle: slot.settle, entrance: entranceDecor.entrance, roomId: primaryRoomId, motionMode: enteringAgentKeys.has(agentKey(snapshot.projectRoot, agent)) ? "entering" : null });
          })
        ];
        return facilityHtml.join("") + agentHtml.join("");
      }

      function renderRoomScene(snapshot, options = {}) {
        const sceneRooms = buildSceneRooms(snapshot.rooms.rooms);
        const rooms = sceneRooms.visibleRooms;
        if (rooms.length === 0) {
          return '<div class="empty">No rooms configured.</div>';
        }

        const compact = options.compact === true;
        const focusMode = options.focusMode === true;
        const showOverlayLabels = options.showOverlayLabels === true;
        const tile = compact ? 18 : 24;
        const baseMaxX = Math.max(...rooms.map((room) => room.x + room.width), 24);
        const maxY = Math.max(...rooms.map((room) => room.y + room.height), 16);
        const waitingAgents = snapshot.agents.filter((agent) => agent.state === "waiting" && agent.source !== "cloud");
        const restingAgents = restingAgentsFor(snapshot, compact);
        const offDeskAgentIds = new Set([...waitingAgents, ...restingAgents].map((agent) => agent.id));
        const sceneWidth = baseMaxX * tile;

        const html = rooms.map((room) => {
          const isPrimaryRoom = room.id === sceneRooms.primaryRoomId;
          const roomAgentId = (agent) => sceneRooms.roomAlias.get(agent.roomId) || (agent.source === "cloud" ? "cloud" : sceneRooms.primaryRoomId);
          const occupants = snapshot.agents.filter(
            (agent) => roomAgentId(agent) === room.id
              && agent.source !== "cloud"
              && !offDeskAgentIds.has(agent.id)
          );
          const activeDeskOccupants = occupants.filter((agent) => agent.state !== "idle" && agent.state !== "done");
          const roomPixelWidth = room.width * tile;
          const roomPixelHeight = room.height * tile;
          const stageHeight = roomPixelHeight - 26;
          const entranceDecor = renderRoomEntranceDecor(roomPixelWidth, compact, { plants: isPrimaryRoom });
          const recAreaHtml = isPrimaryRoom
            ? renderIntegratedRecArea(snapshot, room.id, waitingAgents, restingAgents, compact, roomPixelWidth)
            : "";
          const layoutConfig = fixedSceneLayoutConfig(compact);
          const boothHtml = [];
          const officeAgents = sortedBossOfficeAgents(
            snapshot,
            occupants.filter((agent) => isBossOfficeCandidate(snapshot, agent))
          );
          const deskAgents = occupants.filter((agent) => !isBossOfficeCandidate(snapshot, agent));
          const officeAssignments = assignAgentsToOfficeSlots(
            snapshot,
            officeAgents,
            buildBossOfficeSlots(layoutConfig, officeAgents.length)
          );
          const deskAssignments = assignAgentsToDeskSlots(
            snapshot,
            deskAgents,
            buildDeskSlots(layoutConfig, roomPixelWidth, Math.ceil(deskAgents.length / 2), officeAssignments.length > 0)
          );

          if (officeAssignments.length > 0) {
            const officeStripHeight = Math.max(...officeAssignments.map((entry) => entry.slot.y + entry.slot.height)) - layoutConfig.bossOfficeTopY;
            boothHtml.push(
              \`<div class="boss-office-strip" style="left:\${layoutConfig.bossLaneX}px; top:\${Math.max(26, layoutConfig.bossOfficeTopY - 10)}px; width:\${layoutConfig.bossLaneWidth}px; height:\${officeStripHeight + 20}px;"></div>\`
            );
          }

          const cubicleLabels = new Map();
          deskAssignments.forEach((entry) => {
            const role = agentRole(entry.agents[0]);
            const label = stationRoleLabel(role, entry.agents.length);
            if (!cubicleLabels.has(entry.slot.cubicleId)) {
              cubicleLabels.set(entry.slot.cubicleId, {
                x: entry.slot.x,
                y: entry.slot.y,
                role,
                label
              });
            }
            boothHtml.push(
              renderDeskPod(
                snapshot,
                entry.agents,
                role,
                entry.slot.x,
                entry.slot.y,
                entry.slot.width,
                entry.slot.height,
                compact,
                {
                  liveOnly: options.liveOnly,
                  roomId: room.id,
                  entrance: entranceDecor.entrance,
                  slotId: entry.slot.id,
                  leftSlotId: entry.slot.id,
                  rightSlotId: entry.slot.id
                }
              )
            );
          });

          officeAssignments.forEach((entry) => {
            boothHtml.push(
              renderBossOffice(
                snapshot,
                entry.agent,
                entry.slot.x,
                entry.slot.y,
                entry.slot.width,
                entry.slot.height,
                compact,
                {
                  liveOnly: options.liveOnly,
                  roomId: room.id,
                  entrance: entranceDecor.entrance,
                  slotId: entry.slot.id
                }
              )
            );
          });

          if (showOverlayLabels) {
            cubicleLabels.forEach((entry) => {
              boothHtml.push(
                \`<div class="station-tag" style="left:\${entry.x}px; top:\${Math.max(8, entry.y - (compact ? 18 : 22))}px; --station-tone:\${roleTone(entry.role)}; z-index:\${90 + Math.round(entry.y)};">\${escapeHtml(entry.label)}</div>\`
              );
            });
            if (officeAssignments.length > 0) {
              boothHtml.push(
                \`<div class="lead-banner" style="left:\${layoutConfig.bossLaneX}px; top:\${Math.max(8, layoutConfig.bossOfficeTopY - (compact ? 20 : 24))}px; border-color:#ffcf4d; z-index:120;">Boss Offices</div>\`
              );
            }
          }

          const ghosts = departingAgents.filter(
            (ghost) => ghost.projectRoot === snapshot.projectRoot
              && (sceneRooms.roomAlias.get(ghost.sceneState?.roomId || ghost.roomId) || sceneRooms.primaryRoomId) === room.id
              && ghost.expiresAt > Date.now()
          );
          ghosts.forEach((ghost, index) => {
            const sceneState = ghost.sceneState;
            if (!sceneState || sceneState.compact !== compact) {
              return;
            }
            if (sceneState.kind === "desk") {
              boothHtml.push(
                renderCubicleCell(
                  snapshot,
                  ghost.agent,
                  sceneState.role || agentRole(ghost.agent),
                  sceneState.cellX,
                  sceneState.cellY,
                  sceneState.cellWidth,
                  sceneState.cellHeight,
                  compact,
                  {
                    mirrored: sceneState.mirrored,
                    lead: sceneState.lead,
                    absoluteX: sceneState.cellX,
                    absoluteY: sceneState.cellY,
                    roomId: sceneState.roomId,
                    entrance: sceneState.entrance || entranceDecor.entrance,
                    motionMode: "departing"
                  }
                )
              );
              return;
            }
            if (sceneState.kind === "wallside") {
              boothHtml.push(
                renderWallsideAvatar(
                  snapshot,
                  ghost.agent,
                  sceneState.x,
                  sceneState.y - (sceneState.settle ? 3 : 0),
                  compact,
                  {
                    flip: sceneState.flip === -1,
                    settle: sceneState.settle,
                    bubble: sceneState.bubble,
                    roomId: sceneState.roomId,
                    entrance: sceneState.entrance || entranceDecor.entrance,
                    motionMode: "departing"
                  }
                )
              );
            }
          });

          const decor = [];
          if (!isPrimaryRoom) {
            decor.push(entranceDecor.html);
          }
          const calendarScale = compact ? 0.94 : 1.08;
          if (room.width >= 9 && !isPrimaryRoom) {
            decor.push(renderSprite(pixelOffice.props.calendar, roomPixelWidth - pixelOffice.props.calendar.w * calendarScale - 14, compact ? 12 : 16, calendarScale, "office-sprite", "z-index:2;"));
          }
          const relationshipLinesHtml = renderBossRelationshipLines(snapshot, room.id, roomPixelWidth, roomPixelHeight);

          const visibleRecOccupants = isPrimaryRoom ? waitingAgents.length + restingAgents.length : 0;
          const empty = occupants.length === 0 && visibleRecOccupants === 0
            ? (options.liveOnly
              ? '<div class="room-empty">No live agent activity here right now.</div>'
              : '<div class="room-empty">No mapped agent activity here yet.</div>')
            : "";
          const pathLabel = room.path && room.path !== "."
            ? \` <span class="muted">[\${escapeHtml(room.path)}]</span>\`
            : "";

          return \`<div class="room" style="left:\${room.x * tile}px; top:\${room.y * tile}px; width:\${roomPixelWidth}px; height:\${roomPixelHeight}px;"><div class="room-meta"><div class="room-head">\${escapeHtml(room.name)}\${pathLabel}</div><span class="muted">\${activeDeskOccupants.length} active agent\${activeDeskOccupants.length === 1 ? "" : "s"}</span></div><div class="room-stage"><div class="room-mural"></div><div class="room-floor"></div>\${decor.join("")}\${recAreaHtml}\${boothHtml.join("")}\${relationshipLinesHtml}\${empty}</div></div>\`;
        }).join("");

          const hint = options.showHint === false || focusMode
          ? ""
          : (options.liveOnly
            ? '<div class="muted">Showing live agents plus the 4 most recent lead sessions. Recent leads cool down in the rec area while live subagents stay on the floor.</div>'
            : '<div class="muted">Room shells come from the project XML, while booths are generated live from Codex sessions and grouped by parent session and subagent role.</div>');
        const sceneClass = compact ? "scene-grid compact" : "scene-grid";
        const sceneMode = focusMode ? "focus" : "default";

        return \`<div class="scene-shell" data-scene-shell="\${sceneMode}">\${hint}<div class="scene-fit \${compact ? "compact" : ""}" data-scene-fit data-scene-mode="\${sceneMode}" data-scene-fitted="\${focusMode ? "false" : "true"}"><div class="scene-notifications" data-scene-notifications></div><div class="\${sceneClass}" data-scene-grid style="width:\${sceneWidth}px; height:\${maxY * tile}px;">\${html}</div></div></div>\`;
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
        const title = escapeHtml(projectLabel(snapshot.projectRoot));
        const titleAttr = escapeHtml(snapshot.projectRoot);
        const summary = \`\${counts.total} agents · \${counts.active} active · \${counts.waiting} waiting · \${counts.blocked} blocked · \${counts.cloud} cloud\`;
        const notes = snapshot.notes.join(" | ");
        const body = state.view === "terminal"
          ? renderTerminalSnapshot(snapshot)
          : renderRoomScene(snapshot, {
            showHint: false,
            compact,
            liveOnly: state.activeOnly,
            focusMode: options.focusMode === true
          });
        const actionHtml = options.action
          ? \`<button class="tower-floor-open" data-action="\${escapeHtml(options.action.type)}"\${options.action.projectRoot ? \` data-project-root="\${escapeHtml(options.action.projectRoot)}"\` : ""}>\${escapeHtml(options.action.label)}</button>\`
          : "";
        return \`<section class="tower-floor\${compact ? " compact" : ""}" data-project-root="\${escapeHtml(snapshot.projectRoot)}"><div class="tower-floor-strip"><div class="tower-floor-label"><div class="tower-floor-title" title="\${titleAttr}">\${title}</div></div><div class="tower-floor-trailing"><div class="tower-floor-meta">\${escapeHtml(summary)}</div>\${actionHtml}</div></div><div class="tower-floor-body">\${notes ? \`<div class="tower-floor-note">\${escapeHtml(notes)}</div>\` : ""}\${body}</div></section>\`;
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
      }

      function renderSessions(snapshot) {
        if (!snapshot || snapshot.agents.length === 0) {
          return '<div class="empty">No live or recent lead sessions in the selected workspace right now.</div>';
        }

        const sorted = [...snapshot.agents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        return renderNeedsAttention([snapshot]) + sorted.map((agent) => {
          const appearanceAction = \`<button data-action="cycle-look" data-project-root="\${escapeHtml(snapshot.projectRoot)}" data-agent-id="\${escapeHtml(agent.id)}">Cycle look</button>\`;
          const focusKeys = escapeHtml(JSON.stringify(collectFocusedSessionKeys(snapshot, agent)));
          const description = normalizeDisplayText(snapshot.projectRoot, agent.detail)
            || latestAgentMessage(agent)
            || \`[\${agent.state}]\`;
          return \`<article class="session-card" tabindex="0" data-focus-keys="\${focusKeys}"><div class="session-card-header"><strong class="session-card-title">\${escapeHtml(agent.label)}</strong><div class="card-actions">\${appearanceAction}</div></div><div class="muted session-card-description" title="\${escapeHtml(description)}">\${escapeHtml(description)}</div></article>\`;
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
          const appearanceAction = \`<button data-action="cycle-look" data-project-root="\${escapeHtml(snapshot.projectRoot)}" data-agent-id="\${escapeHtml(agent.id)}">Cycle look</button>\`;
          const focusKeys = escapeHtml(JSON.stringify(collectFocusedSessionKeys(snapshot, agent)));
          const detail = normalizeDisplayText(snapshot.projectRoot, agent.detail)
            || latestAgentMessage(agent)
            || \`[\${agent.state}]\`;
          const description = \`\${projectLabel(snapshot.projectRoot)} · \${detail}\`;
          return \`<article class="session-card" tabindex="0" data-focus-keys="\${focusKeys}"><div class="session-card-header"><strong class="session-card-title">\${escapeHtml(agent.label)}</strong><div class="card-actions">\${appearanceAction}</div></div><div class="muted session-card-description" title="\${escapeHtml(description)}">\${escapeHtml(description)}</div></article>\`;
        }).join("");
      }

      function applySessionFocus() {
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

        enteringAgentKeys = new Set(
          [...nextMemory.keys()].filter((key) => !previousKeys.has(key))
        );

        for (const [key, entry] of liveAgentMemory.entries()) {
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
        const nextFleetSemanticToken = fleetSemanticToken(fleet);
        if (nextFleetSemanticToken && nextFleetSemanticToken === lastFleetSemanticToken) {
          return;
        }
        const previousFleet = state.fleet;
        queueSnapshotEvents(previousFleet, fleet);
        queueAgentNotifications(previousFleet, fleet);
        state.fleet = fleet;
        lastFleetSemanticToken = nextFleetSemanticToken;
        if (state.selected !== "all") {
          const exists = state.fleet.projects.some((project) => project.projectRoot === state.selected);
          if (!exists) {
            state.selected = "all";
            state.workspaceFullscreen = false;
            syncUrl();
          }
        }
        render();
      }

      function render() {
        if (!state.fleet) return;

        const fleet = state.fleet;
        const rawProjects = visibleProjects(fleet);
        updateRecentLeadReservations(rawProjects);
        const displayedProjects = rawProjects.map((project) => viewSnapshot(project, SCENE_RECENT_LEAD_LIMIT));
        const sessionProjects = rawProjects.map((project) => viewSessionSnapshot(project, SESSION_RECENT_LEAD_LIMIT));
        const selectedRawSnapshot = currentSnapshot();
        const snapshot = selectedRawSnapshot ? viewSnapshot(selectedRawSnapshot, SCENE_RECENT_LEAD_LIMIT) : null;
        const sessionSnapshot = selectedRawSnapshot ? viewSessionSnapshot(selectedRawSnapshot, SESSION_RECENT_LEAD_LIMIT) : null;
        if (!snapshot && state.workspaceFullscreen) {
          state.workspaceFullscreen = false;
          syncUrl();
        }
        syncLiveAgentState(rawProjects);
        sceneStateDraft = null;
        const counts = fleetCounts({ projects: sessionProjects });
        const nextSceneToken = state.view === "map"
          ? (snapshot
            ? \`project::\${sceneSnapshotToken(snapshot)}\`
            : \`fleet::\${displayedProjects.map(sceneSnapshotToken).join("||")}\`)
          : null;

        setTextIfChanged(stamp, \`Updated \${fleet.generatedAt}\`);
        setTextIfChanged(projectCount, \`\${fleet.projects.length} tracked · \${displayedProjects.filter((project) => busyCount(project) > 0).length} live · \${SESSION_RECENT_LEAD_LIMIT} recent sessions\`);
        mapViewButton.classList.toggle("active", state.view === "map");
        terminalViewButton.classList.toggle("active", state.view === "terminal");
        setConnection(state.connection);
        rememberVisibleRecentLeads(displayedProjects);
        syncWorkspaceFullscreenUi();
        syncFleetBackdrop();
        syncSkyParallax();

        setHtmlIfChanged(heroSummary, renderHeroSummary(counts));

        setHtmlIfChanged(projectTabs, [
          \`<button class="project-tab\${state.selected === "all" ? " active" : ""}" data-action="select-project" data-project-root="all">All</button>\`,
          ...displayedProjects.map((project) => {
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
            if (centerChanged && sceneStateDraft) {
              renderedAgentSceneState = sceneStateDraft;
            }
            sceneStateDraft = null;
            syncSessionFocusFromDom();
            syncWorkstationEffects();
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
                  compact: false,
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
          if (centerChanged && sceneStateDraft) {
            renderedAgentSceneState = sceneStateDraft;
          }
          sceneStateDraft = null;
          syncSessionFocusFromDom();
          syncWorkstationEffects();
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
        const target = event.target instanceof HTMLElement ? event.target.closest("[data-action], [data-view], #preview-toasts-button, #workspace-focus-button") : null;
        if (!(target instanceof HTMLElement)) return;

        if (target.dataset.view) {
          setView(target.dataset.view);
          return;
        }

        const action = target.dataset.action;
        if (action === "select-project" && target.dataset.projectRoot) {
          setSelection(target.dataset.projectRoot);
          return;
        }

        if (action === "toggle-workspace-focus") {
          toggleWorkspaceFullscreen();
          return;
        }

        if (target === previewToastsButton) {
          runToastPreview();
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

      refreshButton.addEventListener("click", async () => {
        ingestFleet(await postJson("/api/refresh"));
      });
      scaffoldButton.addEventListener("click", async () => {
        const snapshot = currentSnapshot();
        const projectRoot = snapshot ? snapshot.projectRoot : configuredProjects[0]?.root;
        if (!projectRoot) return;
        await postJson("/api/rooms/scaffold", { projectRoot });
        ingestFleet(await postJson("/api/refresh"));
      });

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
        .catch(() => setConnection("offline"));

  `;
}
