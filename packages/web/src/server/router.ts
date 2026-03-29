import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { readJsonBody, notFound, sendAbsoluteFileAsset, sendHtml, sendJson, sendProjectFile, sendStaticAsset } from "../http-helpers";
import { buildServerMeta } from "./server-metadata";
import { renderHtml } from "../render/render-html";
import { renderIconAuditHtml } from "../render/render-icon-audit-html";
import { renderZOrderAuditHtml } from "../render/render-z-order-audit-html";
import type { FleetLiveService } from "./fleet-live-service";
import type { ServerOptions } from "./server-types";

interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  options: ServerOptions;
  service: FleetLiveService;
}

type RouteHandler = (context: RequestContext) => Promise<boolean>;

const PIXI_BROWSER_BUNDLE = resolve(__dirname, "../../../../node_modules/pixi.js/dist/pixi.min.js");
const EASYSTAR_BROWSER_BUNDLE = resolve(__dirname, "../../../../node_modules/easystarjs/bin/easystar-0.4.4.min.js");
const PARTYSOCKET_BROWSER_DIR = resolve(__dirname, "../../../../node_modules/partysocket/dist");
const CLIENT_BUNDLE_DIR = resolve(__dirname, "../client");

function requestMethod(context: RequestContext): string {
  return context.request.method ?? "GET";
}

function matchesMethod(context: RequestContext, ...methods: string[]): boolean {
  return methods.includes(requestMethod(context));
}

async function handleAssetRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || !context.url.pathname.startsWith("/assets/")) {
    return false;
  }

  await sendStaticAsset(
    context.response,
    context.url.pathname.slice("/assets/".length),
    requestMethod(context)
  );
  return true;
}

async function handleHomeRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || context.url.pathname !== "/") {
    return false;
  }

  if (requestMethod(context) === "HEAD") {
    context.response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    context.response.end();
    return true;
  }

  sendHtml(context.response, renderHtml(context.options, await context.service.getProjects()));
  return true;
}

async function handleClientBundleRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || !context.url.pathname.startsWith("/client/")) {
    return false;
  }

  const relativePath = context.url.pathname.slice("/client/".length);
  const filePath = resolve(CLIENT_BUNDLE_DIR, relativePath);
  if (!(filePath === CLIENT_BUNDLE_DIR || filePath.startsWith(CLIENT_BUNDLE_DIR + "/") || filePath.startsWith(CLIENT_BUNDLE_DIR + "\\"))) {
    return false;
  }

  await sendAbsoluteFileAsset(context.response, filePath, requestMethod(context), "no-store");
  return true;
}

async function handleVendorRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD")) {
    return false;
  }

  if (context.url.pathname === "/vendor/pixi.min.js") {
    await sendAbsoluteFileAsset(context.response, PIXI_BROWSER_BUNDLE, requestMethod(context));
    return true;
  }

  if (context.url.pathname === "/vendor/easystar.min.js") {
    await sendAbsoluteFileAsset(context.response, EASYSTAR_BROWSER_BUNDLE, requestMethod(context));
    return true;
  }

  if (context.url.pathname.startsWith("/vendor/partysocket/")) {
    const relativePath = context.url.pathname.slice("/vendor/partysocket/".length);
    const filePath = resolve(PARTYSOCKET_BROWSER_DIR, relativePath);
    if (!(filePath === PARTYSOCKET_BROWSER_DIR || filePath.startsWith(PARTYSOCKET_BROWSER_DIR + "/") || filePath.startsWith(PARTYSOCKET_BROWSER_DIR + "\\"))) {
      return false;
    }
    await sendAbsoluteFileAsset(context.response, filePath, requestMethod(context));
    return true;
  }

  return false;
}

async function handleIconAuditRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || context.url.pathname !== "/icon-audit") {
    return false;
  }

  if (requestMethod(context) === "HEAD") {
    context.response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    context.response.end();
    return true;
  }

  sendHtml(context.response, renderIconAuditHtml());
  return true;
}

async function handleZOrderAuditRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || context.url.pathname !== "/z-order-audit") {
    return false;
  }

  if (requestMethod(context) === "HEAD") {
    context.response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    context.response.end();
    return true;
  }

  sendHtml(context.response, renderZOrderAuditHtml());
  return true;
}

