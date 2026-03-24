import {
  OFFICIAL_CODEX_THREAD_ITEM_TYPES,
  PIXEL_OFFICE_EVENT_ICON_METHODS,
  PIXEL_OFFICE_EVENT_ICON_URLS,
  PIXEL_OFFICE_THREAD_ITEM_ICON_URLS
} from "./pixel-office";

const THREAD_ITEM_LABELS: Record<string, string> = {
  userMessage: "User message",
  agentMessage: "Agent message",
  plan: "Plan",
  reasoning: "Reasoning",
  commandExecution: "Command execution",
  fileChange: "File change",
  mcpToolCall: "MCP tool call",
  dynamicToolCall: "Dynamic tool call",
  collabToolCall: "Collab tool call",
  collabAgentToolCall: "Collab agent tool call",
  webSearch: "Web search",
  imageView: "Image view",
  enteredReviewMode: "Entered review mode",
  exitedReviewMode: "Exited review mode",
  contextCompaction: "Context compaction"
};

const THREAD_ITEM_NOTES: Partial<Record<string, string>> = {
  mcpToolCall: "Uses the refined wrench icon shared with dynamic tool calls.",
  dynamicToolCall: "Uses the refined wrench icon shared with MCP tool calls.",
  collabAgentToolCall: "Legacy compatibility item retained outside the current official list."
};

function renderAuditCards(
  entries: Array<{ id: string; label: string; url: string; note?: string }>
): string {
  return entries
    .map((entry) => `
      <article class="audit-card">
        <div class="audit-icon-shell">
          <img class="audit-icon" src="${entry.url}" alt="${entry.label}" />
        </div>
        <div class="audit-label">${entry.label}</div>
        <code class="audit-id">${entry.id}</code>
        ${entry.note ? `<div class="audit-note">${entry.note}</div>` : ""}
      </article>
    `)
    .join("");
}

