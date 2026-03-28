export const CLIENT_RUNTIME_SETTINGS_SOURCE = `      if (screenshotMode) {
        document.body.classList.add("snapshot-mode");
      }
      const state = {
        fleet: null,
        localFleet: null,
        selected: initialProject,
        view: initialView === "terminal" ? "terminal" : "map",
        workspaceFullscreen: initialWorkspaceFullscreen,
        settingsOpen: false,
        activeOnly: initialActiveOnly,
        connection: screenshotMode ? "snapshot" : "connecting",
        focusedSessionKeys: [],
        globalSceneSettings: loadGlobalSceneSettings(),
        furnitureLayoutOverrides: loadFurnitureLayoutOverrides(),
        integrationSettings: defaultIntegrationSettings(),
        integrationSettingsPending: false,
        integrationSettingsError: null,
        multiplayerSettings: loadMultiplayerSettings(),
        multiplayerStatus: {
          state: "disabled",
          detail: "Shared room sync is off."
        }
      };
      let furnitureDragState = null;
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
      const loadedOfficeAssetUrls = new Set();
      const loadedOfficeAssetImages = new Map();
      const officeSceneRenderers = new Map();
      const NOTIFICATION_TTL_MS = 2400;
      const MESSAGE_NOTIFICATION_TTL_MS = 4600;
      const TEXT_MESSAGE_NOTIFICATION_EXTRA_TTL_MS = 1000;
      const TOAST_FLOAT_ANIMATION_MS = 3300;
      const TEXT_MESSAGE_TOAST_FLOAT_ANIMATION_MS = 4300;
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
      const recSlotMemory = new Map();

      const projectMetaByRoot = new Map(configuredProjects.map((project) => [project.root, project]));
      function projectInfo(projectRoot) {
        if (state.fleet && Array.isArray(state.fleet.projects)) {
          const liveProject = state.fleet.projects.find((project) => project.projectRoot === projectRoot);
          if (liveProject && liveProject.projectLabel) {
            return { root: projectRoot, label: liveProject.projectLabel };
          }
        }
        return projectMetaByRoot.get(projectRoot) || {
          root: projectRoot,
          label: projectRoot.split(/[\\\\/]/).filter(Boolean).pop() || projectRoot
        };
      }

      function projectLabel(projectRoot) {
        return projectInfo(projectRoot).label;
      }

      function stableSceneSlotAssignments(projectRoot, category, agents, maxSlots = null) {
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
      }

      function agentKey(projectRoot, agent) {
        return \`\${projectRoot}::\${agent.id}\`;
      }

      function formatSceneTextScale(value) {
        return clampSceneTextScale(Number(value)).toFixed(2) + "x";
      }

      function loadGlobalSceneSettings() {
        try {
          const raw = window.localStorage.getItem(sceneSettingsStorageKey);
          if (!raw) {
            return { ...defaultGlobalSceneSettings };
          }
          const parsed = JSON.parse(raw);
          return {
            textScale: clampSceneTextScale(Number(parsed && parsed.textScale)),
            debugTiles: Boolean(parsed && parsed.debugTiles),
            splitWorktrees: Boolean(parsed && parsed.splitWorktrees)
          };
        } catch {
          return { ...defaultGlobalSceneSettings };
        }
      }

      function saveGlobalSceneSettings() {
        try {
          window.localStorage.setItem(sceneSettingsStorageKey, JSON.stringify(state.globalSceneSettings));
        } catch {
          // Ignore storage failures; runtime styling can still update in-memory.
        }
      }

      function loadFurnitureLayoutOverrides() {
        try {
          const raw = window.localStorage.getItem(furnitureLayoutStorageKey);
          if (!raw) {
            return {};
          }
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
          return {};
        }
      }

      function saveFurnitureLayoutOverrides() {
        try {
          window.localStorage.setItem(furnitureLayoutStorageKey, JSON.stringify(state.furnitureLayoutOverrides || {}));
        } catch {}
      }

      function furnitureColumnOverride(projectRoot, roomId, furnitureId, fallbackColumn) {
        return Number(
          state.furnitureLayoutOverrides?.[projectRoot]?.[roomId]?.[furnitureId]
        ) || fallbackColumn;
      }

      function setFurnitureColumnOverride(projectRoot, roomId, furnitureId, column) {
        state.furnitureLayoutOverrides = {
          ...state.furnitureLayoutOverrides,
          [projectRoot]: {
            ...(state.furnitureLayoutOverrides?.[projectRoot] || {}),
            [roomId]: {
              ...(state.furnitureLayoutOverrides?.[projectRoot]?.[roomId] || {}),
              [furnitureId]: column
            }
          }
        };
        saveFurnitureLayoutOverrides();
      }

      function applyGlobalSceneSettings() {
        const textScale = clampSceneTextScale(Number(state.globalSceneSettings && state.globalSceneSettings.textScale));
        const debugTiles = Boolean(state.globalSceneSettings && state.globalSceneSettings.debugTiles);
        const splitWorktrees = Boolean(state.globalSceneSettings && state.globalSceneSettings.splitWorktrees);
        state.globalSceneSettings = { textScale, debugTiles, splitWorktrees };
        document.documentElement.style.setProperty("--ui-text-scale", String(textScale));
        if (textScaleInput instanceof HTMLInputElement) {
          textScaleInput.value = String(textScale);
        }
        syncTextScalePreview(textScale);
        if (debugTilesButton instanceof HTMLButtonElement) {
          debugTilesButton.classList.toggle("active", debugTiles);
          debugTilesButton.setAttribute("aria-pressed", debugTiles ? "true" : "false");
        }
        if (splitWorktreesButton instanceof HTMLButtonElement) {
          splitWorktreesButton.classList.toggle("active", splitWorktrees);
          splitWorktreesButton.setAttribute("aria-pressed", splitWorktrees ? "true" : "false");
          splitWorktreesButton.title = splitWorktrees
            ? "Show each worktree on its own floor"
            : "Merge worktrees from the same repo onto one floor";
        }
      }

      function syncTextScalePreview(value) {
        if (!(textScaleOutput instanceof HTMLOutputElement)) {
          return;
        }
        const nextText = formatSceneTextScale(value);
        textScaleOutput.value = nextText;
        textScaleOutput.textContent = nextText;
      }

      function commitTextScale(value) {
        state.globalSceneSettings = {
          ...state.globalSceneSettings,
          textScale: clampSceneTextScale(Number(value))
        };
        applyGlobalSceneSettings();
        saveGlobalSceneSettings();
        fitScenes();
        renderNotifications();
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

      function roomEntranceLayout(roomPixelWidth, compact, floorTop = null) {
        const doorScale = compact ? 1.42 : 1.7;
        const clockScale = compact ? 0.92 : 1.08;
        const doorHeight = pixelOffice.props.boothDoor.h * doorScale;
        const centerDoorY = Number.isFinite(floorTop)
          ? Math.round(floorTop - doorHeight)
          : (compact ? 26 : 34);
        return {
          doorScale,
          clockScale,
          centerDoorX: Math.round(roomPixelWidth / 2 - pixelOffice.props.boothDoor.w * doorScale),
          centerDoorY,
          entryX: Math.round(roomPixelWidth / 2),
          entryY: Math.round(centerDoorY + doorHeight + (compact ? 2 : 3))
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

`;
