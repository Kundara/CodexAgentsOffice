export const MULTIPLAYER_SCRIPT = `
      const multiplayerPeerId = loadMultiplayerPeerId();
      const multiplayerDeviceId = loadMultiplayerDeviceId();
      const multiplayerPeers = new Map();
      const multiplayerRemoteProjects = new Map();
      let multiplayerSocket = null;
      let multiplayerModulePromise = null;
      let multiplayerBroadcastTimer = null;
      let multiplayerPruneTimer = null;
      const MULTIPLAYER_STALE_MS = 30000;
      const MULTIPLAYER_REMOTE_PROJECT_COOLDOWN_MS = 60 * 60 * 1000;
      const MULTIPLAYER_BROADCAST_DEBOUNCE_MS = 700;
      const MULTIPLAYER_NICKNAME_MAX_LENGTH = 12;

      function sanitizeMultiplayerField(value) {
        return typeof value === "string" ? value.trim() : "";
      }

      function sanitizeMultiplayerNickname(value) {
        return sanitizeMultiplayerField(value).slice(0, MULTIPLAYER_NICKNAME_MAX_LENGTH);
      }

      function hasMultiplayerCredentials(settings) {
        return Boolean(
          sanitizeMultiplayerField(settings && settings.host)
          && sanitizeMultiplayerField(settings && settings.room)
        );
      }

      function loadMultiplayerSettings() {
        try {
          const raw = window.localStorage.getItem(multiplayerSettingsStorageKey);
          if (!raw) {
            return { enabled: false, host: "", room: "", nickname: "" };
          }
          const parsed = JSON.parse(raw);
          const host = sanitizeMultiplayerField(parsed && parsed.host);
          const room = sanitizeMultiplayerField(parsed && parsed.room);
          const hasCredentials = Boolean(host && room);
          return {
            enabled: typeof (parsed && parsed.enabled) === "boolean" ? Boolean(parsed && parsed.enabled) : hasCredentials,
            host,
            room,
            nickname: sanitizeMultiplayerNickname(parsed && parsed.nickname)
          };
        } catch {
          return { enabled: false, host: "", room: "", nickname: "" };
        }
      }

      function saveMultiplayerSettings() {
        try {
          window.localStorage.setItem(multiplayerSettingsStorageKey, JSON.stringify(state.multiplayerSettings));
        } catch {}
      }

      function loadMultiplayerProjectShares() {
        try {
          const raw = window.localStorage.getItem(multiplayerProjectShareStorageKey);
          if (!raw) {
            return {};
          }
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object") {
            return {};
          }
          const next = {};
          for (const [projectRoot, shared] of Object.entries(parsed)) {
            const normalizedRoot = sanitizeMultiplayerField(projectRoot);
            if (!normalizedRoot || shared !== false) {
              continue;
            }
            next[normalizedRoot] = false;
          }
          return next;
        } catch {
          return {};
        }
      }

      function saveMultiplayerProjectShares() {
        try {
          window.localStorage.setItem(
            multiplayerProjectShareStorageKey,
            JSON.stringify(state.multiplayerProjectShares || {})
          );
        } catch {}
      }

      function isProjectSharedWithRoom(projectRoot) {
        const normalizedRoot = sanitizeMultiplayerField(projectRoot);
        if (!normalizedRoot) {
          return true;
        }
        return state.multiplayerProjectShares?.[normalizedRoot] !== false;
      }

      function setProjectRootsSharedWithRoom(projectRoots, shared) {
        const normalizedRoots = Array.from(new Set((Array.isArray(projectRoots) ? projectRoots : [])
          .map((projectRoot) => sanitizeMultiplayerField(projectRoot))
          .filter(Boolean)));
        if (normalizedRoots.length === 0) {
          return;
        }
        const nextShares = { ...(state.multiplayerProjectShares || {}) };
        for (const projectRoot of normalizedRoots) {
          if (shared === false) {
            nextShares[projectRoot] = false;
          } else {
            delete nextShares[projectRoot];
          }
        }
        state.multiplayerProjectShares = nextShares;
        saveMultiplayerProjectShares();
        render();
        scheduleMultiplayerBroadcast();
      }

      function loadMultiplayerPeerId() {
        try {
          const existing = sanitizeMultiplayerField(window.sessionStorage.getItem(multiplayerPeerIdStorageKey));
          if (existing) {
            return existing;
          }
        } catch {}
        const generated = crypto && crypto.randomUUID ? crypto.randomUUID() : "peer-" + Math.random().toString(36).slice(2, 10);
        try {
          window.sessionStorage.setItem(multiplayerPeerIdStorageKey, generated);
        } catch {}
        return generated;
      }

      function loadMultiplayerDeviceId() {
        try {
          const existing = sanitizeMultiplayerField(window.localStorage.getItem(multiplayerDeviceIdStorageKey));
          if (existing) {
            return existing;
          }
        } catch {}
        const generated = crypto && crypto.randomUUID ? crypto.randomUUID() : "device-" + Math.random().toString(36).slice(2, 10);
        try {
          window.localStorage.setItem(multiplayerDeviceIdStorageKey, generated);
        } catch {}
        return generated;
      }

      function cloneValue(value) {
        if (typeof structuredClone === "function") {
          return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
      }

      function normalizeWorkspaceName(value) {
        return String(value || "").trim().toLowerCase();
      }

      function snapshotWorkspaceName(snapshot) {
        if (snapshot && typeof snapshot.projectLabel === "string" && snapshot.projectLabel.trim().length > 0) {
          return snapshot.projectLabel.trim();
        }
        const projectRoot = snapshot && typeof snapshot.projectRoot === "string" ? snapshot.projectRoot : "";
        const segments = projectRoot.split(/[\\\\/]/).filter(Boolean);
        return segments[segments.length - 1] || projectRoot || "workspace";
      }

      function snapshotWorkspaceKey(snapshot) {
        return normalizeWorkspaceName(snapshotWorkspaceName(snapshot));
      }

      function normalizeSharedPathCandidate(value) {
        let normalized = String(value || "").split("\\\\").join("/");
        while (normalized.endsWith("/")) {
          normalized = normalized.slice(0, -1);
        }
        return normalized;
      }

      function trimLeadingDotSegment(value) {
        if (value === "./") {
          return "";
        }
        if (value === ".") {
          return "";
        }
        if (value.startsWith("./")) {
          return value.slice(2);
        }
        return value;
      }

      function remapSharedPath(remoteProjectRoot, localProjectRoot, value) {
        if (typeof value !== "string" || value.trim().length === 0) {
          return null;
        }
        const normalizedValue = normalizeSharedPathCandidate(value);
        const normalizedRemoteRoot = normalizeSharedPathCandidate(remoteProjectRoot || "");
        const normalizedLocalRoot = normalizeSharedPathCandidate(localProjectRoot || "");
        if (!normalizedValue || !normalizedRemoteRoot || !normalizedLocalRoot) {
          return value;
        }
        if (normalizedValue === normalizedRemoteRoot) {
          return normalizedLocalRoot;
        }
        if (normalizedValue.startsWith(normalizedRemoteRoot + "/")) {
          return normalizedLocalRoot + normalizedValue.slice(normalizedRemoteRoot.length);
        }
        return value;
      }

      function remapSharedPaths(remoteProjectRoot, localProjectRoot, paths) {
        return Array.from(new Set((Array.isArray(paths) ? paths : [])
          .map((path) => remapSharedPath(remoteProjectRoot, localProjectRoot, path))
          .filter((path) => typeof path === "string" && path.length > 0)));
      }

      function roomMatchesRelativePath(roomPath, relativePathValue) {
        const roomCandidate = trimLeadingDotSegment(normalizeSharedPathCandidate(roomPath || "."));
        const relativeCandidate = trimLeadingDotSegment(normalizeSharedPathCandidate(relativePathValue || "."));
        if (!roomCandidate) {
          return true;
        }
        return relativeCandidate === roomCandidate || relativeCandidate.startsWith(roomCandidate + "/");
      }

      function roomIdForSharedPaths(snapshot, paths) {
        if (!snapshot || !snapshot.rooms || !Array.isArray(snapshot.rooms.rooms) || !Array.isArray(paths)) {
          return null;
        }
        const rooms = flattenRooms(snapshot.rooms.rooms);
        let bestRoom = null;
        let bestDepth = -1;
        for (const path of paths) {
          const relative = relativeLocation(snapshot.projectRoot, path);
          if (!relative) {
            continue;
          }
          for (const room of rooms) {
            if (!roomMatchesRelativePath(room.path, relative)) {
              continue;
            }
            const depth = trimLeadingDotSegment(normalizeSharedPathCandidate(room.path || ".")).split("/").filter(Boolean).length;
            if (depth > bestDepth) {
              bestRoom = room;
              bestDepth = depth;
            }
          }
        }
        return bestRoom ? bestRoom.id : null;
      }

      function sharedPeerLabel() {
        const nickname = sanitizeMultiplayerNickname(state.multiplayerSettings.nickname);
        return nickname || "Peer " + multiplayerPeerId.slice(0, 6);
      }

      function sharedLocalParticipantLabel() {
        const nickname = sanitizeMultiplayerNickname(state.multiplayerSettings.nickname);
        return nickname || "You";
      }

      function sharedRoomNote(peerCount) {
        const roomName = state.multiplayerSettings.room;
        return roomName
          ? "Shared room " + roomName + " · " + peerCount + " remote peer" + (peerCount === 1 ? "" : "s")
          : "Shared room connected · " + peerCount + " remote peer" + (peerCount === 1 ? "" : "s");
      }

      function sharedProjectCooldownNote() {
        return "Shared project cooldown · keep remote-only floors visible for up to 1 hour after sharing stops.";
      }

      function ensureSnapshotNotes(snapshot) {
        if (!Array.isArray(snapshot.notes)) {
          snapshot.notes = [];
        }
        return snapshot.notes;
      }

      function ensureSnapshotSharedParticipants(snapshot) {
        if (!Array.isArray(snapshot.sharedParticipantLabels)) {
          snapshot.sharedParticipantLabels = [];
        }
        return snapshot.sharedParticipantLabels;
      }

      function setSnapshotSharedParticipants(snapshot, participantLabels) {
        snapshot.sharedParticipantLabels = Array.from(new Set((Array.isArray(participantLabels) ? participantLabels : [])
          .map((label) => sanitizeMultiplayerNickname(label) || sanitizeMultiplayerField(label))
          .filter(Boolean)))
          .sort((left, right) => left.localeCompare(right));
      }

      function setSnapshotSharedPeerCount(snapshot, peerCount) {
        const notes = ensureSnapshotNotes(snapshot).filter((note) =>
          typeof note !== "string"
          || (!note.startsWith("Shared room ") && !note.startsWith("Shared room connected"))
        );
        notes.push(sharedRoomNote(peerCount));
        snapshot.notes = notes;
      }

      function setSnapshotCooldownNote(snapshot) {
        const notes = ensureSnapshotNotes(snapshot).filter((note) => note !== sharedProjectCooldownNote());
        notes.push(sharedProjectCooldownNote());
        snapshot.notes = notes;
      }

      function activeSharedPeerCount() {
        const cutoff = Date.now() - MULTIPLAYER_STALE_MS;
        let count = 0;
        for (const peer of multiplayerPeers.values()) {
          if (peer.receivedAt >= cutoff) {
            count += 1;
          }
        }
        return count;
      }

      function multiplayerTransportRoom(value) {
        return encodeURIComponent(sanitizeMultiplayerField(value));
      }

      function setMultiplayerStatus(nextState, detail) {
        state.multiplayerStatus = {
          state: String(nextState || "disabled"),
          detail: String(detail || "")
        };
        syncMultiplayerSettingsUi();
      }

      function syncMultiplayerSettingsUi() {
        if (multiplayerEnabledButton instanceof HTMLButtonElement) {
          const enabled = state.multiplayerSettings.enabled === true;
          multiplayerEnabledButton.classList.toggle("active", enabled);
          multiplayerEnabledButton.setAttribute("aria-pressed", enabled ? "true" : "false");
          multiplayerEnabledButton.textContent = enabled ? "Sharing On" : "Sharing Off";
        }
        if (multiplayerHostInput instanceof HTMLInputElement && multiplayerHostInput.value !== state.multiplayerSettings.host) {
          multiplayerHostInput.value = state.multiplayerSettings.host;
        }
        if (multiplayerRoomInput instanceof HTMLInputElement && multiplayerRoomInput.value !== state.multiplayerSettings.room) {
          multiplayerRoomInput.value = state.multiplayerSettings.room;
        }
        if (multiplayerNicknameInput instanceof HTMLInputElement && multiplayerNicknameInput.value !== state.multiplayerSettings.nickname) {
          multiplayerNicknameInput.value = state.multiplayerSettings.nickname;
        }
        if (multiplayerStatus instanceof HTMLElement) {
          multiplayerStatus.textContent = state.multiplayerStatus.detail;
          multiplayerStatus.dataset.state = state.multiplayerStatus.state;
        }
      }

      function mergeSharedAgent(localSnapshot, remoteSnapshot, agent, peer) {
        const cwd = remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.cwd);
        const paths = remapSharedPaths(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.paths);
        return {
          ...agent,
          id: "shared:" + peer.peerId + ":" + agent.id,
          parentThreadId: agent.parentThreadId ? "shared:" + peer.peerId + ":" + agent.parentThreadId : null,
          threadId: agent.threadId ? "shared:" + peer.peerId + ":" + agent.threadId : null,
          taskId: agent.taskId ? "shared:" + peer.peerId + ":" + agent.taskId : null,
          cwd,
          paths,
          roomId: roomIdForSharedPaths(localSnapshot, paths.length > 0 ? paths : cwd ? [cwd] : []),
          resumeCommand: null,
          activityEvent: agent.activityEvent
            ? {
              ...agent.activityEvent,
              path: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.activityEvent.path)
            }
            : null,
          needsUser: agent.needsUser
            ? {
              ...agent.needsUser,
              cwd: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.needsUser.cwd) || undefined,
              grantRoot: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, agent.needsUser.grantRoot) || undefined
            }
            : null,
          network: {
            transport: "partykit",
            peerId: peer.peerId,
            peerLabel: peer.peerLabel,
            peerHost: state.multiplayerSettings.host || null
          }
        };
      }

      function mergeSharedEvent(localSnapshot, remoteSnapshot, event, peer) {
        return {
          ...event,
          id: "shared:" + peer.peerId + ":" + event.id,
          threadId: event.threadId ? "shared:" + peer.peerId + ":" + event.threadId : null,
          path: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, event.path),
          cwd: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, event.cwd) || undefined,
          grantRoot: remapSharedPath(remoteSnapshot.projectRoot, localSnapshot.projectRoot, event.grantRoot) || undefined
        };
      }

      function remoteProjectMemoryEntry(snapshot, participantLabels, receivedAt) {
        return {
          snapshot: cloneValue(snapshot),
          participantLabels: Array.from(new Set((Array.isArray(participantLabels) ? participantLabels : []).filter(Boolean))),
          receivedAt
        };
      }

      function cooledRemoteProjectSnapshot(entry) {
        const cooledAtIso = new Date(entry.receivedAt).toISOString();
        const snapshot = cloneValue(entry.snapshot);
        snapshot.agents = (Array.isArray(snapshot.agents) ? snapshot.agents : []).map((agent) => ({
          ...agent,
          isCurrent: false,
          isOngoing: false,
          needsUser: null,
          stoppedAt: agent.stoppedAt || cooledAtIso,
          statusText: agent.source === "local" && agent.statusText === "active" ? "idle" : agent.statusText
        }));
        snapshot.generatedAt = cooledAtIso;
        snapshot.sharedRemoteOnly = true;
        snapshot.sharedCoolingDown = true;
        setSnapshotSharedParticipants(snapshot, entry.participantLabels);
        setSnapshotCooldownNote(snapshot);
        return snapshot;
      }

      function pruneRemoteProjectCooldowns() {
        const cutoff = Date.now() - MULTIPLAYER_REMOTE_PROJECT_COOLDOWN_MS;
        let changed = false;
        for (const [projectKey, entry] of multiplayerRemoteProjects.entries()) {
          if (!entry || entry.receivedAt < cutoff) {
            multiplayerRemoteProjects.delete(projectKey);
            changed = true;
          }
        }
        return changed;
      }

      function sharedAgentIdentityKeys(agent) {
        const keys = [];
        if (!agent || typeof agent !== "object") {
          return keys;
        }
        if (typeof agent.id === "string" && agent.id.length > 0) {
          keys.push("id:" + agent.id);
        }
        if (typeof agent.threadId === "string" && agent.threadId.length > 0) {
          keys.push("thread:" + agent.threadId);
        }
        if (typeof agent.taskId === "string" && agent.taskId.length > 0) {
          keys.push("task:" + agent.taskId);
        }
        return keys;
      }

      function collectSharedAgentIdentityKeys(agents) {
        const keys = new Set();
        for (const agent of Array.isArray(agents) ? agents : []) {
          for (const key of sharedAgentIdentityKeys(agent)) {
            keys.add(key);
          }
        }
        return keys;
      }

      function ensureRemoteSharedBucket(remoteProjectsByKey, remoteSnapshot, peer) {
        const projectKey = snapshotWorkspaceKey(remoteSnapshot);
        let bucket = remoteProjectsByKey.get(projectKey);
        if (!bucket) {
          const snapshot = cloneValue(remoteSnapshot);
          snapshot.agents = [];
          snapshot.events = [];
          snapshot.sharedRemoteOnly = true;
          snapshot.sharedCoolingDown = false;
          setSnapshotSharedParticipants(snapshot, []);
          bucket = {
            key: projectKey,
            snapshot,
            participantLabels: new Set(),
            agentIdentityKeys: new Set()
          };
          remoteProjectsByKey.set(projectKey, bucket);
        }
        bucket.participantLabels.add(peer.peerLabel);
        return bucket;
      }

      function buildSharedFleet(localFleet) {
        if (!localFleet) {
          return null;
        }
        const mergedFleet = cloneValue(localFleet);
        const localProjectsByKey = new Map(mergedFleet.projects.map((snapshot) => [snapshotWorkspaceKey(snapshot), snapshot]));
        const remoteProjectsByKey = new Map();
        let sharedPeerCount = 0;

        for (const peer of multiplayerPeers.values()) {
          if (Date.now() - peer.receivedAt > MULTIPLAYER_STALE_MS) {
            continue;
          }
          sharedPeerCount += 1;
          for (const remoteSnapshot of peer.projects) {
            const projectKey = snapshotWorkspaceKey(remoteSnapshot);
            const localSnapshot = localProjectsByKey.get(projectKey);
            if (!localSnapshot) {
              const bucket = ensureRemoteSharedBucket(remoteProjectsByKey, remoteSnapshot, peer);
              const mergedEvents = (Array.isArray(remoteSnapshot.events) ? remoteSnapshot.events : [])
                .map((event) => mergeSharedEvent(bucket.snapshot, remoteSnapshot, event, peer));
              const mergedAgents = (Array.isArray(remoteSnapshot.agents) ? remoteSnapshot.agents : [])
                .filter((agent) => {
                  const identityKeys = sharedAgentIdentityKeys(agent);
                  return !identityKeys.some((key) => bucket.agentIdentityKeys.has(key));
                })
                .map((agent) => {
                  for (const key of sharedAgentIdentityKeys(agent)) {
                    bucket.agentIdentityKeys.add(key);
                  }
                  return mergeSharedAgent(bucket.snapshot, remoteSnapshot, agent, peer);
                });
              bucket.snapshot.agents = bucket.snapshot.agents.concat(mergedAgents);
              bucket.snapshot.events = bucket.snapshot.events.concat(mergedEvents).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
              continue;
            }
            const localAgentIdentityKeys = collectSharedAgentIdentityKeys(localSnapshot.agents);
            const mergedAgents = (Array.isArray(remoteSnapshot.agents) ? remoteSnapshot.agents : [])
              .filter((agent) => !sharedAgentIdentityKeys(agent).some((key) => localAgentIdentityKeys.has(key)))
              .map((agent) => mergeSharedAgent(localSnapshot, remoteSnapshot, agent, peer));
            const mergedEvents = (Array.isArray(remoteSnapshot.events) ? remoteSnapshot.events : [])
              .map((event) => mergeSharedEvent(localSnapshot, remoteSnapshot, event, peer));
            if (mergedAgents.length === 0 && mergedEvents.length === 0) {
              continue;
            }
            localSnapshot.agents = localSnapshot.agents.concat(mergedAgents);
            localSnapshot.events = localSnapshot.events.concat(mergedEvents).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
            const participantLabels = new Set(ensureSnapshotSharedParticipants(localSnapshot));
            participantLabels.add(peer.peerLabel);
            setSnapshotSharedParticipants(localSnapshot, [...participantLabels]);
          }
        }

        for (const snapshot of mergedFleet.projects) {
          if (Array.isArray(snapshot.sharedParticipantLabels) && snapshot.sharedParticipantLabels.length > 0) {
            setSnapshotSharedPeerCount(snapshot, sharedPeerCount);
          }
        }

        for (const [projectKey, bucket] of remoteProjectsByKey.entries()) {
          setSnapshotSharedParticipants(bucket.snapshot, [...bucket.participantLabels]);
          setSnapshotSharedPeerCount(bucket.snapshot, sharedPeerCount);
          multiplayerRemoteProjects.set(
            projectKey,
            remoteProjectMemoryEntry(bucket.snapshot, [...bucket.participantLabels], Date.now())
          );
          mergedFleet.projects.push(bucket.snapshot);
        }

        for (const [projectKey, entry] of multiplayerRemoteProjects.entries()) {
          if (remoteProjectsByKey.has(projectKey) || localProjectsByKey.has(projectKey)) {
            continue;
          }
          if (Date.now() - entry.receivedAt > MULTIPLAYER_REMOTE_PROJECT_COOLDOWN_MS) {
            multiplayerRemoteProjects.delete(projectKey);
            continue;
          }
          mergedFleet.projects.push(cooledRemoteProjectSnapshot(entry));
        }

        return {
          generatedAt: localFleet.generatedAt,
          projects: mergedFleet.projects
        };
      }

      function notificationFleetView(fleet) {
        if (!fleet) {
          return null;
        }
        return {
          ...fleet,
          projects: mergeWorktreeProjects(Array.isArray(fleet.projects) ? fleet.projects : [])
        };
      }

      function applyFleet(localFleet) {
        const fleet = buildSharedFleet(localFleet);
        if (!fleet) {
          return;
        }
        const nextFleetSemanticToken = fleetSemanticToken(fleet);
        if (nextFleetSemanticToken && nextFleetSemanticToken === lastFleetSemanticToken) {
          return;
        }
        const previousFleet = state.fleet;
        const previousNotificationFleet = notificationFleetView(previousFleet);
        const nextNotificationFleet = notificationFleetView(fleet);
        queueSnapshotEvents(previousNotificationFleet, nextNotificationFleet);
        queueAgentNotifications(previousNotificationFleet, nextNotificationFleet);
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

      function pruneMultiplayerPeers() {
        const cutoff = Date.now() - MULTIPLAYER_STALE_MS;
        let changed = false;
        for (const [peerId, peer] of multiplayerPeers.entries()) {
          if (peer.receivedAt < cutoff) {
            multiplayerPeers.delete(peerId);
            changed = true;
          }
        }
        if (pruneRemoteProjectCooldowns()) {
          changed = true;
        }
        if (changed) {
          applyFleet(state.localFleet);
        }
        if (!state.multiplayerSettings.enabled) {
          setMultiplayerStatus("disabled", "Shared room sync is off.");
          return;
        }
        if (!state.multiplayerSettings.host || !state.multiplayerSettings.room) {
          setMultiplayerStatus("disabled", "Shared room sync is off.");
          return;
        }
        if (multiplayerSocket && multiplayerSocket.readyState === 1) {
          const peerCount = activeSharedPeerCount();
          setMultiplayerStatus("live", "Connected to " + state.multiplayerSettings.room + " on " + state.multiplayerSettings.host + " · " + peerCount + " peer" + (peerCount === 1 ? "" : "s"));
        }
      }

      async function loadPartySocket() {
        if (!multiplayerModulePromise) {
          multiplayerModulePromise = import("/vendor/partysocket/index.js");
        }
        const module = await multiplayerModulePromise;
        return module.default || module.PartySocket || module;
      }

      function disconnectMultiplayer(options = {}) {
        if (multiplayerBroadcastTimer) {
          clearTimeout(multiplayerBroadcastTimer);
          multiplayerBroadcastTimer = null;
        }
        if (multiplayerSocket) {
          const socket = multiplayerSocket;
          multiplayerSocket = null;
          socket.close(1000, "reconfigure");
        }
        multiplayerPeers.clear();
        if (!options.preserveStatus) {
          multiplayerRemoteProjects.clear();
        }
        pruneRemoteProjectCooldowns();
        applyFleet(state.localFleet);
        if (!options.preserveStatus) {
          setMultiplayerStatus("disabled", "Shared room sync is off.");
        }
      }

      function buildMultiplayerPayload() {
        if (!state.localFleet) {
          return null;
        }
        const nickname = sanitizeMultiplayerNickname(state.multiplayerSettings.nickname);
        const sharedProjects = state.localFleet.projects.filter((snapshot) => isProjectSharedWithRoom(snapshot.projectRoot));
        return {
          type: "fleet-sync",
          peerId: multiplayerPeerId,
          deviceId: multiplayerDeviceId,
          peerLabel: nickname || sharedPeerLabel(),
          nickname,
          sentAt: new Date().toISOString(),
          projects: sharedProjects
        };
      }

      function broadcastLocalFleetNow() {
        if (!multiplayerSocket || multiplayerSocket.readyState !== 1) {
          return;
        }
        const payload = buildMultiplayerPayload();
        if (!payload) {
          return;
        }
        multiplayerSocket.send(JSON.stringify(payload));
      }

      function scheduleMultiplayerBroadcast() {
        if (!multiplayerSocket || multiplayerSocket.readyState !== 1) {
          return;
        }
        if (multiplayerBroadcastTimer) {
          clearTimeout(multiplayerBroadcastTimer);
        }
        multiplayerBroadcastTimer = setTimeout(() => {
          multiplayerBroadcastTimer = null;
          broadcastLocalFleetNow();
        }, MULTIPLAYER_BROADCAST_DEBOUNCE_MS);
      }

      function handleMultiplayerMessage(raw) {
        let payload = null;
        try {
          payload = JSON.parse(raw);
        } catch {
          return;
        }
        if (
          !payload
          || payload.type !== "fleet-sync"
          || payload.peerId === multiplayerPeerId
          || payload.deviceId === multiplayerDeviceId
          || !Array.isArray(payload.projects)
        ) {
          return;
        }
        const peerLabel = sanitizeMultiplayerNickname(payload.nickname) || sanitizeMultiplayerField(payload.peerLabel) || "Peer";
        multiplayerPeers.set(payload.peerId, {
          peerId: String(payload.peerId),
          peerLabel,
          receivedAt: Date.now(),
          projects: payload.projects
        });
        applyFleet(state.localFleet);
        pruneMultiplayerPeers();
      }

      async function refreshMultiplayerConnection() {
        if (screenshotMode) {
          disconnectMultiplayer({ preserveStatus: true });
          setMultiplayerStatus("disabled", "Shared room sync is disabled in screenshot mode.");
          return;
        }
        if (!state.multiplayerSettings.enabled) {
          disconnectMultiplayer();
          return;
        }
        const host = sanitizeMultiplayerField(state.multiplayerSettings.host);
        const room = sanitizeMultiplayerField(state.multiplayerSettings.room);
        const transportRoom = multiplayerTransportRoom(room);
        if (!host || !room) {
          disconnectMultiplayer();
          return;
        }

        disconnectMultiplayer({ preserveStatus: true });
        setMultiplayerStatus("connecting", "Connecting to " + room + " on " + host + "…");

        try {
          const PartySocket = await loadPartySocket();
          const socket = new PartySocket({
            host,
            room: transportRoom,
            id: multiplayerPeerId
          });
          multiplayerSocket = socket;
          socket.addEventListener("open", () => {
            if (multiplayerSocket !== socket) {
              return;
            }
            const peerCount = activeSharedPeerCount();
            setMultiplayerStatus("live", "Connected to " + room + " on " + host + " · " + peerCount + " peer" + (peerCount === 1 ? "" : "s"));
            broadcastLocalFleetNow();
          });
          socket.addEventListener("message", (event) => {
            if (multiplayerSocket !== socket) {
              return;
            }
            handleMultiplayerMessage(event.data);
          });
          socket.addEventListener("close", () => {
            if (multiplayerSocket !== socket) {
              return;
            }
            setMultiplayerStatus("reconnecting", "Reconnecting to " + room + " on " + host + "…");
          });
          socket.addEventListener("error", () => {
            if (multiplayerSocket !== socket) {
              return;
            }
            setMultiplayerStatus("error", "Shared room connection failed for " + room + " on " + host + ".");
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setMultiplayerStatus("error", "Shared room setup failed: " + message);
        }
      }

      function commitMultiplayerSettings(nextSettings) {
        const nextHost = sanitizeMultiplayerField(nextSettings && nextSettings.host);
        const nextRoom = sanitizeMultiplayerField(nextSettings && nextSettings.room);
        const nextNickname = sanitizeMultiplayerNickname(nextSettings && nextSettings.nickname);
        const nextHasCredentials = Boolean(nextHost && nextRoom);
        const previousHadCredentials = hasMultiplayerCredentials(state.multiplayerSettings);
        const nextEnabled =
          typeof (nextSettings && nextSettings.enabled) === "boolean"
            ? Boolean(nextSettings && nextSettings.enabled) && nextHasCredentials
            : nextHasCredentials
              ? (!previousHadCredentials ? true : state.multiplayerSettings.enabled === true)
              : false;
        state.multiplayerSettings = {
          enabled: nextEnabled,
          host: nextHost,
          room: nextRoom,
          nickname: nextNickname
        };
        saveMultiplayerSettings();
        syncMultiplayerSettingsUi();
        void refreshMultiplayerConnection();
      }
`;
