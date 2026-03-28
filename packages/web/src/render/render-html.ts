import { PIXEL_OFFICE_EVENT_ICON_URLS, PIXEL_OFFICE_MANIFEST, PIXEL_OFFICE_THREAD_ITEM_ICON_URLS } from "../pixel-office";
import { DEFAULT_GLOBAL_SCENE_SETTINGS, INTERNAL_SCENE_SETTINGS } from "../scene-config";
import { SERVER_BUILD_AT } from "../server/server-metadata";
import type { ProjectDescriptor, ServerOptions } from "../server/server-types";

export function renderHtml(
  options: ServerOptions,
  projects: ProjectDescriptor[] = options.projects
): string {
  const assetVersion = encodeURIComponent(SERVER_BUILD_AT);
  const clientConfigJson = JSON.stringify({
    projects,
    pixelOffice: PIXEL_OFFICE_MANIFEST,
    eventIconUrls: PIXEL_OFFICE_EVENT_ICON_URLS,
    threadItemIconUrls: PIXEL_OFFICE_THREAD_ITEM_ICON_URLS,
    defaultGlobalSceneSettings: DEFAULT_GLOBAL_SCENE_SETTINGS,
    internalSceneSettings: INTERNAL_SCENE_SETTINGS
  });

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agents Office Tower</title>
    <link rel="stylesheet" href="/client/app.css?v=${assetVersion}" />
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
            <button
              id="split-worktrees-button"
              class="toggle-button"
              type="button"
              aria-pressed="false"
              title="Show each worktree on its own floor"
            >
              Split Worktrees
            </button>
            <div class="settings-shell">
              <button
                id="settings-button"
                class="toggle-button"
                type="button"
                data-action="toggle-settings"
                aria-haspopup="dialog"
                aria-expanded="false"
                aria-controls="settings-popup"
              >
                Settings
              </button>
              <div id="settings-popup" class="settings-popup" role="dialog" aria-modal="false" aria-labelledby="settings-title" hidden>
                <div class="settings-popup-header">
                  <strong id="settings-title">Scene Settings</strong>
                  <button id="settings-close-button" type="button" data-action="close-settings">Close</button>
                </div>
                <div class="settings-popup-body">
                  <label class="text-scale-control" for="text-scale-input">
                    <span class="muted">Text size</span>
                    <input
                      id="text-scale-input"
                      type="range"
                      min="${INTERNAL_SCENE_SETTINGS.minTextScale}"
                      max="${INTERNAL_SCENE_SETTINGS.maxTextScale}"
                      step="0.05"
                      value="${DEFAULT_GLOBAL_SCENE_SETTINGS.textScale}"
                    />
                    <output id="text-scale-output">${DEFAULT_GLOBAL_SCENE_SETTINGS.textScale.toFixed(2)}x</output>
                  </label>
                  <div class="settings-section">
                    <strong>Cursor</strong>
                    <label class="settings-field" for="cursor-api-key-input">
                      <span class="muted">API Key</span>
                      <input
                        id="cursor-api-key-input"
                        type="password"
                        placeholder="cursor_..."
                        spellcheck="false"
                        autocapitalize="off"
                        autocomplete="off"
                      />
                    </label>
                    <div class="settings-note muted">
                      Local Cursor sessions are inferred automatically for repos opened in the Cursor app on this machine. Save a Cursor API key here only if you also want Cursor Cloud/Background Agents.
                    </div>
                    <div class="settings-actions">
                      <button id="cursor-api-key-save-button" class="toggle-button settings-toggle" type="button">Save Key</button>
                      <button id="cursor-api-key-clear-button" class="toggle-button settings-toggle" type="button">Clear Saved Key</button>
                    </div>
                    <div id="cursor-api-key-status" class="settings-note muted">Loading Cursor integration status...</div>
                  </div>
                  <div class="settings-section">
                    <strong>Shared Room</strong>
                    <button id="multiplayer-enabled-button" class="toggle-button settings-toggle" type="button" aria-pressed="false">Sharing Off</button>
                    <label class="settings-field" for="multiplayer-host-input">
                      <span class="muted">Host</span>
                      <input
                        id="multiplayer-host-input"
                        type="text"
                        placeholder="your-app.partykit.dev"
                        spellcheck="false"
                        autocapitalize="off"
                        autocomplete="off"
                      />
                    </label>
                    <label class="settings-field" for="multiplayer-room-input">
                      <span class="muted">Room</span>
                      <input
                        id="multiplayer-room-input"
                        type="text"
                        placeholder="team/project-name"
                        spellcheck="false"
                        autocapitalize="off"
                        autocomplete="off"
                      />
                    </label>
                    <label class="settings-field" for="multiplayer-nickname-input">
                      <span class="muted">Nickname</span>
                      <input
                        id="multiplayer-nickname-input"
                        type="text"
                        placeholder="octocat"
                        maxlength="12"
                        spellcheck="false"
                        autocapitalize="off"
                        autocomplete="off"
                      />
                    </label>
                    <div id="multiplayer-status" class="settings-note muted">Shared room sync is off.</div>
                  </div>
                  <button id="debug-tiles-button" class="toggle-button settings-toggle" type="button" aria-pressed="false">Debug Tiles</button>
                </div>
              </div>
            </div>
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

    <script src="/vendor/pixi.min.js"></script>
    <script src="/vendor/easystar.min.js"></script>
    <script>window.__AGENTS_OFFICE_CLIENT_CONFIG__ = ${clientConfigJson};</script>
    <script src="/client/app.js?v=${assetVersion}"></script>
  </body>
</html>`;
}
