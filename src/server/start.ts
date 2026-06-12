import { serve } from "@hono/node-server";
import { getHost, getPort } from "../lib/config.js";
import { app } from "./app.js";
import { closeDashboardGateway } from "./dashboard-api.js";

export function startTelemetryServer(): void {
  const port = getPort();
  const hostname = getHost();

  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname,
    },
    () => {
      console.log(
        `OpenCode Observability running at http://${hostname}:${port}`,
      );
    },
  );

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down...`);
    // Terminate the dashboard aggregation worker before closing the HTTP server.
    await closeDashboardGateway();
    server.close(() => {
      process.exit(0);
    });
  };

  process.once("SIGINT", (signal) => void shutdown(signal));
  process.once("SIGTERM", (signal) => void shutdown(signal));
}
