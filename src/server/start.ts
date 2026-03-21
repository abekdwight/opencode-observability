import { serve } from "@hono/node-server";
import { getHost, getPort } from "../lib/config.js";
import { app } from "./app.js";

export function startTelemetryServer(): void {
  const port = getPort();
  const hostname = getHost();

  serve(
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
}
