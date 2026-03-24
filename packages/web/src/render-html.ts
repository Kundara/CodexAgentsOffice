import { renderClientScript } from "./client-script";
import { CLIENT_STYLES } from "./client-styles";
import { PIXEL_OFFICE_EVENT_ICON_URLS, PIXEL_OFFICE_MANIFEST, PIXEL_OFFICE_THREAD_ITEM_ICON_URLS } from "./pixel-office";
import type { ServerOptions } from "./server-types";

export function renderHtml(options: ServerOptions): string {
  const projectsJson = JSON.stringify(options.projects);
  const pixelOfficeJson = JSON.stringify(PIXEL_OFFICE_MANIFEST);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agents Office Tower</title>
    <style>${CLIENT_STYLES}</style>
  </head>
  <body>
    <div id="fleet-sky-backdrop" class="fleet-sky-backdrop" aria-hidden="true">
      <div class="fleet-sky-layer fleet-sky-glow"></div>
      <div class="fleet-sky-layer fleet-sky-bands"></div>
      <div class="fleet-cloud-layer fleet-cloud-layer-far">
        <div class="pixel-cloud cloud-a" style="left:6%; top:180px; width:168px; height:84px;"></div>
        <div class="pixel-cloud cloud-b" style="left:68%; top:220px; width:184px; height:92px;"></div>
        <div class="pixel-cloud cloud-c" style="left:28%; top:360px; width:208px; height:98px;"></div>
      </div>
      <div class="fleet-cloud-layer fleet-cloud-layer-mid">
        <div class="pixel-cloud cloud-c" style="left:12%; top:300px; width:196px; height:94px;"></div>
        <div class="pixel-cloud cloud-a" style="left:57%; top:420px; width:184px; height:90px;"></div>
        <div class="pixel-cloud cloud-b" style="left:81%; top:200px; width:148px; height:74px;"></div>
      </div>
      <div class="fleet-cloud-layer fleet-cloud-layer-near">
        <div class="pixel-cloud cloud-b" style="left:4%; top:500px; width:212px; height:104px;"></div>
        <div class="pixel-cloud cloud-a" style="left:38%; top:240px; width:232px; height:110px;"></div>
        <div class="pixel-cloud cloud-c" style="left:74%; top:460px; width:244px; height:118px;"></div>
      </div>
    </div>
    <div class="page">
      <section class="hero">
        <div class="hero-top">
          <div class="hero-copy">
            <div class="muted">Codex + Claude + Cursor workspace observer</div>
            <div class="hero-title-row">
              <h1>Agents Office Tower</h1>
              <div id="hero-summary" class="hero-summary"></div>
            </div>
            <div id="stamp" class="muted">Loading…</div>
          </div>
          <div class="hero-actions">
            <div class="view-toggle">
              <button id="map-view-button" data-view="map">Map</button>
              <button id="terminal-view-button" data-view="terminal">Terminal</button>
            </div>
            <button id="refresh-button">Refresh</button>
            <button id="preview-toasts-button">Preview Toasts</button>
            <button id="scaffold-button">Scaffold Rooms XML</button>
            <div id="connection-pill" class="status-pill state-connecting">Connecting</div>
          </div>
        </div>
        <div class="tabs-shell">
          <div class="tabs-head">
            <strong>Workspaces</strong>
            <div class="tabs-actions">
              <span class="muted" id="project-count"></span>
            </div>
          </div>
          <div id="project-tabs" class="project-tabs"></div>
        </div>
      </section>

      <section class="layout">
        <main id="workspace-panel" class="panel workspace-panel">
          <div class="panel-header">
            <strong id="center-title">Fleet</strong>
            <div class="panel-actions">
              <button id="workspace-focus-button" class="toggle-button" type="button" hidden aria-pressed="false" title="Expand selected workspace (F)">[] Expand</button>
            </div>
          </div>
          <div class="panel-body">
            <div id="center-content"></div>
          </div>
        </main>

        <aside id="session-panel" class="panel">
          <div class="panel-header">
            <strong>Sessions</strong>
            <span id="rooms-path" class="muted"></span>
          </div>
          <div id="session-list" class="panel-body session-list"></div>
        </aside>
      </section>
    </div>

    <script>${renderClientScript({
      projectsJson,
      pixelOfficeJson,
      eventIconUrlsJson: JSON.stringify(PIXEL_OFFICE_EVENT_ICON_URLS),
      threadItemIconUrlsJson: JSON.stringify(PIXEL_OFFICE_THREAD_ITEM_ICON_URLS)
    })}</script>
  </body>
</html>`;
}
