import * as vscode from "vscode";

import {
  buildDashboardSnapshot,
  cycleAgentAppearance,
  filterSnapshotToCurrentWorkload,
  getRoomsFilePath,
  scaffoldRoomsFile,
  type DashboardSnapshot
} from "@codex-agents-office/core";

const VIEW_ID = "codexAgentsOffice.view";
const REFRESH_COMMAND = "codexAgentsOffice.refresh";
const OPEN_ROOMS_XML_COMMAND = "codexAgentsOffice.openRoomsXml";
const SCAFFOLD_ROOMS_XML_COMMAND = "codexAgentsOffice.scaffoldRoomsXml";

class OfficeViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });

    void this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, 5000);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async refresh(): Promise<void> {
    const projectRoot = this.getProjectRoot();
    if (!projectRoot) {
      await this.postMessage({
        type: "snapshot",
        snapshot: null,
        roomsFilePath: null,
        projectRoot: null
      });
      return;
    }

    try {
      const snapshot = filterSnapshotToCurrentWorkload(await buildDashboardSnapshot({
        projectRoot,
        includeCloud: true
      }));
      await this.postMessage({
        type: "snapshot",
        snapshot,
        roomsFilePath: getRoomsFilePath(projectRoot),
        projectRoot
      });
    } catch (error) {
      await this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async openRoomsXml(scaffoldIfMissing: boolean): Promise<void> {
    const projectRoot = this.getProjectRoot();
    if (!projectRoot) {
      return;
    }

    const filePath = scaffoldIfMissing
      ? await scaffoldRoomsFile(projectRoot)
      : getRoomsFilePath(projectRoot);

    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private getProjectRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private async handleMessage(message: { type?: string; [key: string]: unknown }): Promise<void> {
    const projectRoot = this.getProjectRoot();
    switch (message.type) {
      case "ready":
      case "refresh":
        await this.refresh();
        return;
      case "openRoomsXml":
        await this.openRoomsXml(false);
        return;
      case "scaffoldRoomsXml":
        await this.openRoomsXml(true);
        return;
      case "resumeThread":
        if (projectRoot && typeof message.threadId === "string") {
          const terminal = vscode.window.createTerminal({
            name: `Codex Resume ${message.threadId.slice(0, 8)}`,
            cwd: projectRoot
          });
          terminal.show();
          terminal.sendText(`codex resume ${message.threadId}`);
        }
        return;
      case "openCloudTask":
        if (typeof message.url === "string") {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        return;
      case "cycleAppearance":
        if (projectRoot && typeof message.agentId === "string") {
          await cycleAgentAppearance(projectRoot, message.agentId);
          await this.refresh();
        }
        return;
      default:
        return;
    }
  }

  private async postMessage(payload: Record<string, unknown>): Promise<void> {
    await this.view?.webview.postMessage(payload);
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agents Office Tower</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f1714;
        --panel: #14211c;
        --panel-2: #1a2d25;
        --border: #315143;
        --text: #f5efdd;
        --muted: #b0c0b7;
        --accent: #4bd69f;
        --danger: #f06d5e;
        --tile: 24px;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(75, 214, 159, 0.12), transparent 28%),
          linear-gradient(180deg, #0b130f 0%, #111b17 100%);
        color: var(--text);
        font-family: "Cascadia Code", "IBM Plex Mono", monospace;
      }

      button {
        cursor: pointer;
        border: 1px solid var(--border);
        background: var(--panel-2);
        color: var(--text);
        padding: 8px 10px;
        font: inherit;
      }

      button:hover {
        border-color: var(--accent);
      }

      .app {
        display: grid;
        grid-template-columns: minmax(0, 2.2fr) minmax(280px, 1fr);
        gap: 12px;
        padding: 12px;
      }

      .panel {
        border: 1px solid var(--border);
        background: rgba(20, 33, 28, 0.92);
        backdrop-filter: blur(8px);
      }

      .toolbar {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
      }

      .toolbar-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .scene {
        position: relative;
        padding: 12px;
        min-height: 520px;
      }

      .scene-grid {
        position: relative;
        min-height: 480px;
        border: 1px dashed rgba(176, 192, 183, 0.25);
        background:
          linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
        background-size: var(--tile) var(--tile);
      }

      .room {
        position: absolute;
        border: 2px solid #4a7865;
        background: rgba(49, 81, 67, 0.22);
        overflow: hidden;
      }

      .room-header {
        padding: 4px 6px;
        font-size: 11px;
        border-bottom: 1px solid rgba(245, 239, 221, 0.12);
        background: rgba(17, 31, 25, 0.65);
      }

      .agent {
        position: absolute;
        width: 18px;
        height: 18px;
        border: 2px solid rgba(0, 0, 0, 0.45);
        image-rendering: pixelated;
        box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.3);
      }

      .agent::after {
        content: "";
        position: absolute;
        inset: 4px;
        background: var(--accentColor);
      }

      .sidebar {
        display: flex;
        flex-direction: column;
        min-height: 520px;
      }

      .section {
        padding: 12px;
        border-top: 1px solid var(--border);
      }

      .section:first-of-type {
        border-top: none;
      }

      .meta {
        color: var(--muted);
        font-size: 12px;
      }

      .list {
        display: grid;
        gap: 8px;
        margin-top: 10px;
      }

      .card {
        border: 1px solid var(--border);
        background: rgba(26, 45, 37, 0.9);
        padding: 10px;
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 6px;
        border: 1px solid rgba(245, 239, 221, 0.14);
        background: rgba(255, 255, 255, 0.04);
        font-size: 11px;
      }

      .swatch {
        width: 10px;
        height: 10px;
        border: 1px solid rgba(0, 0, 0, 0.4);
      }

      .card-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
        flex-wrap: wrap;
      }

      .notes {
        white-space: pre-wrap;
        color: var(--muted);
        font-size: 12px;
      }

      .empty {
        padding: 18px;
        color: var(--muted);
      }

      @media (max-width: 960px) {
        .app {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <section class="panel">
        <div class="toolbar">
          <div>
            <div><strong>Agents Office Tower</strong></div>
            <div id="scene-meta" class="meta">Loading…</div>
          </div>
          <div class="toolbar-actions">
            <button data-action="refresh">Refresh</button>
            <button data-action="openRoomsXml">Open Rooms XML</button>
            <button data-action="scaffoldRoomsXml">Scaffold XML</button>
          </div>
        </div>
        <div class="scene">
          <div id="scene-grid" class="scene-grid"></div>
        </div>
      </section>
      <aside class="panel sidebar">
        <div class="toolbar">
          <div>
            <div><strong>Sessions</strong></div>
            <div id="rooms-path" class="meta"></div>
          </div>
        </div>
        <div class="section">
          <div class="meta">Showing current workload only. Use the web view for older session history.</div>
          <div id="session-list" class="list"></div>
        </div>
        <div class="section">
          <div><strong>Notes</strong></div>
          <div id="notes" class="notes">No notes.</div>
        </div>
      </aside>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = {
        snapshot: null,
        roomsFilePath: null,
        projectRoot: null
      };

      const sceneMeta = document.getElementById("scene-meta");
      const sceneGrid = document.getElementById("scene-grid");
      const sessionList = document.getElementById("session-list");
      const roomsPath = document.getElementById("rooms-path");
      const notesEl = document.getElementById("notes");

      document.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }

        const action = target.dataset.action;
        if (action === "refresh" || action === "openRoomsXml" || action === "scaffoldRoomsXml") {
          vscode.postMessage({ type: action });
          return;
        }

        if (action === "resumeThread") {
          vscode.postMessage({ type: "resumeThread", threadId: target.dataset.threadId });
          return;
        }

        if (action === "openCloudTask") {
          vscode.postMessage({ type: "openCloudTask", url: target.dataset.url });
          return;
        }

        if (action === "cycleAppearance") {
          vscode.postMessage({ type: "cycleAppearance", agentId: target.dataset.agentId });
        }
      });

      function flattenRooms(rooms) {
        const output = [];
        const queue = [...rooms];
        while (queue.length > 0) {
          const room = queue.shift();
          output.push(room);
          if (Array.isArray(room.children)) {
            queue.unshift(...room.children);
          }
        }
        return output.sort((left, right) => (left.width * left.height) - (right.width * right.height));
      }

      function formatAgentState(agent) {
        return \`[\${agent.state}] \${agent.detail}\`;
      }

      function renderScene(snapshot) {
        const rooms = flattenRooms(snapshot.rooms.rooms);
        if (rooms.length === 0) {
          sceneGrid.innerHTML = '<div class="empty">No rooms configured.</div>';
          return;
        }

        const maxX = Math.max(...rooms.map((room) => room.x + room.width), 24);
        const maxY = Math.max(...rooms.map((room) => room.y + room.height), 16);
        const tile = 24;

        sceneGrid.style.width = \`\${maxX * tile}px\`;
        sceneGrid.style.height = \`\${maxY * tile}px\`;

        const roomHtml = rooms.map((room) => {
          const occupants = snapshot.agents.filter((agent) => agent.roomId === room.id);
          const slotsPerRow = Math.max(1, Math.floor((room.width * tile - 12) / 22));
          const agentHtml = occupants.map((agent, index) => {
            const column = index % slotsPerRow;
            const row = Math.floor(index / slotsPerRow);
            const left = 6 + column * 22;
            const top = 28 + row * 22;
            const title = \`\${agent.label} - \${agent.detail}\`;
            return \`
              <div
                class="agent"
                title="\${title}"
                style="left:\${left}px; top:\${top}px; background:\${agent.appearance.body}; --accentColor: \${agent.appearance.accent};"
              ></div>
            \`;
          }).join("");

          return \`
            <div class="room" style="left:\${room.x * tile}px; top:\${room.y * tile}px; width:\${room.width * tile}px; height:\${room.height * tile}px;">
              <div class="room-header">\${room.name} <span class="meta">[\${room.path}]</span></div>
              \${agentHtml}
            </div>
          \`;
        }).join("");

        sceneGrid.innerHTML = roomHtml;
      }

      function renderSessions(snapshot) {
        if (snapshot.agents.length === 0) {
          sessionList.innerHTML = '<div class="empty">No live sessions found for this project right now.</div>';
          return;
        }

        sessionList.innerHTML = snapshot.agents.map((agent) => {
          const room = agent.roomId ?? "cloud";
          const actionButton = agent.threadId
            ? \`<button data-action="resumeThread" data-thread-id="\${agent.threadId}">Resume</button>\`
            : \`<button data-action="openCloudTask" data-url="\${agent.url}">Open</button>\`;

          return \`
            <article class="card">
              <div class="card-header">
                <div>
                  <div><strong>\${agent.label}</strong></div>
                  <div class="meta">\${formatAgentState(agent)}</div>
                </div>
                <span class="chip">
                  <span class="swatch" style="background:\${agent.appearance.body}"></span>
                  \${agent.appearance.label}
                </span>
              </div>
              <div class="meta">room=\${room}</div>
              <div class="meta">\${agent.cwd ?? agent.url ?? ""}</div>
              <div class="card-actions">
                \${actionButton}
                <button data-action="cycleAppearance" data-agent-id="\${agent.id}">Cycle look</button>
              </div>
            </article>
          \`;
        }).join("");
      }

      function renderSnapshot(snapshot, roomsFilePath, projectRoot) {
        state.snapshot = snapshot;
        state.roomsFilePath = roomsFilePath;
        state.projectRoot = projectRoot;

        if (!snapshot) {
          sceneMeta.textContent = "Open a workspace folder to map rooms.";
          roomsPath.textContent = "";
          sceneGrid.innerHTML = '<div class="empty">No workspace open.</div>';
          sessionList.innerHTML = "";
          notesEl.textContent = "";
          return;
        }

        sceneMeta.textContent = \`\${snapshot.projectRoot} · \${snapshot.agents.length} agents\`;
        roomsPath.textContent = roomsFilePath ?? "";
        notesEl.textContent = snapshot.notes.length > 0 ? snapshot.notes.join("\\n") : "No notes.";
        renderScene(snapshot);
        renderSessions(snapshot);
      }

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "snapshot") {
          renderSnapshot(message.snapshot, message.roomsFilePath, message.projectRoot);
        }

        if (message.type === "error") {
          notesEl.textContent = message.message;
        }
      });

      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
  }
}

function createNonce(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 16; index += 1) {
    nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return nonce;
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new OfficeViewProvider(context);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand(REFRESH_COMMAND, () => provider.refresh()),
    vscode.commands.registerCommand(OPEN_ROOMS_XML_COMMAND, () => provider.openRoomsXml(false)),
    vscode.commands.registerCommand(SCAFFOLD_ROOMS_XML_COMMAND, () => provider.openRoomsXml(true))
  );
}

export function deactivate(): void {}
