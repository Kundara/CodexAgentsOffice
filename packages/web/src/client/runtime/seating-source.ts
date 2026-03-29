export const CLIENT_RUNTIME_SEATING_SOURCE = `
      const TOP_LEVEL_DONE_WORKSTATION_GRACE_MS = 5000;
      const SUBAGENT_DONE_WORKSTATION_GRACE_MS = 7000;
      const CURRENT_LOCAL_LIVE_WORKSTATION_GRACE_MS = 8000;

      function isRuntimeActiveLocalAgent(agent) {
        return agent
          && agent.source === "local"
          && agent.statusText === "active";
      }

      function workstationDoneGraceMs(agent) {
        return agent && agent.parentThreadId
          ? SUBAGENT_DONE_WORKSTATION_GRACE_MS
          : TOP_LEVEL_DONE_WORKSTATION_GRACE_MS;
      }

      function hasCurrentLocalDeskGrace(agent) {
        const updatedAt = parseAgentUpdatedAt(agent && agent.updatedAt);
        return agent && agent.isCurrent === true
          && isDeskLiveLocalState(agent.state)
          && Number.isFinite(updatedAt)
          && Date.now() - updatedAt <= CURRENT_LOCAL_LIVE_WORKSTATION_GRACE_MS;
      }

      function hasCurrentLocalSeatCooldown(agent) {
        const updatedAt = parseAgentUpdatedAt(agent && agent.updatedAt);
        return agent && agent.source === "local"
          && agent.isCurrent === true
          && Number.isFinite(updatedAt)
          && Date.now() - updatedAt <= CURRENT_LOCAL_LIVE_WORKSTATION_GRACE_MS;
      }

      function shouldSeatAtWorkstation(agent) {
        if (!agent || agent.source === "cloud" || agent.source === "presence") {
          return false;
        }
        if (agent.source === "local") {
          const stoppedAt = parseAgentUpdatedAt(agent.stoppedAt);
          if (Number.isFinite(stoppedAt)) {
            return Date.now() - stoppedAt <= workstationDoneGraceMs(agent);
          }
          if (agent.statusText === "notLoaded") {
            if (agent.state === "done") {
              const updatedAt = parseAgentUpdatedAt(agent.updatedAt);
              return agent.isCurrent === true
                && Number.isFinite(updatedAt)
                && Date.now() - updatedAt <= workstationDoneGraceMs(agent);
            }
            return agent.isOngoing === true || hasCurrentLocalDeskGrace(agent);
          }
          if (agent.statusText === "active") {
            if (isRuntimeActiveLocalAgent(agent)) {
              return true;
            }
            if ((agent.state === "idle" || agent.state === "done") && hasCurrentLocalSeatCooldown(agent)) {
              return true;
            }
            return agent.isCurrent === true
              && agent.state !== "idle"
              && agent.state !== "done";
          }
          if (agent.state === "done") {
            return agent.isCurrent === true;
          }
        }
        if (agent.state === "idle" || agent.state === "done") {
          return false;
        }
        if (agent.source === "local") {
          if (agent.isOngoing === true) {
            return true;
          }
          if (agent.isCurrent !== true) {
            return false;
          }
          return agent.statusText !== "notLoaded" && isDeskLiveLocalState(agent.state);
        }
        return agent.isCurrent === true;
      }

      function isFinishedLeadForRec(agent) {
        return isRecentLeadCandidate(agent)
          && !shouldSeatAtWorkstation(agent)
          && (agent.state === "idle" || agent.state === "done");
      }

      function isLiveSceneAgent(agent) {
        if (!agent || agent.source === "cloud" || agent.source === "presence") {
          return false;
        }
        return shouldSeatAtWorkstation(agent) || agent.isCurrent === true || isRuntimeActiveLocalAgent(agent);
      }
`;