export function renderIconAuditHtml(): string {
  const officialThreadItems = OFFICIAL_CODEX_THREAD_ITEM_TYPES.map((type) => ({
    id: type,
    label: THREAD_ITEM_LABELS[type] ?? type,
    url: PIXEL_OFFICE_THREAD_ITEM_ICON_URLS[type],
    note: THREAD_ITEM_NOTES[type]
  }));

  const compatibilityThreadItems = ["collabAgentToolCall"].map((type) => ({
    id: type,
    label: THREAD_ITEM_LABELS[type] ?? type,
    url: PIXEL_OFFICE_THREAD_ITEM_ICON_URLS[type as keyof typeof PIXEL_OFFICE_THREAD_ITEM_ICON_URLS],
    note: THREAD_ITEM_NOTES[type]
  }));

  const methodIcons = PIXEL_OFFICE_EVENT_ICON_METHODS.map((method) => ({
    id: method,
    label: method,
    url: PIXEL_OFFICE_EVENT_ICON_URLS[method]
  }));

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agents Office Tower Icon Audit</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: #fffaf1;
        --ink: #24333c;
        --muted: #6f7d84;
        --border: #d5cab8;
        --accent: #78d787;
        --accent-2: #d8f1ff;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background:
          radial-gradient(circle at top, rgba(216, 241, 255, 0.9), transparent 30%),
          linear-gradient(180deg, #f8f3ea 0%, var(--bg) 100%);
        color: var(--ink);
        font: 14px/1.45 "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      main {
        max-width: 1280px;
        margin: 0 auto;
        padding: 28px 20px 40px;
      }

      h1,
      h2 {
        margin: 0;
        letter-spacing: -0.02em;
      }

      h1 {
        font-size: 28px;
      }

      h2 {
        font-size: 20px;
      }

      p {
        margin: 0;
        color: var(--muted);
      }

      a {
        color: inherit;
      }

      .audit-header,
      .audit-section {
        background: color-mix(in srgb, var(--panel) 92%, white 8%);
        border: 1px solid var(--border);
        border-radius: 18px;
        box-shadow: 0 14px 36px rgba(36, 51, 60, 0.08);
      }

      .audit-header {
        padding: 22px;
        margin-bottom: 18px;
      }

      .audit-header-copy {
        display: grid;
        gap: 8px;
      }

      .audit-pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 12px;
      }

      .audit-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 6px 10px;
        background: var(--accent-2);
        border: 1px solid rgba(36, 51, 60, 0.12);
        color: var(--ink);
      }

      .audit-pill img {
        width: 20px;
        height: 20px;
        image-rendering: pixelated;
      }

      .audit-section {
        padding: 18px;
        margin-bottom: 18px;
      }

      .audit-section-head {
        display: grid;
        gap: 6px;
        margin-bottom: 14px;
      }

      .audit-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
      }

      .audit-card {
        display: grid;
        gap: 10px;
        align-content: start;
        min-height: 170px;
        padding: 14px;
        border-radius: 16px;
        background:
          linear-gradient(180deg, rgba(216, 241, 255, 0.22), rgba(255, 255, 255, 0.92)),
          var(--panel);
        border: 1px solid rgba(36, 51, 60, 0.12);
      }

      .audit-icon-shell {
        display: grid;
        place-items: center;
        width: 84px;
        height: 84px;
        border-radius: 14px;
        background:
          linear-gradient(180deg, rgba(120, 215, 135, 0.18), rgba(216, 241, 255, 0.75)),
          #ffffff;
        border: 1px solid rgba(36, 51, 60, 0.12);
      }

      .audit-icon {
        width: 56px;
        height: 56px;
        image-rendering: pixelated;
      }

      .audit-label {
        font-weight: 600;
      }

      .audit-id {
        display: inline-block;
        padding: 4px 6px;
        border-radius: 8px;
        background: rgba(36, 51, 60, 0.06);
        color: var(--muted);
        overflow-wrap: anywhere;
      }

      .audit-note {
        color: var(--muted);
        font-size: 13px;
      }

      @media (max-width: 720px) {
        main {
          padding: 18px 14px 28px;
        }

        .audit-grid {
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="audit-header">
        <div class="audit-header-copy">
          <h1>Pixel Icon Audit</h1>
          <p>
            Thread-item coverage verified against the current OpenAI Codex app-server docs:
            <a href="https://developers.openai.com/codex/app-server#items">developers.openai.com/codex/app-server#items</a>.
          </p>
          <p>Use this page to inspect the exact icon asset wired for each thread item and runtime toast method.</p>
        </div>
        <div class="audit-pill-row">
          <div class="audit-pill">
            <img src="${PIXEL_OFFICE_EVENT_ICON_URLS["item/tool/call"]}" alt="Tool call" />
            <span>Refined tool execution wrench</span>
          </div>
          <div class="audit-pill">
            <img src="${PIXEL_OFFICE_THREAD_ITEM_ICON_URLS.webSearch}" alt="Web search" />
            <span>Missing thread items now mapped</span>
          </div>
          <div class="audit-pill">
            <img src="${PIXEL_OFFICE_THREAD_ITEM_ICON_URLS.contextCompaction}" alt="Context compaction" />
            <span>Audit route: <code>/icon-audit</code></span>
          </div>
        </div>
      </section>

      <section class="audit-section">
        <div class="audit-section-head">
          <h2>Official Thread Items</h2>
          <p>Every thread item listed in the current docs resolves to a visible icon here.</p>
        </div>
        <div class="audit-grid">
          ${renderAuditCards(officialThreadItems)}
        </div>
      </section>

      <section class="audit-section">
        <div class="audit-section-head">
          <h2>Compatibility Thread Items</h2>
          <p>Legacy or compatibility items still supported by the snapshot pipeline.</p>
        </div>
        <div class="audit-grid">
          ${renderAuditCards(compatibilityThreadItems)}
        </div>
      </section>

      <section class="audit-section">
        <div class="audit-section-head">
          <h2>Runtime Event Method Icons</h2>
          <p>Exact app-server method assets used by typed toast notifications.</p>
        </div>
        <div class="audit-grid">
          ${renderAuditCards(methodIcons)}
        </div>
      </section>
    </main>
  </body>
</html>`;
}
