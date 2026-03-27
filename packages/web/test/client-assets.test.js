const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { renderHtml } = require("../dist/render-html.js");

test("renderHtml loads external client assets and bootstrap config", () => {
  const html = renderHtml({
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/tmp/project", label: "project" }]
  });

  assert.match(html, /<link rel="stylesheet" href="\/client\/app\.css\?v=/);
  assert.match(html, /<script src="\/client\/app\.js\?v=.*"><\/script>/);
  assert.match(html, /window\.__AGENTS_OFFICE_CLIENT_CONFIG__/);
});

test("client runtime does not seat notLoaded local threads at workstations just because they are current", () => {
  const layoutSource = readFileSync(
    join(__dirname, "../src/client/runtime/layout-source.ts"),
    "utf8"
  );

  assert.match(layoutSource, /if \(agent\.statusText === \\"notLoaded\\"\) \{\\n\s+return agent\.isOngoing === true;/);
  assert.match(
    layoutSource,
    /return agent\.statusText !== \\"notLoaded\\" && isDeskLiveLocalState\(agent\.state\);/
  );
});

test("toast renderer keeps the message, file-change, and command toast classes and chrome", () => {
  const toastSource = readFileSync(
    join(__dirname, "../src/client/toast-source.ts"),
    "utf8"
  );

  assert.ok(
    toastSource.includes('const className = \\`agent-toast \\${entry.kindClass}'),
    "toast className should start from the agent-toast base class"
  );
  assert.ok(
    toastSource.includes('entry.isFileChange ? " file-change" : ""'),
    "toast renderer should keep the file-change class toggle"
  );
  assert.ok(
    toastSource.includes('entry.isCommand ? " command-window" : ""'),
    "toast renderer should keep the command-window class toggle"
  );
  assert.ok(
    toastSource.includes('!entry.isCommand && Number(entry.priority) >= NOTIFICATION_PRIORITY_MESSAGE ? " message-toast" : ""'),
    "toast renderer should keep the message-toast class toggle"
  );
  assert.ok(
    toastSource.includes('isTextMessageNotification(entry) ? " text-message-toast" : ""'),
    "toast renderer should keep the text-message-toast class toggle"
  );
  assert.ok(
    toastSource.includes('<div class="agent-toast-window-label">cmd.exe</div>'),
    "command toasts should keep the cmd.exe window chrome"
  );
  assert.ok(
    toastSource.includes('<div class="agent-toast-command-line">'),
    "command toasts should keep per-line command rendering"
  );
  assert.ok(
    toastSource.includes('<span class="agent-toast-delta add">+\\${line.linesAdded}</span>'),
    "file-change toasts should keep added-line deltas"
  );
  assert.ok(
    toastSource.includes('<span class="agent-toast-delta remove">-\\${line.linesRemoved}</span>'),
    "file-change toasts should keep removed-line deltas"
  );
});

test("toast runtime preserves read command summaries and text-message priority", () => {
  const renderSource = readFileSync(
    join(__dirname, "../src/client/runtime/render-source.ts"),
    "utf8"
  );

  assert.match(
    renderSource,
    /if \(executable === \\"sed\\" \|\| executable === \\"cat\\" \|\| executable === \\"head\\" \|\| executable === \\"tail\\" \|\| executable === \\"less\\" \|\| executable === \\"more\\" \|\| executable === \\"bat\\"\) \{\\n\s+title = \\"Read \\" \+ firstPathLabel;/,
  );
  assert.match(
    renderSource,
    /else if \(executable === \\"rg\\" \|\| executable === \\"grep\\"\) \{\\n\s+title =\\n\s+pathTokens\.length > 1 \? \\"Exploring \\" \+ pathTokens\.length \+ \\" files\\"\\n\s+: firstPath \? \\"Search \\" \+ firstPathLabel\\n\s+: \\"Search files\\";/,
  );
  assert.match(
    renderSource,
    /else if \(executable === \\"ls\\" \|\| executable === \\"find\\" \|\| executable === \\"tree\\"\) \{\\n\s+title =\\n\s+pathTokens\.length > 1 \? \\"Exploring \\" \+ pathTokens\.length \+ \\" files\\"\\n\s+: firstPath \? \\"Explore \\" \+ cleanReportedPath\(snapshot\.projectRoot, firstPath\)\\n\s+: \\"Explore files\\";/,
  );
  assert.ok(
    renderSource.includes('if (latestMessageChanged) {\\n          return {'),
    "latest message changes should still build a notification descriptor"
  );
  assert.ok(
    renderSource.includes('isTextMessage: true'),
    "latest message notifications should still be marked as text messages"
  );
  assert.ok(
    renderSource.includes('priority: NOTIFICATION_PRIORITY_MESSAGE'),
    "latest message notifications should still use message priority"
  );
});

test("typed snapshot events still allow message toasts even when the agent is no longer current", () => {
  const toastSource = readFileSync(
    join(__dirname, "../src/client/toast-source.ts"),
    "utf8"
  );

  assert.match(
    toastSource,
    /if \(\n?\s*!agent\.isCurrent\n?\s*&& agent\.state !== "waiting"\n?\s*&& agent\.state !== "blocked"\n?\s*&& event\.kind !== "message"\n?\s*&& !\(event\.kind === "tool" && event\.itemType === "webSearch"\)\n?\s*\) \{/,
  );
});