async function handleFleetRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET") || context.url.pathname !== "/api/fleet") {
    return false;
  }

  sendJson(context.response, 200, await context.service.getFleet());
  return true;
}

async function handleServerMetaRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET") || context.url.pathname !== "/api/server-meta") {
    return false;
  }

  sendJson(context.response, 200, buildServerMeta(context.options, await context.service.getProjects(), context.service.getMultiplayerStatus()));
  return true;
}

async function handleMultiplayerStatusRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET") || context.url.pathname !== "/api/multiplayer") {
    return false;
  }
  sendJson(context.response, 200, context.service.getMultiplayerStatus());
  return true;
}

async function handleIntegrationSettingsRoute(context: RequestContext): Promise<boolean> {
  if (context.url.pathname !== "/api/settings/integrations") {
    return false;
  }

  if (matchesMethod(context, "GET")) {
    sendJson(context.response, 200, context.service.getIntegrationSettings());
    return true;
  }

  if (matchesMethod(context, "POST")) {
    const payload = await readJsonBody(context.request);
    const rawCursorApiKey = payload.cursorApiKey;
    if (rawCursorApiKey !== null && typeof rawCursorApiKey !== "string" && typeof rawCursorApiKey !== "undefined") {
      sendJson(context.response, 400, { error: "cursorApiKey must be a string or null" });
      return true;
    }

    const cursorApiKey = typeof rawCursorApiKey === "string" ? rawCursorApiKey : null;
    sendJson(context.response, 200, await context.service.setCursorApiKey(cursorApiKey));
    return true;
  }

  return false;
}

async function handleProjectFileRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET", "HEAD") || context.url.pathname !== "/api/project-file") {
    return false;
  }

  const projectRoot = context.url.searchParams.get("projectRoot");
  const filePath = context.url.searchParams.get("path");
  if (!projectRoot || !filePath) {
    sendJson(context.response, 400, { error: "projectRoot and path are required" });
    return true;
  }

  await sendProjectFile(context.response, projectRoot, filePath, requestMethod(context));
  return true;
}

async function handleEventsRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "GET") || context.url.pathname !== "/api/events") {
    return false;
  }

  context.service.registerSse(context.response);
  return true;
}

async function handleAppearanceRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "POST") || context.url.pathname !== "/api/appearance/cycle") {
    return false;
  }

  const payload = await readJsonBody(context.request);
  if (typeof payload.projectRoot !== "string" || typeof payload.agentId !== "string") {
    sendJson(context.response, 400, { error: "projectRoot and agentId are required" });
    return true;
  }

  await context.service.cycleAppearance(payload.projectRoot, payload.agentId);
  sendJson(context.response, 200, { ok: true });
  return true;
}

async function handleRoomsScaffoldRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "POST") || context.url.pathname !== "/api/rooms/scaffold") {
    return false;
  }

  const payload = await readJsonBody(context.request);
  if (typeof payload.projectRoot !== "string") {
    sendJson(context.response, 400, { error: "projectRoot is required" });
    return true;
  }

  const filePath = await context.service.scaffoldRooms(payload.projectRoot);
  sendJson(context.response, 200, { ok: true, filePath });
  return true;
}

async function handleRefreshRoute(context: RequestContext): Promise<boolean> {
  if (!matchesMethod(context, "POST") || context.url.pathname !== "/api/refresh") {
    return false;
  }

  sendJson(context.response, 200, await context.service.refreshAll());
  return true;
}

const ROUTES: RouteHandler[] = [
  handleAssetRoute,
  handleClientBundleRoute,
  handleVendorRoute,
  handleHomeRoute,
  handleIconAuditRoute,
  handleZOrderAuditRoute,
  handleFleetRoute,
  handleServerMetaRoute,
  handleMultiplayerStatusRoute,
  handleIntegrationSettingsRoute,
  handleProjectFileRoute,
  handleEventsRoute,
  handleAppearanceRoute,
  handleRoomsScaffoldRoute,
  handleRefreshRoute
];

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServerOptions,
  service: FleetLiveService
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const context: RequestContext = {
    request,
    response,
    url,
    options,
    service
  };

  for (const route of ROUTES) {
    if (await route(context)) {
      return;
    }
  }

  notFound(response);
}
