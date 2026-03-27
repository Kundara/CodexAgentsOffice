export const CLIENT_RUNTIME_SEATING_SOURCE = `
      const TOP_LEVEL_DONE_WORKSTATION_GRACE_MS = 5000;
      const SUBAGENT_DONE_WORKSTATION_GRACE_MS = 1200;

      function workstationDoneGraceMs(agent) {
        return agent && agent.parentThreadId
          ? SUBAGENT_DONE_WORKSTATION_GRACE_MS
          : TOP_LEVEL_DONE_WORKSTATION_GRACE_MS;
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
            return agent.isOngoing === true;
          }
          if (agent.statusText === "active") {
            return agent.isCurrent === true;
          }
          if (agent.state === "done") {
            return agent.isCurrent === true;
          }
        }
        if (agent.state === "waiting" || agent.state === "idle" || agent.state === "done") {
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
          && (agent.state === "waiting" || agent.state === "idle" || agent.state === "done");
      }
`;
