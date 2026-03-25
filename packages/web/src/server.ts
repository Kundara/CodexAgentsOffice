import { createServer } from "node:http";

import { FleetLiveService } from "./fleet-live-service";
import { sendJson } from "./http-helpers";
import { handleRequest } from "./router";
import { buildServerMeta } from "./server-metadata";
import { parseArgs } from "./server-options";

export async function startWebServer(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const service = new FleetLiveService(options.projects, options.explicitProjects, options.host, options.port, options.lan);
  await service.start();
  const meta = buildServerMeta(options, options.projects, service.getLanStatus());

  const server = createServer((request, response) => {
    void handleRequest(request, response, options, service).catch((error) => {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(options.port, options.host, () => {
      resolvePromise();
    });
  });

  const mode = options.explicitProjects ? "pinned" : "fleet";
  const scope = options.explicitProjects
    ? options.projects.map((project) => project.root).join(", ")
    : `autodiscover (seed ${options.projects.map((project) => project.root).join(", ")})`;
  console.log(
    `Agents Office Tower web listening on http://${options.host}:${options.port} pid=${meta.pid} build=${meta.buildAt} mode=${mode} scope=${scope}${options.lan.enabled ? ` lan=on/${options.lan.discoveryPort}` : ""}`
  );

  const shutdown = () => {
    void service.stop().finally(() => {
      server.close();
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (require.main === module) {
  void startWebServer();
}
