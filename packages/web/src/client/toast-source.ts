export const TOAST_SCRIPT = `
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

      function isTextMessageNotification(entry) {
        return Boolean(entry && entry.isTextMessage === true);
      }

      function notificationLifetimeMs(entry) {
        if (isTextMessageNotification(entry)) {
          return MESSAGE_NOTIFICATION_TTL_MS + TEXT_MESSAGE_NOTIFICATION_EXTRA_TTL_MS;
        }
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

      function toastAnimationDurationMs(entry) {
        if (Number.isFinite(entry && entry.floatDurationMs)) {
          return Math.max(900, Math.round(Number(entry.floatDurationMs)));
        }
        return isTextMessageNotification(entry)
          ? TEXT_MESSAGE_TOAST_FLOAT_ANIMATION_MS
          : TOAST_FLOAT_ANIMATION_MS;
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
        if (Array.isArray(entry && entry.stackItems) && entry.stackItems.length > 0) {
          return entry.stackItems
            .filter((item) => item && item.kind === "command")
            .map((item) => commandLineText(item.text || item.title || ""))
            .filter((line) => !isSuppressedCommandToastTitle(line))
            .slice(-3);
        }
        if (Array.isArray(entry && entry.commandLines) && entry.commandLines.length > 0) {
          return entry.commandLines
            .map((line) => commandLineText(line))
            .filter((line) => !isSuppressedCommandToastTitle(line))
            .slice(-3);
        }
        const title = commandLineText(entry && entry.title ? entry.title : "");
        return isSuppressedCommandToastTitle(title) ? [] : [title];
      }

      function toastLineDisplayText(line) {
        if (line && typeof line === "object" && !Array.isArray(line)) {
          return stackableToastLineText(line.text || line.title || "", NOTIFICATION_PRIORITY_DEFAULT);
        }
        return stackableToastLineText(line || "", NOTIFICATION_PRIORITY_DEFAULT);
      }

      function stackItemForEntry(entry) {
        if (entry && entry.isCommand) {
          const text = commandLineText(entry.title || "");
          if (isSuppressedCommandToastTitle(text)) {
            return null;
          }
          return {
            id: entry && entry.id ? entry.id : null,
            text,
            title: text,
            kind: "command",
            linesAdded: null,
            linesRemoved: null
          };
        }
        const priority = notificationPriorityValue(entry);
        const title = stackableToastLineText(entry && entry.title ? entry.title : "", priority);
        if (!title) {
          return null;
        }
        const label = shortenNotificationText(entry && entry.label ? entry.label : "", 18);
        const text = entry && entry.isFileChange && label ? label + " " + title : title;
        return {
          id: entry && entry.id ? entry.id : null,
          text,
          title,
          kind: "toast",
          linesAdded: Number.isFinite(entry && entry.linesAdded) ? Number(entry.linesAdded) : null,
          linesRemoved: Number.isFinite(entry && entry.linesRemoved) ? Number(entry.linesRemoved) : null
        };
      }

      function stackItemsForEntry(entry) {
        if (Array.isArray(entry && entry.stackItems) && entry.stackItems.length > 0) {
          return entry.stackItems
            .map((item) => {
              const isCommandItem = item && item.kind === "command";
              const text = isCommandItem
                ? commandLineText(item.text || item.title || "")
                : toastLineDisplayText(item);
              if (!text || (isCommandItem && isSuppressedCommandToastTitle(text))) {
                return null;
              }
              return {
                id: item && item.id ? item.id : null,
                text,
                title: isCommandItem
                  ? text
                  : stackableToastLineText(item && item.title ? item.title : text, notificationPriorityValue(entry)),
                kind: isCommandItem ? "command" : "toast",
                linesAdded: isCommandItem ? null : (Number.isFinite(item && item.linesAdded) ? Number(item.linesAdded) : null),
                linesRemoved: isCommandItem ? null : (Number.isFinite(item && item.linesRemoved) ? Number(item.linesRemoved) : null)
              };
            })
            .filter(Boolean)
            .slice(-3);
        }
        const item = stackItemForEntry(entry);
        return item ? [item] : [];
      }

      function stackableToastItemForEntry(entry) {
        const item = stackItemForEntry(entry);
        return item && item.kind === "toast" ? item : null;
      }

      function stackableToastItemsForEntry(entry) {
        if (Array.isArray(entry && entry.stackItems) && entry.stackItems.length > 0) {
          return stackItemsForEntry(entry).filter((item) => item.kind !== "command");
        }
        if (Array.isArray(entry && entry.toastItems) && entry.toastItems.length > 0) {
          return entry.toastItems
            .map((item) => {
              const text = toastLineDisplayText(item);
              if (!text) {
                return null;
              }
              return {
                id: item && item.id ? item.id : null,
                text,
                title: stackableToastLineText(item && item.title ? item.title : text, notificationPriorityValue(entry)),
                linesAdded: Number.isFinite(item && item.linesAdded) ? Number(item.linesAdded) : null,
                linesRemoved: Number.isFinite(item && item.linesRemoved) ? Number(item.linesRemoved) : null
              };
            })
            .filter(Boolean)
            .slice(-3);
        }
        const item = stackableToastItemForEntry(entry);
        return item ? [item] : [];
      }

      function notificationLine(descriptor) {
        const isMessageToast = notificationPriorityValue(descriptor) >= NOTIFICATION_PRIORITY_MESSAGE;
        const label = descriptor.labelIconUrl && !isMessageToast ? "" : shortenNotificationText(descriptor.label || "", 18);
        const commandLines = descriptor.isCommand ? commandLinesForEntry(descriptor) : [];
        const toastItems = descriptor.isCommand ? [] : stackableToastItemsForEntry(descriptor);
        const isStackedFileChange = descriptor.isFileChange === true && toastItems.length > 1;
        const title = descriptor.isCommand
          ? (commandLines[commandLines.length - 1] || "")
          : ((toastItems[toastItems.length - 1] && toastItems[toastItems.length - 1].title) || "");
        return {
          label: isStackedFileChange ? "" : label,
          title,
          commandLines,
          toastItems,
          labelIconUrl: isMessageToast ? null : (descriptor.labelIconUrl || null),
          isCommand: descriptor.isCommand === true,
          linesAdded: Number.isFinite(descriptor.linesAdded) ? descriptor.linesAdded : null,
          linesRemoved: Number.isFinite(descriptor.linesRemoved) ? descriptor.linesRemoved : null,
          isStackedFileChange
        };
      }

      function notificationDescriptorFromEvent(snapshot, event) {
        if (!event) {
          return null;
        }
        const userMessageMethod = typeof event.method === "string" ? event.method : "";
        const isUserMessageEvent =
          event.kind === "message"
          && (
            event.itemType === "user_message"
            || event.itemType === "userMessage"
            || userMessageMethod === "cursor/local/prompt"
            || userMessageMethod === "userMessage"
            || userMessageMethod.endsWith("/userMessage")
          );
        if (isUserMessageEvent) {
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
                isTextMessage: false,
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
              isTextMessage: true,
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
          if (!Number.isFinite(timestamp) || now - timestamp > MESSAGE_NOTIFICATION_TTL_MS + TEXT_MESSAGE_NOTIFICATION_EXTRA_TTL_MS) {
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
        if (!entry || entry.imageUrl) {
          return null;
        }
        if (entry.isCommand === true) {
          return [
            entry.projectRoot,
            entry.key,
            entry.anchor || "agent",
            "command"
          ].join("::");
        }
        if (entry.isFileChange === true) {
          return [
            entry.projectRoot,
            entry.key,
            entry.anchor || "agent",
            "file"
          ].join("::");
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
          entry.isFileChange ? (entry.id || "") : "",
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
        if (entry && entry.isFileChange && line && typeof line === "object" && line.id) {
          const scope = notificationStackKey(entry)
            || ["toast", entry.projectRoot, entry.key, entry.kindClass || "", entry.anchor || "agent"].join("::");
          return scope + "::id::" + line.id;
        }
        const normalizedLine = normalizeToastLineFingerprint(toastLineDisplayText(line));
        if (!normalizedLine) {
          return null;
        }
        const scope = entry.isCommand
          ? ["command", entry.projectRoot, entry.key, entry.anchor || "agent"].join("::")
          : notificationStackKey(entry) || ["toast", entry.projectRoot, entry.key, entry.kindClass || "", entry.anchor || "agent"].join("::");
        return scope + "::" + normalizedLine;
      }

      function hasEquivalentToastLine(lines, nextLine) {
        if (nextLine && typeof nextLine === "object" && nextLine.id) {
          return lines.some((line) => line && typeof line === "object" && line.id === nextLine.id);
        }
        const normalizedNextLine = normalizeToastLineFingerprint(toastLineDisplayText(nextLine));
        if (!normalizedNextLine) {
          return false;
        }
        return lines.some((line) => normalizeToastLineFingerprint(toastLineDisplayText(line)) === normalizedNextLine);
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
        const base = notificationLifetimeMs(entry);
        return base + Math.max(0, lineCount - 1) * 900;
      }

      function stackedNotificationLifetimeMs(entry, lineCount) {
        return entry && entry.isCommand
          ? commandNotificationLifetimeMs(lineCount)
          : stackableNotificationLifetimeMs(entry, lineCount);
      }

      function resetToastMotion(entry, now) {
        if (!entry) {
          return;
        }
        const expiresAt = notificationExpiresAt(entry);
        entry.motionStartedAt = now;
        entry.floatDurationMs = Math.max(900, expiresAt - now);
      }

      function mergeStackableNotification(entry, now) {
        const stackKey = notificationStackKey(entry);
        if (!stackKey) {
          return false;
        }

        const nextItem = stackItemForEntry(entry);
        if (!nextItem) {
          return false;
        }

        const existing = notifications.find((candidate) =>
          candidate.stackKey === stackKey
          && now < notificationExpiresAt(candidate)
        );

        if (!existing) {
          return false;
        }

        const previousItems = stackItemsForEntry(existing);
        if (hasEquivalentToastLine(previousItems, nextItem) || hasRecentlySeenToastLine(existing, nextItem, now)) {
          return false;
        }
        const shouldAppend = true;
        const mergedItems = shouldAppend ? [...previousItems, nextItem].slice(-3) : previousItems.slice(-3);

        existing.kindClass = entry.kindClass;
        existing.label = entry.label;
        existing.title = entry.title;
        existing.labelIconUrl = entry.labelIconUrl;
        existing.imageUrl = entry.imageUrl;
        existing.anchor = entry.anchor;
        existing.isFileChange = entry.isFileChange === true;
        existing.isCommand = entry.isCommand === true;
        existing.priority = Number.isFinite(entry.priority) ? Number(entry.priority) : NOTIFICATION_PRIORITY_DEFAULT;
        existing.linesAdded = entry.isCommand ? null : (Number.isFinite(entry.linesAdded) ? Number(entry.linesAdded) : null);
        existing.linesRemoved = entry.isCommand ? null : (Number.isFinite(entry.linesRemoved) ? Number(entry.linesRemoved) : null);
        existing.semanticKey = entry.semanticKey;
        existing.stackItems = mergedItems;
        existing.toastItems = mergedItems;
        existing.commandLines = mergedItems.filter((item) => item.kind === "command").map((item) => item.text);
        existing.stackKey = stackKey;
        existing.expiresAt = now + stackedNotificationLifetimeMs(existing, mergedItems.length);
        resetToastMotion(existing, now);
        if (shouldAppend) {
          existing.lastToastLine = nextItem.text;
          existing.lastToastLineAt = now;
          rememberToastLine(existing, nextItem, now);
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

        const initialStackItems = stackItemsForEntry({ ...entry, priority });
        if (initialStackItems.length > 0 && hasRecentlySeenToastLine({ ...entry, priority }, initialStackItems[initialStackItems.length - 1], now)) {
          return false;
        }

        notifications.push({
          ...entry,
          priority,
          createdAt: now,
          stackItems: initialStackItems,
          toastItems: initialStackItems.filter((item) => item.kind !== "command"),
          commandLines: initialStackItems.filter((item) => item.kind === "command").map((item) => item.text),
          stackKey: notificationStackKey({ ...entry, priority }),
          expiresAt: now + stackedNotificationLifetimeMs({ ...entry, priority }, 1)
        });
        resetToastMotion(notifications[notifications.length - 1], now);
        rememberNotificationFingerprint({ ...entry, priority }, now);
        triggerWorkstationFileChangeEffect(entry);
        if (initialStackItems.length > 0) {
          rememberToastLine({ ...entry, priority }, initialStackItems[initialStackItems.length - 1], now);
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
            const left = rect.left - wrapperRect.left + rect.width / 2;
            const top = entry.anchor === "workstation"
              ? rect.top - wrapperRect.top + rect.height * 0.46 - stackIndex * 20
              : rect.top - wrapperRect.top - stackIndex * (entry.isCommand ? 28 : 18);
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

            const className = \`agent-toast \${entry.kindClass}\${entry.imageUrl ? " image" : ""}\${entry.isFileChange ? " file-change" : ""}\${entry.isCommand ? " command-window" : ""}\${!entry.isCommand && Number(entry.priority) >= NOTIFICATION_PRIORITY_MESSAGE ? " message-toast" : ""}\${isTextMessageNotification(entry) ? " text-message-toast" : ""}\`;
            if (toast.className !== className) {
              toast.className = className;
            }

            const nextStyle = \`left:\${Math.round(left)}px; top:\${Math.round(top)}px;\`;
            if (toast.getAttribute("style") !== nextStyle) {
              toast.setAttribute("style", nextStyle);
            }
            const nextAnimationDuration = Math.round(toastAnimationDurationMs(entry)) + "ms";
            if (toast.style.animationDuration !== nextAnimationDuration) {
              toast.style.animationDuration = nextAnimationDuration;
            }
            if (toast.style.animationDelay !== "0ms") {
              toast.style.animationDelay = "0ms";
            }
            const nextMotionToken = String(
              Number.isFinite(entry.motionStartedAt)
                ? Number(entry.motionStartedAt)
                : Number(entry.createdAt) || 0
            );
            if (toast.dataset.motionToken !== nextMotionToken) {
              toast.style.animationName = "none";
              void toast.offsetWidth;
              toast.style.animationName = "agent-toast-float";
              toast.dataset.motionToken = nextMotionToken;
            }

            const statsHtml =
              line.linesAdded !== null || line.linesRemoved !== null
                ? \`<div class="agent-toast-stats">\${line.linesAdded !== null ? \`<span class="agent-toast-delta add">+\${line.linesAdded}</span>\` : ""}\${line.linesRemoved !== null ? \`<span class="agent-toast-delta remove">-\${line.linesRemoved}</span>\` : ""}</div>\`
                : "";
            const commandLinesHtml = line.commandLines.map((commandLine, index) =>
              \`<div class="agent-toast-command-line"><span class="agent-toast-command-prefix">&gt; </span>\${escapeHtml(commandLine)}\${index === line.commandLines.length - 1 ? \`<span class="agent-toast-command-cursor">_</span>\` : ""}</div>\`
            ).join("");
            const toastLinesHtml = line.toastItems.map((toastItem) =>
              \`<div class="agent-toast-line\${toastItem.linesAdded !== null || toastItem.linesRemoved !== null ? " with-stats" : ""}"><span class="agent-toast-line-text">\${escapeHtml(toastItem.text)}</span>\${toastItem.linesAdded !== null || toastItem.linesRemoved !== null ? \`<div class="agent-toast-stats">\${toastItem.linesAdded !== null ? \`<span class="agent-toast-delta add">+\${toastItem.linesAdded}</span>\` : ""}\${toastItem.linesRemoved !== null ? \`<span class="agent-toast-delta remove">-\${toastItem.linesRemoved}</span>\` : ""}</div>\` : ""}</div>\`
            ).join("");
            const nextHtml = entry.isCommand
              ? \`<div class="agent-toast-window-bar"><div class="agent-toast-window-label">cmd.exe</div><div class="agent-toast-window-lights"><span></span><span></span><span></span></div></div><div class="agent-toast-window-body"><pre class="agent-toast-command">\${commandLinesHtml}</pre></div>\`
              : \`<div class="agent-toast-copy"><div class="agent-toast-head">\${line.labelIconUrl || line.label ? \`<div class="agent-toast-label-group">\${line.labelIconUrl ? \`<img class="agent-toast-label-icon" src="\${escapeHtml(line.labelIconUrl)}" alt="" />\` : ""}\${line.label ? \`<div class="agent-toast-label">\${escapeHtml(line.label)}</div>\` : ""}</div>\` : ""}<div class="\${line.toastItems.length > 1 ? "agent-toast-lines" : "agent-toast-title"}">\${line.toastItems.length > 1 ? toastLinesHtml : escapeHtml(line.title)}</div></div>\${line.toastItems.length > 1 ? "" : statsHtml}</div>\${entry.imageUrl ? \`<img class="agent-toast-preview" src="\${escapeHtml(entry.imageUrl)}" alt="\${escapeHtml(entry.title)}" />\` : ""}\`;
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

`;
