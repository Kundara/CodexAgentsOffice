export const CLIENT_RUNTIME_MESSAGE_FILTER_SOURCE = `      function latestTypedMessageEvent(snapshot, agent) {
        if (!snapshot || !agent || !agent.threadId) {
          return null;
        }
        const matching = (snapshot.events || [])
          .filter((event) => {
            if (event.threadId !== agent.threadId || event.kind !== "message") {
              return false;
            }
            const userMessageMethod = typeof event.method === "string" ? event.method : "";
            return !(
              event.itemType === "user_message"
              || event.itemType === "userMessage"
              || userMessageMethod === "cursor/local/prompt"
              || userMessageMethod === "userMessage"
              || userMessageMethod.endsWith("/userMessage")
            );
          });
        if (matching.length === 0) {
          return null;
        }
        return matching.sort((left, right) => {
          const leftAt = Date.parse(left.createdAt || "");
          const rightAt = Date.parse(right.createdAt || "");
          return (Number.isFinite(rightAt) ? rightAt : 0) - (Number.isFinite(leftAt) ? leftAt : 0);
        })[0] || null;
      }

`;
